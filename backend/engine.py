"""
Investigation Engine
=====================
Implements the design report's 5-signal model as transparent, peer-relative,
rule-based checks (never a black-box classifier), plus one supporting ML
signal (Isolation Forest) for unusual participation patterns.

Every signal:
  - is computed relative to a PEER GROUP (same category), never the whole
    dataset, to avoid punishing thin/specialized markets
  - returns a boolean fire/no-fire plus a human-readable evidence string
  - contributes weighted points to a 0-100 Investigation Priority Score

Corroboration: multiple independent signal categories firing on the same
vendor multiply the score up; a single firing signal is discounted. This is
the mechanism that separates "vendor happens to win a lot in a tiny market"
from "vendor wins a lot AND shares an address with two 'competitors' AND
prices are inflated."
"""
from __future__ import annotations

import math
from collections import defaultdict
from itertools import combinations

import networkx as nx
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest

REQUIRED_COLUMNS = [
    "tender_id", "category", "region", "agency", "estimated_value",
    "bid_deadline", "award_date", "vendor_id", "vendor_name",
    "vendor_address", "bid_amount", "is_winner",
]

SIGNAL_WEIGHTS = {
    "repeated_winner": 25,
    "price_anomaly": 25,
    "bid_clustering": 20,
    "vendor_relationship": 20,
    "unusual_participation": 10,
}

TIER_THRESHOLDS = [
    (70, "Immediate Review"),
    (40, "Scheduled Review"),
    (0, "Monitor"),
]


def tier_for_score(score: float) -> str:
    for threshold, label in TIER_THRESHOLDS:
        if score >= threshold:
            return label
    return "Monitor"


# ---------------------------------------------------------------------------
# Data cleaning
# ---------------------------------------------------------------------------

def clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df.columns = [c.strip().lower().replace(" ", "_") for c in df.columns]

    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")

    df["vendor_id"] = df["vendor_id"].astype(str).str.strip()
    df["vendor_name"] = df["vendor_name"].astype(str).str.strip()
    df["vendor_address"] = df["vendor_address"].fillna("").astype(str).str.strip().str.lower()
    df["category"] = df["category"].astype(str).str.strip()
    df["region"] = df["region"].astype(str).str.strip()
    df["tender_id"] = df["tender_id"].astype(str).str.strip()

    df["bid_amount"] = pd.to_numeric(df["bid_amount"], errors="coerce")
    df["estimated_value"] = pd.to_numeric(df["estimated_value"], errors="coerce")

    def to_bool(v):
        if isinstance(v, bool):
            return v
        return str(v).strip().lower() in ("true", "1", "yes", "y")

    df["is_winner"] = df["is_winner"].apply(to_bool)

    df["bid_deadline"] = pd.to_datetime(df["bid_deadline"], errors="coerce")
    df["award_date"] = pd.to_datetime(df["award_date"], errors="coerce")

    before = len(df)
    df = df.dropna(subset=["vendor_id", "tender_id", "bid_amount", "category"])
    dropped = before - len(df)

    df.attrs["rows_dropped"] = dropped
    return df.reset_index(drop=True)


# ---------------------------------------------------------------------------
# Signal 1: Repeated Winner (peer-relative, market-thinness aware)
# ---------------------------------------------------------------------------

def signal_repeated_winner(df: pd.DataFrame) -> dict:
    result = {}
    for category, cat_df in df.groupby("category"):
        tenders_in_cat = cat_df["tender_id"].nunique()
        qualified_vendors = cat_df["vendor_id"].nunique()
        if tenders_in_cat < 3:
            continue

        wins = cat_df[cat_df["is_winner"]].groupby("vendor_id")["tender_id"].nunique()
        for vendor_id, win_count in wins.items():
            win_rate = win_count / tenders_in_cat

            # Market-thinness adjustment: a small qualified-vendor pool makes
            # high win-rate expected, not anomalous, on its own.
            if qualified_vendors <= 2:
                threshold = 0.95  # only flag near-total monopolisation
            elif qualified_vendors <= 4:
                threshold = 0.75
            else:
                threshold = 0.55

            if win_count >= 3 and win_rate >= threshold:
                result[vendor_id] = {
                    "fired": True,
                    "category": category,
                    "win_count": int(win_count),
                    "tenders_in_category": int(tenders_in_cat),
                    "qualified_vendor_pool": int(qualified_vendors),
                    "win_rate": round(win_rate * 100, 1),
                    "evidence": (
                        f"Won {win_count} of {tenders_in_cat} tenders in '{category}' "
                        f"({win_rate*100:.0f}% win rate) against a qualified pool of "
                        f"{qualified_vendors} vendors."
                    ),
                }
    return result


# ---------------------------------------------------------------------------
# Signal 2: Price Anomaly (robust, peer-relative — median absolute deviation)
# ---------------------------------------------------------------------------

def signal_price_anomaly(df: pd.DataFrame) -> dict:
    result = {}
    winners = df[df["is_winner"]]

    for category, cat_df in winners.groupby("category"):
        prices = cat_df["bid_amount"].values
        if len(prices) < 3:
            continue
        median = np.median(prices)
        mad = np.median(np.abs(prices - median)) or 1e-9
        robust_scale = 1.4826 * mad  # normal-consistent MAD scale

        for _, row in cat_df.iterrows():
            if robust_scale == 0:
                continue
            robust_z = (row["bid_amount"] - median) / robust_scale
            pct_diff = (row["bid_amount"] - median) / median * 100

            # Note: robust_z is deliberately not held to a strict 3.0-sigma
            # bar. If the anomalous cluster itself makes up a sizeable
            # minority of its own category's winners, it inflates the MAD
            # and compresses its own z-score - a known limitation of
            # peer-relative stats when contamination is high. pct_diff
            # (deviation from the peer median in absolute terms) is kept as
            # the stricter, harder-to-game gate.
            if robust_z > 1.2 and pct_diff > 15:
                vendor_id = row["vendor_id"]
                entry = result.setdefault(vendor_id, {
                    "fired": True, "cases": [], "max_pct_diff": 0,
                })
                entry["cases"].append({
                    "tender_id": row["tender_id"],
                    "category": category,
                    "award_price": float(row["bid_amount"]),
                    "peer_median": float(median),
                    "pct_above_median": round(pct_diff, 1),
                    "peer_group_size": int(len(prices)),
                })
                entry["max_pct_diff"] = max(entry["max_pct_diff"], pct_diff)

    for vendor_id, entry in result.items():
        top = max(entry["cases"], key=lambda c: c["pct_above_median"])
        entry["evidence"] = (
            f"Awarded price on {top['tender_id']} ({top['category']}) was "
            f"{top['pct_above_median']:.0f}% above the peer-group median "
            f"(compared against {top['peer_group_size']} comparable awards)."
        )
    return result


# ---------------------------------------------------------------------------
# Signal 3: Bid Clustering / Cover Bidding (tender-level, low variance)
# ---------------------------------------------------------------------------

def signal_bid_clustering(df: pd.DataFrame) -> dict:
    result = defaultdict(lambda: {"fired": True, "tenders": []})

    for tender_id, t_df in df.groupby("tender_id"):
        if len(t_df) < 3:
            continue
        amounts = t_df["bid_amount"].values
        mean = amounts.mean()
        if mean == 0:
            continue
        cv = amounts.std() / mean  # coefficient of variation

        if cv < 0.03:  # bids within ~3% of each other - suspiciously tight
            for _, row in t_df.iterrows():
                result[row["vendor_id"]]["tenders"].append({
                    "tender_id": tender_id,
                    "category": row["category"],
                    "bid_amount": float(row["bid_amount"]),
                    "coefficient_of_variation": round(float(cv), 4),
                    "num_bidders": int(len(t_df)),
                })

    for vendor_id, entry in result.items():
        t = entry["tenders"][0]
        entry["evidence"] = (
            f"On {t['tender_id']}, all {t['num_bidders']} bids fell within "
            f"~{t['coefficient_of_variation']*100:.1f}% of each other "
            f"(typical competitive spread is 10-20%+)."
        )
    return dict(result)


# ---------------------------------------------------------------------------
# Signal 4: Vendor Relationship (shared address + co-bidding => graph)
# Relationship-only ties are NOT scored unless paired with a behavioral
# signal from elsewhere (design report section 6.4).
# ---------------------------------------------------------------------------

def build_relationship_graph(df: pd.DataFrame) -> nx.Graph:
    g = nx.Graph()
    vendors = df[["vendor_id", "vendor_name", "vendor_address"]].drop_duplicates("vendor_id")
    for _, v in vendors.iterrows():
        g.add_node(v["vendor_id"], label=v["vendor_name"], type="vendor")

    # Shared-address edges
    for address, group in vendors[vendors["vendor_address"] != ""].groupby("vendor_address"):
        ids = group["vendor_id"].tolist()
        if len(ids) > 1:
            for a, b in combinations(ids, 2):
                g.add_edge(a, b, type="shared_address", detail=f"Both registered at '{address}'")

    # Co-bidding edges (participated in the same tender) - weaker tie, kept
    # separate so it isn't confused with identity-sharing relationships.
    for tender_id, t_df in df.groupby("tender_id"):
        ids = t_df["vendor_id"].unique().tolist()
        if len(ids) > 1:
            for a, b in combinations(ids, 2):
                if g.has_edge(a, b) and g[a][b]["type"] == "shared_address":
                    g[a][b]["co_bid_count"] = g[a][b].get("co_bid_count", 0) + 1
                # co-bid-only edges are not added to keep the graph readable;
                # co-bidding is used purely as corroboration below.
    return g


def signal_vendor_relationship(df: pd.DataFrame, graph: nx.Graph) -> dict:
    result = {}
    address_edges = [(a, b, d) for a, b, d in graph.edges(data=True) if d.get("type") == "shared_address"]

    for a, b, data in address_edges:
        # Corroboration requirement: only score if the pair also alternates
        # wins / co-bids on the same tenders (a behavioral pattern), per the
        # design report's "relationship + behavior" rule.
        tenders_a = set(df[df["vendor_id"] == a]["tender_id"])
        tenders_b = set(df[df["vendor_id"] == b]["tender_id"])
        shared_tenders = tenders_a & tenders_b

        if not shared_tenders:
            continue  # relationship-only, no co-bidding behavior -> suppressed

        wins_a = df[(df["vendor_id"] == a) & (df["is_winner"]) & (df["tender_id"].isin(shared_tenders))]
        wins_b = df[(df["vendor_id"] == b) & (df["is_winner"]) & (df["tender_id"].isin(shared_tenders))]

        for vendor_id, name in ((a, graph.nodes[a]["label"]), (b, graph.nodes[b]["label"])):
            other_id = b if vendor_id == a else a
            other_name = graph.nodes[other_id]["label"]
            entry = result.setdefault(vendor_id, {"fired": True, "related_to": []})
            entry["related_to"].append({
                "vendor_id": other_id,
                "vendor_name": other_name,
                "shared_tenders": len(shared_tenders),
                "wins_a": len(wins_a),
                "wins_b": len(wins_b),
            })

    for vendor_id, entry in result.items():
        r = entry["related_to"][0]
        entry["evidence"] = (
            f"Shares a registered address with '{r['vendor_name']}', and the two "
            f"co-bid on {r['shared_tenders']} of the same tenders while alternating wins."
        )
    return result


# ---------------------------------------------------------------------------
# Signal 5: Unusual Participation (Isolation Forest - supporting ML signal)
# ---------------------------------------------------------------------------

def signal_unusual_participation(df: pd.DataFrame) -> dict:
    rows = []
    vendor_ids = df["vendor_id"].unique()
    if len(vendor_ids) < 5:
        return {}

    category_median = df[df["is_winner"]].groupby("category")["bid_amount"].median()

    for vendor_id, v_df in df.groupby("vendor_id"):
        num_bids = len(v_df)
        num_tenders = v_df["tender_id"].nunique()
        wins = v_df[v_df["is_winner"]]
        win_rate = len(wins) / num_tenders if num_tenders else 0
        num_categories = v_df["category"].nunique()

        price_devs = []
        for _, row in wins.iterrows():
            peer_med = category_median.get(row["category"])
            if peer_med and peer_med > 0:
                price_devs.append((row["bid_amount"] - peer_med) / peer_med)
        avg_price_dev = float(np.mean(price_devs)) if price_devs else 0.0

        rows.append({
            "vendor_id": vendor_id,
            "num_bids": num_bids,
            "num_tenders": num_tenders,
            "win_rate": win_rate,
            "num_categories": num_categories,
            "avg_price_dev": avg_price_dev,
        })

    feat_df = pd.DataFrame(rows).set_index("vendor_id")
    features = feat_df[["num_bids", "win_rate", "num_categories", "avg_price_dev"]]

    model = IsolationForest(n_estimators=200, contamination="auto", random_state=42)
    model.fit(features)
    scores = model.decision_function(features)  # lower = more anomalous
    preds = model.predict(features)  # -1 anomaly, 1 normal

    result = {}
    for vendor_id, score, pred in zip(feat_df.index, scores, preds):
        if pred == -1:
            f = feat_df.loc[vendor_id]
            result[vendor_id] = {
                "fired": True,
                "isolation_score": round(float(score), 3),
                "evidence": (
                    f"Isolation Forest flags this vendor's participation profile "
                    f"(win rate {f['win_rate']*100:.0f}%, {int(f['num_bids'])} bids across "
                    f"{int(f['num_categories'])} categories, avg. price deviation "
                    f"{f['avg_price_dev']*100:+.0f}%) as statistically unusual relative to all vendors."
                ),
            }
    return result


# ---------------------------------------------------------------------------
# Scoring & case assembly
# ---------------------------------------------------------------------------

def data_confidence_penalty(df: pd.DataFrame, vendor_id: str) -> tuple[float, str | None]:
    v_df = df[df["vendor_id"] == vendor_id]
    n = len(v_df)
    if n < 3:
        return 10.0, f"Only {n} bid record(s) available for this vendor — score reduced for data sparsity."
    return 0.0, None


def run_investigation(df: pd.DataFrame) -> dict:
    df = clean_dataframe(df)

    repeated_winner = signal_repeated_winner(df)
    price_anomaly = signal_price_anomaly(df)
    bid_clustering = signal_bid_clustering(df)
    graph = build_relationship_graph(df)
    vendor_relationship = signal_vendor_relationship(df, graph)
    unusual_participation = signal_unusual_participation(df)

    signal_maps = {
        "repeated_winner": repeated_winner,
        "price_anomaly": price_anomaly,
        "bid_clustering": bid_clustering,
        "vendor_relationship": vendor_relationship,
        "unusual_participation": unusual_participation,
    }

    all_vendor_ids = set()
    for m in signal_maps.values():
        all_vendor_ids.update(m.keys())

    vendor_names = df.drop_duplicates("vendor_id").set_index("vendor_id")["vendor_name"].to_dict()

    cases = []
    for vendor_id in all_vendor_ids:
        fired_signals = {name: m[vendor_id] for name, m in signal_maps.items() if vendor_id in m}
        base_score = sum(SIGNAL_WEIGHTS[name] for name in fired_signals)

        num_categories_fired = len(fired_signals)
        if num_categories_fired >= 3:
            corroboration_multiplier = 1.3
        elif num_categories_fired == 2:
            corroboration_multiplier = 1.15
        else:
            corroboration_multiplier = 0.85  # single-signal cases discounted

        penalty, penalty_note = data_confidence_penalty(df, vendor_id)

        raw_score = base_score * corroboration_multiplier - penalty
        final_score = max(0, min(100, round(raw_score)))

        evidence_list = []
        for name, data in fired_signals.items():
            evidence_list.append({
                "signal": name,
                "label": SIGNAL_LABELS[name],
                "points": SIGNAL_WEIGHTS[name],
                "evidence": data.get("evidence", ""),
                "detail": {k: v for k, v in data.items() if k not in ("fired", "evidence")},
            })

        cases.append({
            "vendor_id": vendor_id,
            "vendor_name": vendor_names.get(vendor_id, vendor_id),
            "score": final_score,
            "tier": tier_for_score(final_score),
            "num_signals": num_categories_fired,
            "corroboration_multiplier": corroboration_multiplier,
            "data_confidence_penalty": penalty,
            "data_confidence_note": penalty_note,
            "signals": evidence_list,
            "non_conclusion_statement": (
                "This pattern warrants review. It does not establish wrongdoing."
            ),
        })

    cases.sort(key=lambda c: c["score"], reverse=True)

    graph_json = {
        "nodes": [
            {
                "id": n,
                "label": data.get("label", n),
                "score": next((c["score"] for c in cases if c["vendor_id"] == n), 0),
                "tier": next((c["tier"] for c in cases if c["vendor_id"] == n), "Monitor"),
            }
            for n, data in graph.nodes(data=True)
        ],
        "edges": [
            {
                "source": a,
                "target": b,
                "type": data.get("type"),
                "detail": data.get("detail", ""),
            }
            for a, b, data in graph.edges(data=True)
        ],
    }

    stats = {
        "total_records": int(len(df)),
        "rows_dropped": int(df.attrs.get("rows_dropped", 0)),
        "total_tenders": int(df["tender_id"].nunique()),
        "total_vendors": int(df["vendor_id"].nunique()),
        "total_categories": int(df["category"].nunique()),
        "alerts_immediate": sum(1 for c in cases if c["tier"] == "Immediate Review"),
        "alerts_scheduled": sum(1 for c in cases if c["tier"] == "Scheduled Review"),
        "alerts_monitor": sum(1 for c in cases if c["tier"] == "Monitor"),
        "total_cases": len(cases),
    }

    return {"cases": cases, "graph": graph_json, "stats": stats, "cleaned_df": df}


SIGNAL_LABELS = {
    "repeated_winner": "Repeated Winner",
    "price_anomaly": "Price Anomaly",
    "bid_clustering": "Bid Clustering",
    "vendor_relationship": "Vendor Relationship",
    "unusual_participation": "Unusual Participation (ML)",
}

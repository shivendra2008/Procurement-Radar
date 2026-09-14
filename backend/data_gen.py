"""
Generates a synthetic procurement dataset for demoing the Investigation Engine.

Deliberately injects:
  - a collusion ring (shared address, bid rotation, tight bid clustering, price
    inflation) that SHOULD be flagged high-priority
  - a thin/specialized market (2 qualified vendors, one wins repeatedly) that
    SHOULD score low because there is no corroborating behavioral signal
  - ordinary competitive noise across several categories/regions
"""
import random
from datetime import date, timedelta

import pandas as pd

random.seed(42)

CATEGORIES = [
    "Road Construction",
    "IT Hardware",
    "Office Supplies",
    "Medical Equipment",
    "Sanitation Services",
    "Specialized Medical Devices",  # deliberately thin market
]

REGIONS = ["North Zone", "South Zone", "East Zone", "West Zone"]

AGENCIES = [
    "Public Works Dept",
    "Health Dept",
    "IT Dept",
    "Municipal Corp",
    "Sanitation Board",
]


def _vendor(vid, name, address):
    return {"vendor_id": vid, "vendor_name": name, "vendor_address": address}


def build_vendor_pool():
    vendors = []
    # Normal, independent vendors
    normal_names = [
        "Alpine Builders", "Metro Constructions", "Horizon Traders",
        "Summit Supplies", "Bluewave Systems", "Crest Logistics",
        "Falcon Works", "Riverbend Contractors", "Cedar Point Inc",
        "Northgate Equipments", "Silverline Corp", "Union Traders",
        "Pioneer Infra", "Delta Hardware", "Evergreen Services",
        "Coastal Supplies", "Vertex Solutions", "Granite Infra",
    ]
    for i, name in enumerate(normal_names):
        vendors.append(_vendor(f"V{i+1:03d}", name, f"{100+i} Market Street, City {i % 4}"))

    # Collusion ring - three "competitors" sharing one address
    vendors.append(_vendor("V901", "Apex Infra Solutions", "42 Industrial Park Road"))
    vendors.append(_vendor("V902", "Zenith Infra Works", "42 Industrial Park Road"))
    vendors.append(_vendor("V903", "Prime Infra Traders", "42 Industrial Park Road"))

    # Thin market - two legitimate, unrelated specialist vendors
    vendors.append(_vendor("V801", "MedTech Precision Devices", "9 Science Park Drive"))
    vendors.append(_vendor("V802", "BioCore Instruments", "77 Innovation Lane"))

    return {v["vendor_id"]: v for v in vendors}


# Category-specific price bands so peer-group comparisons are meaningful
# (mixing a $30k office-supplies contract with a $500k road job into one
# "category" would make every price look normal by sheer variance).
CATEGORY_PRICE_BANDS = {
    "Road Construction": (250_000, 550_000),
    "IT Hardware": (150_000, 220_000),
    "Office Supplies": (20_000, 70_000),
    "Medical Equipment": (100_000, 260_000),
    "Sanitation Services": (80_000, 180_000),
}


def gen_normal_tenders(vendors, start_id=1):
    rows = []
    tender_id = start_id
    normal_vendor_ids = [vid for vid in vendors if vid.startswith("V0")]

    # IT Hardware gets an extra-large honest baseline (14 tenders) so the
    # 9-tender collusion ring injected later is a minority within its own
    # category's peer group, rather than skewing the median itself.
    category_counts = {
        "IT Hardware": 14,
        "Road Construction": 8,
        "Office Supplies": 8,
        "Medical Equipment": 7,
        "Sanitation Services": 7,
    }
    category_sequence = [c for c, n in category_counts.items() for _ in range(n)]
    random.shuffle(category_sequence)

    base_day = date(2025, 1, 1)
    for i, category in enumerate(category_sequence):
        region = random.choice(REGIONS)
        agency = random.choice(AGENCIES)
        n_bidders = random.randint(3, 7)
        bidders = random.sample(normal_vendor_ids, n_bidders)
        lo, hi = CATEGORY_PRICE_BANDS[category]
        base_price = random.uniform(lo, hi)
        est_value = round(base_price, 2)

        bid_deadline = base_day + timedelta(days=i * 9)
        award_date = bid_deadline + timedelta(days=random.randint(7, 21))

        # normal, competitive spread of bids (+/- up to 18%)
        bid_amounts = {
            v: round(base_price * random.uniform(0.85, 1.18), 2) for v in bidders
        }
        winner = min(bid_amounts, key=bid_amounts.get)

        for v in bidders:
            rows.append({
                "tender_id": f"T{tender_id:04d}",
                "category": category,
                "region": region,
                "agency": agency,
                "estimated_value": est_value,
                "bid_deadline": bid_deadline.isoformat(),
                "award_date": award_date.isoformat() if v == winner else "",
                "vendor_id": v,
                "vendor_name": vendors[v]["vendor_name"],
                "vendor_address": vendors[v]["vendor_address"],
                "bid_amount": bid_amounts[v],
                "is_winner": v == winner,
            })
        tender_id += 1
    return rows, tender_id


def gen_collusion_ring(vendors, start_id):
    """Apex / Zenith / Prime rotate wins on IT Hardware tenders, bid tightly
    clustered, and the winning price runs well above the honest peer median."""
    rows = []
    tender_id = start_id
    ring = ["V901", "V902", "V903"]
    base_day = date(2025, 2, 1)

    for i in range(9):
        winner = ring[i % 3]
        base_price = random.uniform(180_000, 220_000)
        est_value = round(base_price, 2)
        bid_deadline = base_day + timedelta(days=i * 14)
        award_date = bid_deadline + timedelta(days=3)  # suspiciously fast turnaround

        # tight clustering: all three bids within ~1.5% of each other, and
        # the "winning" bid is inflated ~30% above the honest market price
        inflated_price = base_price * random.uniform(1.27, 1.34)
        for v in ring:
            jitter = random.uniform(-0.01, 0.01)
            amount = round(inflated_price * (1 + jitter), 2)
            rows.append({
                "tender_id": f"T{tender_id:04d}",
                "category": "IT Hardware",
                "region": "North Zone",
                "agency": "IT Dept",
                "estimated_value": est_value,
                "bid_deadline": bid_deadline.isoformat(),
                "award_date": award_date.isoformat() if v == winner else "",
                "vendor_id": v,
                "vendor_name": vendors[v]["vendor_name"],
                "vendor_address": vendors[v]["vendor_address"],
                "bid_amount": amount,
                "is_winner": v == winner,
            })
        tender_id += 1
    return rows, tender_id


def gen_thin_market(vendors, start_id):
    """Two genuinely independent, unrelated specialist vendors. One wins most
    of the time simply because there are only two qualified suppliers - no
    address sharing, no clustering, no price inflation. Should score LOW."""
    rows = []
    tender_id = start_id
    v1, v2 = "V801", "V802"
    base_day = date(2025, 3, 1)

    # Deterministic 75% win rate for v1 (the more established supplier) -
    # comfortably below the >=95% near-monopolization threshold, so the
    # engine correctly treats this as normal behavior for a 2-vendor market.
    win_pattern = [True, True, False, True, True, False, True, True]

    for i in range(8):
        base_price = random.uniform(300_000, 340_000)
        est_value = round(base_price, 2)
        bid_deadline = base_day + timedelta(days=i * 20)
        award_date = bid_deadline + timedelta(days=random.randint(10, 18))

        amounts = {
            v1: round(base_price * random.uniform(0.92, 1.08), 2),
            v2: round(base_price * random.uniform(0.92, 1.08), 2),
        }
        winner = v1 if win_pattern[i] else v2

        for v in (v1, v2):
            rows.append({
                "tender_id": f"T{tender_id:04d}",
                "category": "Specialized Medical Devices",
                "region": random.choice(REGIONS),
                "agency": "Health Dept",
                "estimated_value": est_value,
                "bid_deadline": bid_deadline.isoformat(),
                "award_date": award_date.isoformat() if v == winner else "",
                "vendor_id": v,
                "vendor_name": vendors[v]["vendor_name"],
                "vendor_address": vendors[v]["vendor_address"],
                "bid_amount": amounts[v],
                "is_winner": v == winner,
            })
        tender_id += 1
    return rows, tender_id


def generate_dataset() -> pd.DataFrame:
    vendors = build_vendor_pool()
    rows = []

    normal_rows, next_id = gen_normal_tenders(vendors, start_id=1)
    rows += normal_rows

    ring_rows, next_id = gen_collusion_ring(vendors, next_id)
    rows += ring_rows

    thin_rows, next_id = gen_thin_market(vendors, next_id)
    rows += thin_rows

    df = pd.DataFrame(rows)
    return df.sample(frac=1, random_state=7).reset_index(drop=True)


if __name__ == "__main__":
    df = generate_dataset()
    df.to_csv("sample_procurement.csv", index=False)
    print(f"Wrote sample_procurement.csv with {len(df)} bid records "
          f"across {df['tender_id'].nunique()} tenders and {df['vendor_id'].nunique()} vendors")

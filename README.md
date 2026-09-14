# Procurement Intelligence & Investigation Radar

Working prototype for Manipal Hackathon 2026 (Team CtrlFreaks) — an
explainable, rule-based investigation-priority engine for government
procurement data, plus a dashboard for triaging the flagged cases.

Implements the 5-layer design from `Procurement_Auditing_System_Design_Report.pdf`
and the MVP scope from `Tech Stack.pdf` / `M# PPT.pdf`: upload → clean →
detect (5 signals) → score (0–100, peer-relative) → explain (evidence, never
a black box) → visualize (vendor relationship graph).

## Running it

**Backend** (FastAPI + pandas + scikit-learn + NetworkX, SQLite storage — no
external services or API keys needed):

```bash
cd backend
source .venv/bin/activate   # venv already created; if missing: python3.12 -m venv .venv
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**Frontend** (React + Vite, dashboard/alerts/graph views):

```bash
cd frontend
npm install
npm run dev
```

Then open http://localhost:5173. Click **"Load synthetic demo dataset"** on
first run — it generates a seeded dataset with:

- A **collusion ring** (3 vendors sharing one registered address, rotating
  wins, tightly clustered bids, ~30% price inflation) → correctly flagged
  **Immediate Review** (98/100) with 4 corroborating signals.
- A **genuine thin/specialized market** (2 real, unrelated vendors, one wins
  ~75% of the time simply because there are only 2 qualified suppliers) →
  correctly stays at **Monitor** (8/100) — demonstrating the context-aware,
  peer-relative scoring that avoids false-positiving legitimate market
  structure.
- Ordinary competitive noise across 4 other categories.

You can also upload your own CSV/Excel file from the Dashboard tab. Required
columns: `tender_id, category, region, agency, estimated_value,
bid_deadline, award_date, vendor_id, vendor_name, vendor_address,
bid_amount, is_winner`.

## What's implemented

- **5 signals**, each peer-relative (compared within category, never the
  whole dataset) and independently explainable:
  1. Repeated Winner — market-thinness-adjusted win-rate threshold
  2. Price Anomaly — robust median-absolute-deviation vs. category peers
  3. Bid Clustering — coefficient-of-variation on same-tender bids
  4. Vendor Relationship — shared address graph, only scored when paired
     with a behavioral pattern (co-bidding + alternating wins)
  5. Unusual Participation — Isolation Forest over vendor-level features
     (supporting ML signal, not the primary decision mechanism)
- **Composite scoring**: weighted signal sum × corroboration multiplier
  (multi-signal cases boosted, single-signal cases discounted) − data-
  confidence penalty, capped 0–100, bucketed into Immediate Review /
  Scheduled Review / Monitor tiers.
- **Every alert** ships with its full evidence package (triggering signals,
  peer-group context, raw evidence data) and an explicit non-conclusion
  statement — the system never declares anyone corrupt.
- **Relationship graph** (NetworkX → Cytoscape.js) visualizing vendor
  clusters and shared-address ties.

## What's simplified for the prototype

- Storage is local SQLite instead of Supabase/Postgres (swap-in ready — the
  engine works on a plain DataFrame either way).
- "AI Explanation" is deterministic template-based NLG instead of an LLM
  API call, so the demo runs fully offline with no API keys. The evidence
  strings are already the natural place to route through an LLM later.
- Entity resolution uses exact address matching rather than fuzzy
  name/address matching — the design report's approach for a production
  system.

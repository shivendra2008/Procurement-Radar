import io
import json
import sqlite3
from pathlib import Path

import pandas as pd
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware

import engine
from data_gen import generate_dataset

DB_PATH = Path(__file__).parent / "procurement.db"

app = FastAPI(title="Procurement Intelligence & Investigation Radar")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory cache of the last computed investigation result so endpoints
# don't need to recompute signals on every request.
STATE = {"result": None, "source": None}


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS records (
            tender_id TEXT, category TEXT, region TEXT, agency TEXT,
            estimated_value REAL, bid_deadline TEXT, award_date TEXT,
            vendor_id TEXT, vendor_name TEXT, vendor_address TEXT,
            bid_amount REAL, is_winner INTEGER
        )
    """)
    conn.commit()
    conn.close()


def save_records(df: pd.DataFrame):
    conn = sqlite3.connect(DB_PATH)
    out = df.copy()
    out["bid_deadline"] = out["bid_deadline"].astype(str)
    out["award_date"] = out["award_date"].astype(str)
    out["is_winner"] = out["is_winner"].astype(int)
    out.to_sql("records", conn, if_exists="replace", index=False)
    conn.close()


def load_records() -> pd.DataFrame | None:
    if not DB_PATH.exists():
        return None
    conn = sqlite3.connect(DB_PATH)
    try:
        df = pd.read_sql("SELECT * FROM records", conn)
    except Exception:
        return None
    finally:
        conn.close()
    if df.empty:
        return None
    return df


def compute_and_cache(df: pd.DataFrame, source: str):
    result = engine.run_investigation(df)
    STATE["result"] = result
    STATE["source"] = source
    return result


@app.on_event("startup")
def startup():
    init_db()
    existing = load_records()
    if existing is not None:
        try:
            compute_and_cache(existing, source="restored")
        except Exception:
            STATE["result"] = None


def require_result():
    if STATE["result"] is None:
        raise HTTPException(status_code=404, detail="No data loaded yet. Upload a file or load the sample dataset.")
    return STATE["result"]


@app.get("/api/health")
def health():
    return {"status": "ok", "has_data": STATE["result"] is not None, "source": STATE["source"]}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...)):
    content = await file.read()
    name = (file.filename or "").lower()

    try:
        if name.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        elif name.endswith((".xlsx", ".xls")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(status_code=400, detail="Only .csv, .xlsx, or .xls files are supported.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse file: {e}")

    try:
        cleaned = engine.clean_dataframe(df)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    save_records(cleaned)
    result = compute_and_cache(cleaned, source=file.filename)

    return {
        "message": f"Processed {file.filename}",
        "stats": result["stats"],
    }


@app.post("/api/load-sample")
def load_sample():
    df = generate_dataset()
    cleaned = engine.clean_dataframe(df)
    save_records(cleaned)
    result = compute_and_cache(cleaned, source="sample_procurement.csv (synthetic demo data)")
    return {
        "message": "Loaded synthetic demo dataset",
        "stats": result["stats"],
    }


@app.get("/api/stats")
def get_stats():
    result = require_result()
    return {"stats": result["stats"], "source": STATE["source"]}


@app.get("/api/alerts")
def get_alerts():
    result = require_result()
    cases = result["cases"]
    summary = [
        {
            "vendor_id": c["vendor_id"],
            "vendor_name": c["vendor_name"],
            "score": c["score"],
            "tier": c["tier"],
            "num_signals": c["num_signals"],
            "signal_labels": [s["label"] for s in c["signals"]],
        }
        for c in cases
    ]
    return {"alerts": summary}


@app.get("/api/alerts/{vendor_id}")
def get_alert_detail(vendor_id: str):
    result = require_result()
    for c in result["cases"]:
        if c["vendor_id"] == vendor_id:
            return c
    raise HTTPException(status_code=404, detail="No alert for this vendor (score too low or vendor not found).")


@app.get("/api/graph")
def get_graph():
    result = require_result()
    return result["graph"]


@app.get("/api/records")
def get_records(vendor_id: str | None = None, tender_id: str | None = None):
    result = require_result()
    df = result["cleaned_df"]
    if vendor_id:
        df = df[df["vendor_id"] == vendor_id]
    if tender_id:
        df = df[df["tender_id"] == tender_id]
    out = df.copy()
    out["bid_deadline"] = out["bid_deadline"].astype(str)
    out["award_date"] = out["award_date"].astype(str)
    return {"records": json.loads(out.to_json(orient="records"))}


@app.post("/api/reset")
def reset():
    if DB_PATH.exists():
        DB_PATH.unlink()
    init_db()
    STATE["result"] = None
    STATE["source"] = None
    return {"message": "Reset complete"}

import { useRef, useState } from "react";
import { api } from "../api";

export default function UploadPanel({ onLoaded }) {
  const fileInput = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [dragOver, setDragOver] = useState(false);

  async function handleFile(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.upload(file);
      onLoaded(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSample() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.loadSample();
      onLoaded(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="upload-panel">
      <div
        className={`dropzone ${dragOver ? "dropzone-active" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const file = e.dataTransfer.files?.[0];
          handleFile(file);
        }}
        onClick={() => fileInput.current?.click()}
      >
        <input
          ref={fileInput}
          type="file"
          accept=".csv,.xlsx,.xls"
          hidden
          onChange={(e) => handleFile(e.target.files?.[0])}
        />
        <div className="dropzone-icon">⇧</div>
        <div className="dropzone-title">
          {busy ? "Processing…" : "Drop a CSV / Excel procurement file, or click to browse"}
        </div>
        <div className="dropzone-sub">
          Columns required: tender_id, category, region, agency, estimated_value,
          bid_deadline, award_date, vendor_id, vendor_name, vendor_address, bid_amount, is_winner
        </div>
      </div>

      <div className="upload-or">
        <span>or</span>
      </div>

      <button className="btn btn-secondary" disabled={busy} onClick={handleSample}>
        Load synthetic demo dataset
      </button>

      {error && <div className="error-box">{error}</div>}
    </div>
  );
}

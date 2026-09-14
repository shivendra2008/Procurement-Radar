import { tierColor, tierBg } from "../tiers";

export default function AlertsList({ alerts, selectedId, onSelect }) {
  if (!alerts.length) {
    return <div className="empty-state">No cases crossed the alert threshold for this dataset.</div>;
  }

  return (
    <div className="alerts-list">
      {alerts.map((a) => (
        <div
          key={a.vendor_id}
          className={`alert-row ${selectedId === a.vendor_id ? "alert-row-active" : ""}`}
          onClick={() => onSelect(a.vendor_id)}
        >
          <div className="alert-row-score" style={{ color: tierColor(a.tier) }}>
            {a.score}
          </div>
          <div className="alert-row-main">
            <div className="alert-row-name">{a.vendor_name}</div>
            <div className="alert-row-signals">
              {a.signal_labels.map((s) => (
                <span className="signal-chip" key={s}>{s}</span>
              ))}
            </div>
          </div>
          <div className="tier-badge" style={{ color: tierColor(a.tier), background: tierBg(a.tier) }}>
            {a.tier}
          </div>
        </div>
      ))}
    </div>
  );
}

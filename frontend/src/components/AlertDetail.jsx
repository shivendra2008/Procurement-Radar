import { tierColor, tierBg } from "../tiers";

function formatDetailValue(v) {
  if (Array.isArray(v)) {
    return v.map((item) =>
      typeof item === "object" ? JSON.stringify(item) : String(item)
    ).join("; ");
  }
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

export default function AlertDetail({ case_ }) {
  if (!case_) {
    return (
      <div className="detail-panel empty-state">
        Select a case from the list to see its full evidence package.
      </div>
    );
  }

  const {
    vendor_name, score, tier, num_signals, corroboration_multiplier,
    data_confidence_penalty, data_confidence_note, signals, non_conclusion_statement,
  } = case_;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div>
          <div className="detail-vendor-name">{vendor_name}</div>
          <div className="detail-sub">Case ID: {case_.vendor_id}</div>
        </div>
        <div className="score-badge" style={{ borderColor: tierColor(tier) }}>
          <div className="score-badge-value" style={{ color: tierColor(tier) }}>{score}</div>
          <div className="score-badge-max">/ 100</div>
        </div>
      </div>

      <div className="tier-badge tier-badge-lg" style={{ color: tierColor(tier), background: tierBg(tier) }}>
        {tier}
      </div>

      <div className="corroboration-line">
        <strong>{num_signals}</strong> independent signal categor{num_signals === 1 ? "y" : "ies"} fired
        {" · "}corroboration multiplier ×{corroboration_multiplier}
        {data_confidence_penalty > 0 && <> {" · "}data-confidence penalty −{data_confidence_penalty}</>}
      </div>
      {data_confidence_note && <div className="data-confidence-note">{data_confidence_note}</div>}

      <div className="signals-section">
        <div className="section-title">Triggering Signals &amp; Evidence</div>
        {signals.map((s) => (
          <div className="signal-card" key={s.signal}>
            <div className="signal-card-header">
              <span className="signal-card-label">{s.label}</span>
              <span className="signal-card-points">+{s.points} pts</span>
            </div>
            <div className="signal-card-evidence">{s.evidence}</div>
            {s.detail && Object.keys(s.detail).length > 0 && (
              <details className="signal-card-detail">
                <summary>Raw evidence data</summary>
                <table>
                  <tbody>
                    {Object.entries(s.detail).map(([k, v]) => (
                      <tr key={k}>
                        <td className="detail-key">{k.replaceAll("_", " ")}</td>
                        <td className="detail-value">{formatDetailValue(v)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </div>
        ))}
      </div>

      <div className="non-conclusion-box">
        <strong>Not a determination.</strong> {non_conclusion_statement}
      </div>
    </div>
  );
}

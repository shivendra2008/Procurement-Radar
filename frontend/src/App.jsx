import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { api } from "./api";
import UploadPanel from "./components/UploadPanel";
import StatsBar from "./components/StatsBar";
import AlertsList from "./components/AlertsList";
import AlertDetail from "./components/AlertDetail";
import RelationshipGraph from "./components/RelationshipGraph";

const TABS = ["Dashboard", "Alerts", "Relationship Graph"];

export default function App() {
  const [tab, setTab] = useState("Dashboard");
  const [hasData, setHasData] = useState(null); // null = unknown/loading
  const [source, setSource] = useState(null);
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [caseDetail, setCaseDetail] = useState(null);
  const [graph, setGraph] = useState(null);
  const [loadingMsg, setLoadingMsg] = useState(null);

  const refreshAll = useCallback(async () => {
    try {
      const health = await api.health();
      setHasData(health.has_data);
      setSource(health.source);
      if (!health.has_data) return;

      const [statsRes, alertsRes, graphRes] = await Promise.all([
        api.stats(), api.alerts(), api.graph(),
      ]);
      setStats(statsRes.stats);
      setAlerts(alertsRes.alerts);
      setGraph(graphRes);
      if (alertsRes.alerts.length && !selectedId) {
        setSelectedId(alertsRes.alerts[0].vendor_id);
      }
    } catch (e) {
      console.error(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { refreshAll(); }, [refreshAll]);

  useEffect(() => {
    if (!selectedId) { setCaseDetail(null); return; }
    api.alertDetail(selectedId).then(setCaseDetail).catch(() => setCaseDetail(null));
  }, [selectedId]);

  async function handleLoaded(res) {
    setLoadingMsg(res.message);
    setSelectedId(null);
    await refreshAll();
    setTab("Dashboard");
    setTimeout(() => setLoadingMsg(null), 3000);
  }

  async function handleReset() {
    await api.reset();
    setHasData(false);
    setStats(null);
    setAlerts([]);
    setGraph(null);
    setSelectedId(null);
    setCaseDetail(null);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">◈</div>
          <div>
            <div className="brand-title">Procurement Radar</div>
            <div className="brand-sub">Investigation Priority Engine</div>
          </div>
        </div>

        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={`tab-btn ${tab === t ? "tab-btn-active" : ""}`}
              onClick={() => setTab(t)}
              disabled={!hasData && t !== "Dashboard"}
            >
              {t}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {hasData && (
            <>
              <div className="source-line" title={source}>Source: {source}</div>
              <button className="btn btn-ghost" onClick={handleReset}>Reset dataset</button>
            </>
          )}
          <div className="disclaimer">
            Alerts are investigation leads, not accusations. Every score is
            evidence-backed and explainable — never a black box.
          </div>
        </div>
      </aside>

      <main className="main-content">
        {loadingMsg && <div className="toast">{loadingMsg}</div>}

        {tab === "Dashboard" && (
          <div className="page">
            <h1>Investigation Dashboard</h1>
            <p className="page-sub">
              Upload procurement records (tenders · bids · vendors · awards) to run the
              Investigation Engine, or load the synthetic demo dataset which includes a
              seeded collusion ring and a legitimate thin-market vendor for comparison.
            </p>

            {!hasData ? (
              <UploadPanel onLoaded={handleLoaded} />
            ) : (
              <>
                <StatsBar stats={stats} />
                <div className="dashboard-columns">
                  <div className="dashboard-col">
                    <div className="section-title">Top Priority Cases</div>
                    <AlertsList
                      alerts={alerts.slice(0, 5)}
                      selectedId={selectedId}
                      onSelect={(id) => { setSelectedId(id); setTab("Alerts"); }}
                    />
                  </div>
                  <div className="dashboard-col">
                    <div className="section-title">Load different data</div>
                    <UploadPanel onLoaded={handleLoaded} />
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {tab === "Alerts" && hasData && (
          <div className="page page-split">
            <div className="page-split-left">
              <h1>Case Queue</h1>
              <p className="page-sub">Ranked by Investigation Priority Score, tiered for triage.</p>
              <AlertsList alerts={alerts} selectedId={selectedId} onSelect={setSelectedId} />
            </div>
            <div className="page-split-right">
              <AlertDetail case_={caseDetail} />
            </div>
          </div>
        )}

        {tab === "Relationship Graph" && hasData && (
          <div className="page page-graph">
            <h1>Vendor Relationship Graph</h1>
            <p className="page-sub">
              Node size/color reflect Investigation Priority Score. Red edges mark vendors
              sharing a registered address. A shared address alone is never scored — it only
              contributes when paired with a behavioral signal (e.g. alternating wins).
            </p>
            <div className="graph-body">
              <div className="graph-main">
                <RelationshipGraph graph={graph} onSelectVendor={setSelectedId} />
              </div>
              <div className="graph-side">
                <AlertDetail case_={caseDetail} />
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

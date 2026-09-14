// Plain vanilla JS app - no build step, no framework.
// Relies on globals defined by tiers.js and api.js (loaded before this file).

const state = {
  hasData: false,
  source: null,
  stats: null,
  alerts: [],
  selectedId: null,
  caseDetail: null,
  graph: null,
  cy: null, // active cytoscape instance, if any
};

let currentTab = "dashboard";

// ---------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------

function escapeHtml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDetailValue(v) {
  if (Array.isArray(v)) {
    return v.map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item))).join("; ");
  }
  if (typeof v === "object" && v !== null) return JSON.stringify(v);
  return String(v);
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._timer);
  showToast._timer = setTimeout(() => { toast.hidden = true; }, 3000);
}

// ---------------------------------------------------------------------
// Upload panel (used on both the empty-state dashboard and the
// "load different data" card once data is already loaded)
// ---------------------------------------------------------------------

function setupUploadPanel(container, onLoaded) {
  const tpl = document.getElementById("tpl-upload-panel");
  const node = tpl.content.cloneNode(true);

  const dropzone = node.querySelector(".dropzone");
  const dropzoneTitle = node.querySelector(".dropzone-title");
  const fileInput = node.querySelector('input[type="file"]');
  const sampleBtn = node.querySelector(".sample-btn");
  const errorBox = node.querySelector(".error-box");

  let busy = false;

  function setError(msg) {
    if (msg) {
      errorBox.textContent = msg;
      errorBox.hidden = false;
    } else {
      errorBox.hidden = true;
    }
  }

  function setBusy(b) {
    busy = b;
    dropzoneTitle.textContent = busy
      ? "Processing…"
      : "Drop a CSV / Excel procurement file, or click to browse";
    sampleBtn.disabled = busy;
  }

  async function handleFile(file) {
    if (!file || busy) return;
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

  dropzone.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => handleFile(fileInput.files?.[0]));
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dropzone-active");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dropzone-active"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dropzone-active");
    handleFile(e.dataTransfer.files?.[0]);
  });

  sampleBtn.addEventListener("click", async () => {
    if (busy) return;
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
  });

  container.innerHTML = "";
  container.appendChild(node);
}

// ---------------------------------------------------------------------
// Alert list rows (shared between the Dashboard "Top Priority Cases"
// card and the full Case Queue on the Alerts tab)
// ---------------------------------------------------------------------

function alertRowHtml(a) {
  const active = a.vendor_id === state.selectedId ? "alert-row-active" : "";
  const chips = a.signal_labels.map((s) => `<span class="signal-chip">${escapeHtml(s)}</span>`).join("");
  return `
    <div class="alert-row ${active}" data-vendor-id="${escapeHtml(a.vendor_id)}">
      <div class="alert-row-score" style="color:${tierColor(a.tier)}">${a.score}</div>
      <div class="alert-row-main">
        <div class="alert-row-name">${escapeHtml(a.vendor_name)}</div>
        <div class="alert-row-signals">${chips}</div>
      </div>
      <div class="tier-badge" style="color:${tierColor(a.tier)};background:${tierBg(a.tier)}">${escapeHtml(a.tier)}</div>
    </div>
  `;
}

function renderAlertsListInto(containerId, alerts, opts = {}) {
  const container = document.getElementById(containerId);
  if (!alerts.length) {
    container.innerHTML = `<div class="empty-state">No cases crossed the alert threshold for this dataset.</div>`;
    return;
  }
  container.innerHTML = alerts.map(alertRowHtml).join("");
  container.querySelectorAll(".alert-row").forEach((row) => {
    row.addEventListener("click", () => selectVendor(row.dataset.vendorId, opts));
  });
}

// ---------------------------------------------------------------------
// Evidence detail panel
// ---------------------------------------------------------------------

function detailPanelHtml(case_) {
  if (!case_) {
    return `<div class="detail-panel empty-state">Select a case from the list to see its full evidence package.</div>`;
  }

  const {
    vendor_name, vendor_id, score, tier, num_signals, corroboration_multiplier,
    data_confidence_penalty, data_confidence_note, signals, non_conclusion_statement,
  } = case_;

  const signalsHtml = signals.map((s) => {
    const entries = Object.entries(s.detail || {});
    const detailHtml = entries.length
      ? `<details class="signal-card-detail"><summary>Raw evidence data</summary><table><tbody>${entries.map(
          ([k, v]) => `<tr><td class="detail-key">${escapeHtml(k.replaceAll("_", " "))}</td><td class="detail-value">${escapeHtml(formatDetailValue(v))}</td></tr>`
        ).join("")}</tbody></table></details>`
      : "";
    return `
      <div class="signal-card">
        <div class="signal-card-header">
          <span class="signal-card-label">${escapeHtml(s.label)}</span>
          <span class="signal-card-points">+${s.points} pts</span>
        </div>
        <div class="signal-card-evidence">${escapeHtml(s.evidence)}</div>
        ${detailHtml}
      </div>
    `;
  }).join("");

  return `
    <div class="detail-panel">
      <div class="detail-header">
        <div>
          <div class="detail-vendor-name">${escapeHtml(vendor_name)}</div>
          <div class="detail-sub">Case ID: ${escapeHtml(vendor_id)}</div>
        </div>
        <div class="score-badge" style="border-color:${tierColor(tier)}">
          <div class="score-badge-value" style="color:${tierColor(tier)}">${score}</div>
          <div class="score-badge-max">/ 100</div>
        </div>
      </div>

      <div class="tier-badge tier-badge-lg" style="color:${tierColor(tier)};background:${tierBg(tier)}">${escapeHtml(tier)}</div>

      <div class="corroboration-line">
        <strong>${num_signals}</strong> independent signal categor${num_signals === 1 ? "y" : "ies"} fired
        · corroboration multiplier ×${corroboration_multiplier}
        ${data_confidence_penalty > 0 ? ` · data-confidence penalty −${data_confidence_penalty}` : ""}
      </div>
      ${data_confidence_note ? `<div class="data-confidence-note">${escapeHtml(data_confidence_note)}</div>` : ""}

      <div class="signals-section">
        <div class="section-title">Triggering Signals &amp; Evidence</div>
        ${signalsHtml}
      </div>

      <div class="non-conclusion-box"><strong>Not a determination.</strong> ${escapeHtml(non_conclusion_statement)}</div>
    </div>
  `;
}

// ---------------------------------------------------------------------
// Relationship graph (Cytoscape)
// ---------------------------------------------------------------------

function renderGraphCanvas() {
  const container = document.getElementById("graph-canvas");
  if (state.cy) {
    state.cy.destroy();
    state.cy = null;
  }
  if (!state.graph) return;

  const elements = [
    ...state.graph.nodes.map((n) => ({ data: { id: n.id, label: n.label, score: n.score, tier: n.tier } })),
    ...state.graph.edges.map((e, i) => ({
      data: { id: `e${i}`, source: e.source, target: e.target, type: e.type, detail: e.detail },
    })),
  ];

  const cy = cytoscape({
    container,
    elements,
    style: [
      {
        selector: "node",
        style: {
          "background-color": (ele) => tierColor(ele.data("tier")),
          "label": "data(label)",
          "color": "#e6e9f2",
          "font-size": 10,
          "text-valign": "bottom",
          "text-margin-y": 6,
          "width": (ele) => 24 + Math.min(30, ele.data("score") / 3),
          "height": (ele) => 24 + Math.min(30, ele.data("score") / 3),
          "border-width": 2,
          "border-color": "#0e1420",
        },
      },
      {
        selector: "edge",
        style: {
          "width": 2,
          "line-color": (ele) => (ele.data("type") === "shared_address" ? "#e63965" : "#3a4257"),
          "curve-style": "bezier",
          "opacity": 0.7,
        },
      },
      { selector: ".faded", style: { opacity: 0.15 } },
    ],
    layout: { name: "cose", animate: false, padding: 40, nodeRepulsion: 8000 },
  });

  cy.on("tap", "node", (evt) => selectVendor(evt.target.id()));
  cy.on("mouseover", "node", (evt) => {
    const node = evt.target;
    cy.elements().addClass("faded");
    node.removeClass("faded");
    node.neighborhood().removeClass("faded");
  });
  cy.on("mouseout", "node", () => cy.elements().removeClass("faded"));

  state.cy = cy;
}

// ---------------------------------------------------------------------
// Page renderers
// ---------------------------------------------------------------------

function renderStatsCards() {
  const cards = [
    ["Tenders", state.stats.total_tenders],
    ["Vendors", state.stats.total_vendors],
    ["Categories", state.stats.total_categories],
    ["Bid Records", state.stats.total_records],
    ["Flagged Cases", state.stats.total_cases],
  ];
  document.getElementById("stats-cards").innerHTML = cards.map(([label, value]) => `
    <div class="stat-card">
      <div class="stat-value">${value}</div>
      <div class="stat-label">${escapeHtml(label)}</div>
    </div>
  `).join("");
}

function renderTierBars() {
  const tiers = [
    ["Immediate Review", state.stats.alerts_immediate],
    ["Scheduled Review", state.stats.alerts_scheduled],
    ["Monitor", state.stats.alerts_monitor],
  ];
  const max = Math.max(1, ...tiers.map((t) => t[1]));
  document.getElementById("tier-bars").innerHTML = tiers.map(([name, count]) => `
    <div class="tier-bar-row">
      <div class="tier-bar-label">${escapeHtml(name)}</div>
      <div class="tier-bar-track"><div class="tier-bar-fill" style="width:${(count / max) * 100}%;background:${tierColor(name)}"></div></div>
      <div class="tier-bar-count">${count}</div>
    </div>
  `).join("");
}

function renderDashboard() {
  const emptyEl = document.getElementById("dashboard-empty");
  const loadedEl = document.getElementById("dashboard-loaded");

  if (!state.hasData) {
    emptyEl.hidden = false;
    loadedEl.hidden = true;
    return;
  }

  emptyEl.hidden = true;
  loadedEl.hidden = false;
  renderStatsCards();
  renderTierBars();
  renderAlertsListInto("top-cases", state.alerts.slice(0, 5), { goToAlerts: true });
}

function renderAlertsTab() {
  renderAlertsListInto("alerts-list-full", state.alerts, {});
  document.getElementById("alert-detail-alerts").innerHTML = detailPanelHtml(state.caseDetail);
}

function renderGraphTab() {
  document.getElementById("alert-detail-graph").innerHTML = detailPanelHtml(state.caseDetail);
  renderGraphCanvas();
}

function updateSidebarNav() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    if (btn.dataset.tab !== "dashboard") btn.disabled = !state.hasData;
  });
  const sourceLine = document.getElementById("source-line");
  const resetBtn = document.getElementById("reset-btn");
  if (state.hasData) {
    sourceLine.hidden = false;
    sourceLine.textContent = `Source: ${state.source}`;
    sourceLine.title = state.source || "";
    resetBtn.hidden = false;
  } else {
    sourceLine.hidden = true;
    resetBtn.hidden = true;
  }
}

function setActiveTab(tab) {
  if (tab !== "dashboard" && !state.hasData) return;
  currentTab = tab;

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("tab-btn-active", btn.dataset.tab === tab);
  });
  document.getElementById("view-dashboard").hidden = tab !== "dashboard";
  document.getElementById("view-alerts").hidden = tab !== "alerts";
  document.getElementById("view-graph").hidden = tab !== "graph";

  if (tab === "dashboard") renderDashboard();
  if (tab === "alerts") renderAlertsTab();
  if (tab === "graph") renderGraphTab();
}

// ---------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------

async function selectVendor(vendorId, opts = {}) {
  state.selectedId = vendorId;
  try {
    state.caseDetail = await api.alertDetail(vendorId);
  } catch {
    state.caseDetail = null;
  }

  if (opts.goToAlerts) {
    setActiveTab("alerts");
    return;
  }
  if (currentTab === "dashboard") renderDashboard();
  else if (currentTab === "alerts") renderAlertsTab();
  else if (currentTab === "graph") {
    document.getElementById("alert-detail-graph").innerHTML = detailPanelHtml(state.caseDetail);
  }
}

async function refreshAll() {
  try {
    const health = await api.health();
    state.hasData = health.has_data;
    state.source = health.source;
    updateSidebarNav();

    if (!state.hasData) {
      renderDashboard();
      return;
    }

    const [statsRes, alertsRes, graphRes] = await Promise.all([api.stats(), api.alerts(), api.graph()]);
    state.stats = statsRes.stats;
    state.alerts = alertsRes.alerts;
    state.graph = graphRes;

    if (state.alerts.length && !state.selectedId) {
      state.selectedId = state.alerts[0].vendor_id;
      state.caseDetail = await api.alertDetail(state.selectedId);
    }

    renderDashboard();
    if (currentTab === "alerts") renderAlertsTab();
    if (currentTab === "graph") renderGraphTab();
  } catch (e) {
    console.error(e);
  }
}

async function handleLoaded(res) {
  showToast(res.message);
  state.selectedId = null;
  state.caseDetail = null;
  await refreshAll();
  setActiveTab("dashboard");
}

async function handleReset() {
  await api.reset();
  state.hasData = false;
  state.source = null;
  state.stats = null;
  state.alerts = [];
  state.graph = null;
  state.selectedId = null;
  state.caseDetail = null;
  updateSidebarNav();
  setActiveTab("dashboard");
}

// ---------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------

document.addEventListener("DOMContentLoaded", () => {
  setupUploadPanel(document.getElementById("upload-panel-dashboard"), handleLoaded);
  setupUploadPanel(document.getElementById("upload-panel-loaded"), handleLoaded);

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  document.getElementById("reset-btn").addEventListener("click", handleReset);

  refreshAll();
});

// Plain global helper - no build step, loaded via a plain <script> tag.
const API_BASE_URL = "http://localhost:8000/api";

async function apiRequest(path, options = {}) {
  const res = await fetch(`${API_BASE_URL}${path}`, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore - no JSON body
    }
    throw new Error(detail);
  }
  return res.json();
}

const api = {
  health: () => apiRequest("/health"),
  loadSample: () => apiRequest("/load-sample", { method: "POST" }),
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return apiRequest("/upload", { method: "POST", body: form });
  },
  stats: () => apiRequest("/stats"),
  alerts: () => apiRequest("/alerts"),
  alertDetail: (vendorId) => apiRequest(`/alerts/${encodeURIComponent(vendorId)}`),
  graph: () => apiRequest("/graph"),
  reset: () => apiRequest("/reset", { method: "POST" }),
};

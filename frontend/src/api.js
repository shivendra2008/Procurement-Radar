const BASE_URL = "http://localhost:8000/api";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  health: () => request("/health"),
  loadSample: () => request("/load-sample", { method: "POST" }),
  upload: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/upload", { method: "POST", body: form });
  },
  stats: () => request("/stats"),
  alerts: () => request("/alerts"),
  alertDetail: (vendorId) => request(`/alerts/${encodeURIComponent(vendorId)}`),
  graph: () => request("/graph"),
  reset: () => request("/reset", { method: "POST" }),
};

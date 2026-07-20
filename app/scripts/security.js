const MUTATION_METHODS = new Set(["POST", "PATCH", "DELETE", "PUT"]);
const originalFetch = window.fetch.bind(window);

const sameOriginUrl = (resource) => {
  const raw = typeof resource === "string" ? resource : resource?.url || "";
  try {
    return new URL(raw, window.location.href);
  } catch {
    return null;
  }
};

const loadCsrfToken = async () => {
  if (window.__csrfToken) return window.__csrfToken;
  try {
    const response = await originalFetch("/api/session", { credentials: "include" });
    if (!response.ok) return "";
    const session = await response.json();
    window.__csrfToken = session?.csrfToken || "";
    return window.__csrfToken;
  } catch {
    return "";
  }
};

window.fetch = async (resource, options = {}) => {
  const method = String(options.method || "GET").toUpperCase();
  const url = sameOriginUrl(resource);
  if (url?.origin === window.location.origin && MUTATION_METHODS.has(method)) {
    const token = await loadCsrfToken();
    if (token) {
      const headers = new Headers(options.headers || {});
      headers.set("X-CSRF-Token", token);
      options = { ...options, headers };
    }
  }
  return originalFetch(resource, options);
};

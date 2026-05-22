const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatDate = (iso) => {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString();
  } catch {
    return "—";
  }
};

const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed (${response.status})`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
};

const grid = document.getElementById("orgs-grid");
const errorEl = document.getElementById("org-error");
const form = document.getElementById("org-create");

const render = (orgs) => {
  if (!orgs.length) {
    grid.innerHTML = `
      <div class="orgs-empty">
        <strong>No organizations yet.</strong>
        Create your first one above to get started.
      </div>
    `;
    return;
  }

  grid.innerHTML = `
    <div class="orgs-grid">
      ${orgs
        .map(
          (org) => `
            <div class="org-card" role="button" tabindex="0" data-org-id="${org.id}">
              <span class="delete-org" role="button" tabindex="0" data-action="delete" data-org-id="${org.id}">Delete</span>
              <h2>${escapeHtml(org.name)}</h2>
              <div class="meta">
                <span>Created ${formatDate(org.created_at)}</span>
              </div>
            </div>
          `
        )
        .join("")}
    </div>
  `;
};

const load = async () => {
  try {
    const orgs = await fetchJson("/api/admin/orgs");
    render(orgs);
  } catch (error) {
    if (error.message.includes("Not authenticated") || error.message.includes("403")) {
      window.location.href = "/";
      return;
    }
    grid.innerHTML = `<div class="orgs-empty"><strong>Couldn't load organizations.</strong>${escapeHtml(error.message || "")}</div>`;
  }
};

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";
  const name = String(new FormData(form).get("name") || "").trim();
  if (!name) return;
  try {
    const org = await fetchJson("/api/admin/orgs", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    form.reset();
    // Drop straight into the new org's control panel.
    window.location.href = `policies.html?org=${encodeURIComponent(org.id)}`;
  } catch (error) {
    errorEl.textContent = error.message || "Failed to create organization.";
  }
});

grid?.addEventListener("click", async (event) => {
  const deleteBtn = event.target.closest("[data-action='delete']");
  if (deleteBtn) {
    event.stopPropagation();
    const orgId = deleteBtn.dataset.orgId;
    if (!orgId) return;
    if (!confirm("Delete this organization and all its data?")) return;
    try {
      await fetchJson(`/api/admin/orgs/${orgId}`, { method: "DELETE" });
      load();
    } catch (error) {
      errorEl.textContent = error.message || "Delete failed.";
    }
    return;
  }

  const card = event.target.closest(".org-card");
  if (card) {
    const orgId = card.dataset.orgId;
    if (!orgId) return;
    window.location.href = `policies.html?org=${encodeURIComponent(orgId)}`;
  }
});

load();

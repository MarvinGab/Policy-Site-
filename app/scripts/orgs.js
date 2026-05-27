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

const accessModeLabel = (mode) => (mode === "hrms_link" ? "HRMS Tile" : "Standalone");

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

const view = document.getElementById("orgs-view");
const modal = document.getElementById("org-modal");
const form = document.getElementById("org-create");
const nameInput = document.getElementById("org-name-input");
const dialogError = document.getElementById("org-dialog-error");

// Build the per-org subdomain URL from the product root host.
// Dev: trio.localhost:5183/   Prod: trio.policies.zarohr.com/
const getRootHost = () => {
  const { host } = window.location;
  const localhostIndex = host.indexOf("localhost");
  if (localhostIndex >= 0) return host.slice(localhostIndex);
  return host.replace(/^[^.]+\./, "");
};

const orgUrl = (slug) => {
  const { protocol } = window.location;
  return `${protocol}//${slug}.${getRootHost()}/`;
};

const isLocalRootHost = () => getRootHost().startsWith("localhost");

const openOrg = async ({ id, slug }) => {
  if (!id || !slug) return;
  if (isLocalRootHost()) {
    const data = await fetchJson(`/api/admin/orgs/${id}/select`, { method: "POST" });
    window.location.href = data.redirect || "policies.html";
    return;
  }
  window.location.href = orgUrl(slug);
};

let allOrgs = [];
let searchQuery = "";

const renderHero = () => {
  view.innerHTML = `
    <div class="orgs-hero">
      <div class="orgs-hero-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 21h18"/>
          <path d="M5 21V7l7-4 7 4v14"/>
          <path d="M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1"/>
        </svg>
      </div>
      <h1>No organizations yet</h1>
      <p>Use the button at the bottom-right to create your first one.</p>
    </div>
  `;
};

const renderList = () => {
  const filtered = searchQuery
    ? allOrgs.filter((org) => {
        const q = searchQuery.toLowerCase();
        return org.name.toLowerCase().includes(q) || org.slug.toLowerCase().includes(q);
      })
    : allOrgs;

  view.innerHTML = `
    <header class="orgs-toolbar">
      <div>
        <h1>Organizations</h1>
        <p class="subtitle">${allOrgs.length} ${allOrgs.length === 1 ? "workspace" : "workspaces"}</p>
      </div>
      <div class="orgs-toolbar-actions">
        <div class="orgs-search">
          <input
            type="search"
            id="orgs-search-input"
            placeholder="Search organizations…"
            value="${escapeHtml(searchQuery)}"
            autocomplete="off"
          />
        </div>
      </div>
    </header>
    <p class="orgs-error" id="org-error" role="alert"></p>
    <div class="orgs-grid">
      ${
        filtered.length
          ? filtered
              .map((org) => {
                const policies = org.policy_count ?? 0;
                const employees = org.employee_count ?? 0;
                const admins = org.admin_count ?? 0;
                return `
                  <div class="org-card" role="button" tabindex="0" data-org-id="${org.id}" data-org-slug="${escapeHtml(org.slug)}">
                    <span class="delete-org" role="button" tabindex="0" data-action="delete" data-org-id="${org.id}" aria-label="Delete organization">×</span>

                    <header class="org-card-head">
                      <h2>${escapeHtml(org.name)}</h2>
                      <span class="access-mode-chip access-mode-chip--${org.access_mode || "standalone"}">${accessModeLabel(org.access_mode)}</span>
                    </header>

                    <p class="org-card-slug"><span class="slug-prefix">/</span>${escapeHtml(org.slug)}</p>

                    <div class="org-stats">
                      <div class="stat-block">
                        <span class="stat-value">${policies}</span>
                        <span class="stat-label">${policies === 1 ? "Policy" : "Policies"}</span>
                      </div>
                      <div class="stat-block">
                        <span class="stat-value">${employees}</span>
                        <span class="stat-label">${employees === 1 ? "Employee" : "Employees"}</span>
                      </div>
                      <div class="stat-block">
                        <span class="stat-value">${admins}</span>
                        <span class="stat-label">${admins === 1 ? "Admin" : "Admins"}</span>
                      </div>
                    </div>

                    <footer class="org-card-foot">
                      <span class="org-card-created">Created ${formatDate(org.created_at)}</span>
                      <span class="org-card-cta" aria-hidden="true">Open <span class="org-card-arrow">›</span></span>
                    </footer>
                  </div>
                `;
              })
              .join("")
          : `<div class="orgs-no-results">No organizations match "${escapeHtml(searchQuery)}".</div>`
      }
    </div>
  `;

  if (searchQuery) {
    const input = document.getElementById("orgs-search-input");
    if (input) {
      input.focus();
      const len = input.value.length;
      input.setSelectionRange(len, len);
    }
  }
};

const render = () => {
  if (!allOrgs.length) renderHero();
  else renderList();
};

const load = async () => {
  try {
    allOrgs = await fetchJson("/api/admin/orgs");
    render();
  } catch (error) {
    if (error.message.includes("Not authenticated") || error.message.includes("403")) {
      window.location.href = "/";
      return;
    }
    view.innerHTML = `<div class="orgs-hero"><h1>Couldn't load organizations</h1><p>${escapeHtml(error.message || "")}</p></div>`;
  }
};

// --- Modal control ---

const openModal = () => {
  modal.classList.add("is-visible");
  modal.setAttribute("aria-hidden", "false");
  dialogError.textContent = "";
  form.reset();
  setTimeout(() => nameInput.focus(), 50);
};

const closeModal = () => {
  modal.classList.remove("is-visible");
  modal.setAttribute("aria-hidden", "true");
};

modal.addEventListener("click", (event) => {
  if (event.target === modal) closeModal();
  if (event.target.closest("[data-action='cancel']")) closeModal();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && modal.classList.contains("is-visible")) closeModal();
});

// Explicit Enter-to-submit on the name input so the keystroke
// always commits, even if focus shifts or native implicit-submit gets blocked.
nameInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  if (typeof form.requestSubmit === "function") {
    form.requestSubmit();
  } else {
    form.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  dialogError.textContent = "";
  const name = String(new FormData(form).get("name") || "").trim();
  if (!name) return;
  const submitBtn = form.querySelector("button[type='submit']");
  submitBtn.disabled = true;
  try {
    const org = await fetchJson("/api/admin/orgs", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    if (isLocalRootHost()) {
      const selected = await fetchJson(`/api/admin/orgs/${org.id}/select`, { method: "POST" });
      window.location.href = selected.redirect || "policies.html";
    } else {
      window.location.href = orgUrl(org.slug);
    }
  } catch (error) {
    dialogError.textContent = error.message || "Failed to create organization.";
    submitBtn.disabled = false;
  }
});

// FAB lives outside the view container, so listen at the document level.
document.addEventListener("click", (event) => {
  if (event.target.closest("[data-action='open-create']")) openModal();
});

// --- View-level interactions (delegated, since the view re-renders) ---

view.addEventListener("input", (event) => {
  const input = event.target.closest("#orgs-search-input");
  if (!input) return;
  searchQuery = input.value;
  renderList();
});

view.addEventListener("click", async (event) => {
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
      const errEl = document.getElementById("org-error");
      if (errEl) errEl.textContent = error.message || "Delete failed.";
    }
    return;
  }

  const card = event.target.closest(".org-card");
  if (card) {
    const slug = card.dataset.orgSlug;
    const id = card.dataset.orgId;
    try {
      await openOrg({ id, slug });
    } catch (error) {
      const errEl = document.getElementById("org-error");
      if (errEl) errEl.textContent = error.message || "Could not open organization.";
    }
  }
});

view.addEventListener("keydown", (event) => {
  const card = event.target.closest(".org-card");
  if (card && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    const slug = card.dataset.orgSlug;
    const id = card.dataset.orgId;
    openOrg({ id, slug }).catch((error) => {
      const errEl = document.getElementById("org-error");
      if (errEl) errEl.textContent = error.message || "Could not open organization.";
    });
  }
});

load();

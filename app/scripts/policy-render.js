// Renders the rail of module cards for an organization on /policies.html.
// Pulls the modules + policies from the API for the org specified in ?org=<id>.
// If no org param is given (e.g. someone hits /policies.html directly), bounces to /orgs.html.

const ICON_BY_SLUG = {
  "doing-the-right-thing": "/Images/ChatGPT Image Jan 13, 2026, 03_46_37 PM.png",
  "health-care-safety": "/Images/ChatGPT Image Jan 13, 2026, 03_32_07 PM.png",
  "learning-performance": "/Images/ChatGPT Image Jan 13, 2026, 03_56_51 PM.png",
  "life-at-work": "/Images/ChatGPT Image Jan 13, 2026, 04_52_55 PM.png",
  "pay-perks-security": "/Images/ChatGPT Image Jan 13, 2026, 05_05_11 PM.png",
  "time-away": "/Images/ChatGPT Image Jan 13, 2026, 05_12_06 PM.png",
  "tools-allowance": "/Images/ChatGPT Image Jan 13, 2026, 05_23_38 PM.png",
};

// SessionStorage key for the rail data, scoped per org via hostname so
// switching orgs doesn't show the wrong cache.
const RAIL_CACHE_KEY = `rail:${typeof window !== "undefined" ? window.location.hostname : ""}`;

export const initPolicyRender = () => {
  if (document.body?.dataset.page !== "policies") return;

  const container = document.querySelector("[data-policy-grid]");
  if (!container) return;

  // Stale-while-revalidate: paint from cache instantly on revisit so admin
  // round-trips (dashboard → admin → back) don't show a "Loading…" flash.
  // Background fetch then refreshes if data changed.
  let renderedFromCache = false;
  try {
    const cached = sessionStorage.getItem(RAIL_CACHE_KEY);
    if (cached) {
      const data = JSON.parse(cached);
      renderRail(container, data);
      renderedFromCache = true;
    }
  } catch (error) {
    // Corrupt cache — ignore and fall through to the fresh fetch.
    sessionStorage.removeItem(RAIL_CACHE_KEY);
  }

  if (!renderedFromCache) {
    container.innerHTML = `<div class="policy-rail-loading">Loading…</div>`;
  }

  // The org context comes from the subdomain — the server resolves it from
  // the Host header and scopes /api/org/policies accordingly.
  fetch(`/api/org/policies`, { credentials: "include" })
    .then(async (response) => {
      if (response.status === 401 || response.status === 403) {
        sessionStorage.removeItem(RAIL_CACHE_KEY);
        window.location.replace("/index.html#login");
        return null;
      }
      if (response.status === 404) {
        sessionStorage.removeItem(RAIL_CACHE_KEY);
        window.location.replace("/orgs.html");
        return null;
      }
      if (!response.ok) {
        throw new Error((await response.text()) || "Failed to load policies.");
      }
      return response.json();
    })
    .then((data) => {
      if (!data) return;
      // Only re-render if the data actually changed; saves a paint flicker
      // when the cached state already matches the server.
      const serialized = JSON.stringify(data);
      const previous = sessionStorage.getItem(RAIL_CACHE_KEY);
      if (serialized !== previous) {
        sessionStorage.setItem(RAIL_CACHE_KEY, serialized);
        renderRail(container, data);
      } else if (!renderedFromCache) {
        renderRail(container, data);
      }
    })
    .catch((error) => {
      console.error("Policy fetch failed:", error);
      if (!renderedFromCache) {
        container.innerHTML = `<div class="policy-rail-loading">Couldn't load policies. ${escapeHtml(
          error.message || ""
        )}</div>`;
      }
    });
};

// Centralized render so cache-paint and fresh-paint stay in sync.
const renderRail = (container, data) => {
  const modules = data.modules || [];
  container.innerHTML = buildPolicyRail(modules);
  container.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
  updatePolicyTotal(modules, data.org, data.stats);
};

const buildPolicyRail = (modules) => {
  if (!modules.length) {
    return `<div class="policy-rail-loading">No modules yet for this organization.</div>`;
  }

  const moduleItems = modules
    .map((module) => {
      const policies = module.policies || [];
      const icon = module.image_url || ICON_BY_SLUG[module.slug] || "";
      const moduleAttrs = `data-module="${module.id}" data-module-name="${escapeHtml(
        module.name
      )}" data-module-description="${escapeHtml(module.description || "")}"`;
      return `
        <li class="policy-module-card reveal" ${moduleAttrs} data-link="#">
          <button class="rail-item" type="button">
            <span class="rail-title">
              ${escapeHtml(module.name)}
              <span class="rail-meta">${policies.length} ${policies.length === 1 ? "policy" : "policies"}</span>
            </span>
            ${icon ? `<img class="rail-icon" src="${icon}" alt="" aria-hidden="true" />` : ""}
          </button>
          <div class="flyout">
            <ul class="module-list">
              ${policies
                .map(
                  (policy) =>
                    `<li class="policy-item" data-policy-id="${policy.id}" data-policy-name="${escapeHtml(
                      policy.name
                    )}"><span class="policy-name">${escapeHtml(policy.name)}</span></li>`
                )
                .join("")}
            </ul>
          </div>
        </li>
      `;
    })
    .join("");

  return `
    <aside class="policy-rail">
      <ul class="rail-list">
        ${moduleItems}
      </ul>
    </aside>
  `;
};

const updatePolicyTotal = (modules, org, stats = {}) => {
  const uploaded = Number.isFinite(Number(stats.uploaded)) ? Number(stats.uploaded) : 0;
  const label = document.querySelector("[data-policy-total]");
  if (label) {
    const moduleCount = modules.length;
    label.textContent = `${moduleCount} ${moduleCount === 1 ? "module" : "modules"} | ${uploaded} ${
      uploaded === 1 ? "policy" : "policies"
    }`;
  }
  const kicker = document.querySelector(".policy-kicker");
  if (kicker && org?.name) {
    kicker.textContent = org.name;
  }
};

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

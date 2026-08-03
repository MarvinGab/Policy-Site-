// Renders the employee policy page for an organization on /policies.html.
// Pulls the modules + policies from the API for the org specified in ?org=<id>.
// If no org param is given (e.g. someone hits /policies.html directly), bounces to /orgs.html.
//
// Two presentations share this payload — module cards, or the Direct Policy +
// Genie view — selected by the org's policy_display_mode.

import { buildDirectView, initDirectView } from "./direct-view.js";

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

// ─── Rail states (loading / empty / error) ──────────────────────────────
//
// One centred block for every non-content state, so an empty shelf and a
// failed fetch read as the same considered surface rather than a stray line
// of text. The mark is a stack of policy sheets — the thing this product is
// actually made of — tinted per state instead of a generic warning glyph.

const SHEETS_MARK = `
  <svg class="rail-state__mark" viewBox="0 0 56 56" aria-hidden="true">
    <rect class="rail-state__sheet rail-state__sheet--back" x="12" y="6" width="30" height="38" rx="3" />
    <rect class="rail-state__sheet rail-state__sheet--mid" x="9" y="10" width="34" height="38" rx="3" />
    <rect class="rail-state__sheet rail-state__sheet--front" x="6" y="14" width="38" height="36" rx="3" />
    <line class="rail-state__rule" x1="13" y1="24" x2="33" y2="24" />
    <line class="rail-state__rule" x1="13" y1="31" x2="37" y2="31" />
    <line class="rail-state__rule" x1="13" y1="38" x2="28" y2="38" />
  </svg>`;

// `tone` drives colour only; the copy carries the meaning.
const railState = ({ tone = "idle", title, body = "", action = null }) => `
  <div class="rail-state rail-state--${tone}" role="status">
    ${SHEETS_MARK}
    <p class="rail-state__title">${escapeHtml(title)}</p>
    ${body ? `<p class="rail-state__body">${escapeHtml(body)}</p>` : ""}
    ${
      action
        ? `<a class="rail-state__action" href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`
        : ""
    }
  </div>`;

/**
 * Turn a fetch failure into something the reader can act on.
 *
 * The server's own wording is written for an API caller ("Organization
 * context is required."), which tells a person nothing about what to do.
 * The one case worth naming is a missing org: it is the difference between
 * "something broke" and "you opened this page without picking an org yet".
 */
const errorState = (message) => {
  if (/organization context/i.test(message)) {
    return railState({
      tone: "idle",
      title: "Pick an organisation to continue",
      body: "This page shows one organisation's policies at a time, and none is selected. Open the portal from your HRMS, or choose one below.",
      action: { href: "/orgs.html", label: "Choose an organisation" },
    });
  }
  return railState({
    tone: "error",
    title: "Policies didn't load",
    body: message
      ? `${message} Refresh to try again.`
      : "Refresh to try again. If it keeps happening, contact your HR team.",
  });
};

export const initPolicyRender = () => {
  if (document.body?.dataset.page !== "policies") return;
  document.body.dataset.displayMode = "loading";

  const container = document.querySelector("[data-policy-grid]");
  if (!container) return;

  // Do not pre-paint cached policy data. The org can switch between module
  // and direct display modes, and painting stale cache is exactly how the old
  // floating Genie flashes before the fresh config arrives.
  container.innerHTML = railState({
    tone: "loading",
    title: "Loading policies",
  });

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
      if (serialized !== previous) sessionStorage.setItem(RAIL_CACHE_KEY, serialized);
      renderRail(container, data);
    })
    .catch((error) => {
      console.error("Policy fetch failed:", error);
      container.innerHTML = errorState(error.message || "");
      // The floating admin shortcuts all need an org context too, so on a
      // no-org error they would every one of them fail the same way. Hide
      // them and let the state block carry the single next step.
      document.body.dataset.railState = "error";
    });
};

// Centralized render so cache-paint and fresh-paint stay in sync.
//
// One of two presentations, chosen by the organization's policy_display_mode
// (carried on data.org, since /api/org/settings is manager-only). Both are
// fed the same payload — direct view flattens the modules it is given rather
// than loading policies of its own.
const renderRail = (container, data) => {
  const modules = data.modules || [];
  const displayMode = data.org?.policy_display_mode === "direct" ? "direct" : "module";
  // Drives the CSS that hides the floating assistant in direct mode and
  // relaxes the dashboard's own width constraints.
  document.body.dataset.displayMode = displayMode;

  if (displayMode === "direct") {
    container.innerHTML = buildDirectView(data);
    initDirectView(container);
  } else {
    container.innerHTML = buildPolicyRail(modules);
  }
  container.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
  updatePolicyTotal(modules, data.org, data.stats);
};

const buildPolicyRail = (modules) => {
  if (!modules.length) {
    // An empty shelf is an invitation, not a dead end — but only admins can
    // act on it, so the action is gated by the same attribute the header
    // shortcuts use rather than dangling a link employees can't follow.
    return railState({
      tone: "idle",
      title: "No policies published yet",
      body: "Once your HR team adds policy documents, they'll appear here grouped by topic.",
    });
  }

  const moduleItems = modules
    .map((module) => {
      const policies = module.policies || [];
      const icon = module.image_url || ICON_BY_SLUG[module.slug] || "";
      const moduleAttrs = `data-module="${module.id}" data-module-name="${escapeHtml(
        module.name
      )}" data-module-description="${escapeHtml(module.description || "")}"`;
      return `
        <li class="policy-module-card reveal" ${moduleAttrs} data-reorder-id="${escapeHtml(module.id)}" data-link="#">
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
    const policyText = `${uploaded} ${uploaded === 1 ? "policy" : "policies"}`;
    label.textContent = org?.policy_display_mode === "direct"
      ? policyText
      : `${moduleCount} ${moduleCount === 1 ? "module" : "modules"} | ${policyText}`;
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

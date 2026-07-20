import "./security.js";
import { initAuth } from "./auth.js";
import { initHeader } from "./header.js";
import { initModules } from "./modules.js";
import { initPolicyRender } from "./policy-render.js";
import { initReveal } from "./reveal.js";
import { initState } from "./state.js";
import { initAdmin } from "./admin.js";
import { initThemes } from "./themes.js";
import { initChatbot } from "./chatbot.js";

const loadComponents = async () => {
  const includes = Array.from(document.querySelectorAll("[data-include]"));
  if (!includes.length) return;

  await Promise.all(
    includes.map(async (element) => {
      const response = await fetch(element.dataset.include);
      const html = await response.text();
      element.outerHTML = html;
    })
  );

  // After all components are in the DOM, snap the admin shell to the right
  // initial state BEFORE the page paints. Otherwise pages reached via FAB
  // navigation (#people / #settings / etc.) briefly flash the Modules
  // section + "Modules" title before initAdmin can swap them.
  if (document.body?.dataset.page === "policy-admin") {
    applyInitialAdminState();
  }
};

// Pre-paint setup for the admin page: section + page title from the hash.
const ADMIN_TAB_TITLES = {
  modules: "Modules",
  admins: "Admins",
  people: "People",
  communication: "Communication",
  email: "Email",
  hrms: "HRMS Access",
  settings: "Settings",
};

const applyInitialAdminState = () => {
  const requested = ((window.location.hash || "#modules").slice(1).split("?")[0]) || "modules";
  const sections = Array.from(document.querySelectorAll("[data-admin-section]"));
  const target = sections.find((s) => s.dataset.adminSection === requested) || sections[0];
  if (target) target.classList.add("is-active");
  const titleEl = document.querySelector("[data-admin-title]");
  if (titleEl) titleEl.textContent = ADMIN_TAB_TITLES[requested] || "Manage organization";
};

// Small "← All organizations" link tucked above the main content on an org's
// subdomain. Super-admin-only (auth.js strips elements with this data attr
// for everyone else). Replaces the chunky pill that used to live in the header.
const injectOrgBackLink = () => {
  const main = document.querySelector("main");
  if (!main || main.querySelector(".org-back-link")) return;
  const host = window.location.host;
  const localhostIndex = host.indexOf("localhost");
  const rootHost = localhostIndex >= 0 ? host.slice(localhostIndex) : host.replace(/^[^.]+\./, "");
  const href = `${window.location.protocol}//${rootHost}/orgs.html`;
  const link = document.createElement("a");
  link.className = "org-back-link";
  link.href = href;
  link.dataset.superAdminOnly = "";
  link.setAttribute("aria-label", "Back to organizations");
  link.innerHTML = `<span aria-hidden="true">‹</span>`;
  main.prepend(link);
};

const hydrateHeader = (page) => {
  const headerLinks = document.querySelector('[data-slot="header-links"]');
  const headerCtas = document.querySelector('[data-slot="header-ctas"]');
  if (!headerLinks || !headerCtas) return;

  if (page === "login-only") {
    headerLinks.innerHTML = "";
    headerCtas.innerHTML = "";
    return;
  }

  if (page === "orgs") {
    headerLinks.innerHTML = "";
    headerCtas.innerHTML = `<button class="btn ghost" id="logout">Logout</button>`;
    return;
  }

  if (page === "policies") {
    headerLinks.innerHTML = `
      <div class="rail-search-field" data-rail-search-field>
        <input
          type="search"
          class="rail-search-input"
          data-rail-search
          placeholder="Search policies"
          autocomplete="off"
          aria-label="Search policies"
          aria-autocomplete="list"
          aria-controls="rail-search-suggestions"
          aria-expanded="false"
        />
        <ul class="rail-search-suggestions" id="rail-search-suggestions" role="listbox" hidden></ul>
      </div>
    `;
    headerCtas.innerHTML = `
      <div class="header-policy">
        <span class="policy-kicker">Policy command center</span>
        <span class="policy-total" data-policy-total></span>
      </div>
      <button class="btn ghost" id="logout">Logout</button>
    `;
    injectOrgBackLink();
    return;
  }

  if (page === "policy-admin") {
    headerLinks.innerHTML = "";
    headerCtas.innerHTML = `
      <button class="btn ghost" id="logout">Logout</button>
    `;
    return;
  }

  headerLinks.innerHTML = `
    <a class="link" href="#how">How it works</a>
  `;
  headerCtas.innerHTML = `
    <button class="btn ghost" data-scroll="login">Sign in</button>
  `;
};

const hydrateFooter = (page) => {
  const footer = document.querySelector(".footer");
  if (!footer) return;

  const trustStrip = footer.querySelector('[data-slot="trust-strip"]');
  const footerText = footer.querySelector('[data-slot="footer-text"]');
  if (!trustStrip || !footerText) return;

  if (page === "policies" || page === "policy-admin") {
    // No footer on in-product pages — the trust badges and generic HR line
    // are marketing chrome that adds nothing here.
    footer.remove();
    return;
  }

  footer.removeAttribute("id");
  trustStrip.innerHTML = `
    <span>GDPR-ready</span>
    <span>SOC 2 aligned</span>
    <span>ISO 27001 practices</span>
    <span>Secure access logs</span>
  `;
  footerText.innerHTML = "policies.zarohr &mdash; empowering compliant teams.";
};

const applyDashboardAccessMode = async (page, session) => {
  if (page !== "policies" || session?.role !== "super_admin") return;
  try {
    const response = await fetch("/api/org/settings", { credentials: "include" });
    if (!response.ok) return;
    const data = await response.json();
    const mode = data.access_mode || "standalone";
    document.querySelectorAll("[data-access-mode-show]").forEach((element) => {
      element.classList.toggle("is-mode-visible", element.dataset.accessModeShow === mode);
    });
  } catch (error) {
    console.error("Access mode chrome failed:", error);
  }
};

const bootstrap = async () => {
  await loadComponents();
  const page = document.body?.dataset.page || "landing";
  hydrateHeader(page);
  hydrateFooter(page);
  initState();
  initHeader();
  const authState = await initAuth();
  if (["orgs", "policies", "policy-admin"].includes(page) && !authState?.authenticated) {
    return;
  }
  // Fire-and-forget: only toggles a CSS chip on FAB buttons, doesn't gate
  // anything the rail render needs. Keeping the await here adds ~300ms of
  // unnecessary serial latency before policy-render starts its own fetch.
  applyDashboardAccessMode(page, authState.session);
  initPolicyRender();
  initReveal();
  initModules();
  initAdmin();
  initThemes();
  if (page === "policies") {
    initChatbot();
  }
};

bootstrap();

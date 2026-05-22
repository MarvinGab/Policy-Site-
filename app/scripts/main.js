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
};

const hydrateHeader = (page) => {
  const headerLinks = document.querySelector('[data-slot="header-links"]');
  const headerCtas = document.querySelector('[data-slot="header-ctas"]');
  if (!headerLinks || !headerCtas) return;

  if (page === "orgs") {
    headerLinks.innerHTML = "";
    headerCtas.innerHTML = `<button class="btn ghost" id="logout">Logout</button>`;
    return;
  }

  if (page === "policies") {
    headerLinks.innerHTML = `
      <div class="header-policy">
        <span class="policy-kicker">Policy command center</span>
        <span class="policy-total" data-policy-total></span>
      </div>
    `;
    headerCtas.innerHTML = `<a class="btn ghost" href="orgs.html">All organizations</a><button class="btn ghost" id="logout">Logout</button>`;
    return;
  }

  if (page === "policy-admin") {
    headerLinks.innerHTML = `
      <div class="header-search" data-admin-search-wrap>
        <button class="header-search-btn" type="button" data-admin-search-trigger aria-label="Search policies">
          <span class="header-search-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"></circle>
              <line x1="16.65" y1="16.65" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round"></line>
            </svg>
          </span>
          <span class="sr-only">Search</span>
        </button>
        <input
          class="header-search-input"
          type="search"
          placeholder="Search policies"
          data-admin-search
          aria-label="Search policies"
        />
      </div>
    `;
    headerCtas.innerHTML = `<button class="btn ghost" id="logout">Logout</button>`;
    return;
  }

  headerLinks.innerHTML = `
    <a class="link" href="#how">How it works</a>
    <a class="link" href="#login">Support</a>
  `;
  headerCtas.innerHTML = `
    <button class="btn ghost" data-scroll="login">Login</button>
  `;
};

const hydrateFooter = (page) => {
  const footer = document.querySelector(".footer");
  if (!footer) return;

  const trustStrip = footer.querySelector('[data-slot="trust-strip"]');
  const footerText = footer.querySelector('[data-slot="footer-text"]');
  if (!trustStrip || !footerText) return;

  if (page === "policies" || page === "policy-admin") {
    footer.id = "support";
    trustStrip.innerHTML = `
      <span>Compliance support</span>
      <span>Security controls</span>
      <span>Access logging</span>
    `;
    footerText.textContent = "Need help? Contact HR support for access and policy guidance.";
    return;
  }

  footer.removeAttribute("id");
  trustStrip.innerHTML = `
    <span>GDPR-ready</span>
    <span>SOC 2 aligned</span>
    <span>ISO 27001 practices</span>
    <span>Secure access logs</span>
  `;
  footerText.innerHTML = "ZaRoHR HR Policy Portal &mdash; empowering compliant teams.";
};

const bootstrap = async () => {
  await loadComponents();
  const page = document.body?.dataset.page || "landing";
  hydrateHeader(page);
  hydrateFooter(page);
  initState();
  initHeader();
  initAuth();
  initPolicyRender();
  initReveal();
  initModules();
  initAdmin();
  initThemes();
  initChatbot();
};

bootstrap();

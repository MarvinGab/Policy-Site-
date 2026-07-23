(() => {
  const allowedThemes = new Set(["sky", "sand", "mint", "midnight", "carbon"]);
  try {
    // Purge the retired personal-theme key (pre-org-enforcement). Runs on every
    // page load so it's wiped from every browser that still carries it.
    window.localStorage.removeItem("zarohr-theme");
    // Root product pages (the org list) always use the default product theme —
    // never a leftover org theme cached under the shared localhost host.
    if (window.location.pathname.endsWith("/orgs.html")) return;
    // Org theme is cached per-host by auth.js so we can paint it before the
    // session round-trip and avoid a flash. Each org lives on its own host
    // (subdomain in prod), so the key never bleeds across orgs.
    const theme = window.localStorage.getItem("zarohr-theme:" + window.location.host);
    if (allowedThemes.has(theme)) {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    // Ignore storage errors; the app will fall back to the default theme.
  }
})();

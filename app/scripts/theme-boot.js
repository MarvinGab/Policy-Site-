(() => {
  const allowedThemes = new Set(["sky", "sand", "mint", "midnight", "carbon"]);
  try {
    const theme = window.localStorage.getItem("zarohr-theme");
    if (allowedThemes.has(theme)) {
      document.documentElement.setAttribute("data-theme", theme);
    }
  } catch {
    // Ignore storage errors; the app will fall back to the default theme.
  }
})();

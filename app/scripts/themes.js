const THEMES = [
  {
    id: "default",
    name: "Default",
    swatch: "linear-gradient(135deg, #3f68ff, #74b2ff)",
  },
  {
    id: "sky",
    name: "Sky",
    swatch: "linear-gradient(135deg, #5f7dff, #8ad0ff)",
  },
  {
    id: "sand",
    name: "Sand",
    swatch: "linear-gradient(135deg, #c8742f, #f2c07a)",
  },
  {
    id: "mint",
    name: "Mint",
    swatch: "linear-gradient(135deg, #1f8f6b, #7ddac2)",
  },
  {
    id: "midnight",
    name: "Midnight",
    swatch: "linear-gradient(135deg, #1a2340, #4f63ff)",
  },
  {
    id: "carbon",
    name: "Carbon",
    swatch: "linear-gradient(135deg, #12151c, #f08a4b)",
  },
];

const STORAGE_KEY = "zarohr-theme";

export const initThemes = () => {
  const applyTheme = (themeId) => {
    if (themeId === "default") {
      document.documentElement.removeAttribute("data-theme");
      document.body.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", themeId);
      document.body.setAttribute("data-theme", themeId);
    }
    localStorage.setItem(STORAGE_KEY, themeId);
  };

  const setTheme = (themeId) => {
    applyTheme(themeId);
    panel.querySelectorAll(".theme-option").forEach((option) => {
      option.classList.toggle("is-active", option.dataset.theme === themeId);
    });
  };

  const saved = localStorage.getItem(STORAGE_KEY);
  const defaultTheme = "default";
  const initialTheme = saved && THEMES.some((theme) => theme.id === saved) ? saved : defaultTheme;

  const themeButton = document.querySelector(".theme-btn");
  if (!themeButton) {
    applyTheme(initialTheme);
    return;
  }

  const panel = buildThemePanel();
  document.body.appendChild(panel);
  setTheme(initialTheme);

  const togglePanel = (force) => {
    const nextState = typeof force === "boolean" ? force : !panel.classList.contains("is-open");
    panel.classList.toggle("is-open", nextState);
    themeButton.setAttribute("aria-expanded", String(nextState));
  };

  themeButton.addEventListener("click", (event) => {
    event.preventDefault();
    togglePanel();
  });

  panel.addEventListener("click", (event) => {
    const option = event.target.closest(".theme-option");
    if (!option) return;
    setTheme(option.dataset.theme);
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest(".theme-panel")) return;
    if (event.target.closest(".theme-btn")) return;
    togglePanel(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") togglePanel(false);
  });
};

const buildThemePanel = () => {
  const panel = document.createElement("div");
  panel.className = "theme-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Select theme");
  panel.innerHTML = `
    <div class="theme-panel-head">Themes</div>
    <div class="theme-panel-grid"></div>
  `;

  const grid = panel.querySelector(".theme-panel-grid");
  THEMES.forEach((theme) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "theme-option";
    button.dataset.theme = theme.id;
    button.innerHTML = `
      <span class="theme-swatch"></span>
      <span class="theme-name">${theme.name}</span>
    `;
    const swatch = button.querySelector(".theme-swatch");
    swatch.style.background = theme.swatch;
    grid.appendChild(button);
  });

  return panel;
};

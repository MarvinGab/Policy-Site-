import { listPolicyDocuments } from "../lib/policy-upload.js";

export const initModules = () => {
  const moduleCards = document.querySelectorAll(".module-card");
  moduleCards.forEach((card, index) => {
    card.style.setProperty("--delay", `${index * 120}ms`);
  });

  const isPolicyPage = document.body?.dataset.page === "policies";
  if (!isPolicyPage) return;

  // Delegate from the rail container so handlers work even though the cards
  // are rendered later by policy-render.js (after the API call resolves).
  const container = document.querySelector("[data-policy-grid]");
  if (!container) return;

  container.addEventListener("click", (event) => {
    const card = event.target.closest(".policy-module-card");
    if (!card) return;
    if (event.target.closest(".module-list")) return;
    const link = card.dataset.link;
    if (link && link !== "#") {
      window.location.href = link;
    }
  });

  container.addEventListener("selectstart", (event) => {
    if (event.target.closest(".policy-rail")) event.preventDefault();
  });
  container.addEventListener("mousedown", (event) => {
    if (event.detail > 1 && event.target.closest(".policy-rail")) event.preventDefault();
  });

  container.addEventListener("dblclick", async (event) => {
    const item = event.target.closest(".policy-item");
    if (!item) {
      if (event.target.closest(".policy-rail")) event.preventDefault();
      return;
    }
    event.stopPropagation();
    const policyId = item.dataset.policyId;
    if (!policyId) return;
    await previewLatestDocument({ policyId, item });
  });

  // Rail search: type-ahead dropdown. As the user types, we build a flat list
  // of (module, policy) entries and render the top matches as suggestions
  // below the input. Click / Enter on a suggestion opens it directly —
  // policies preview the latest PDF, modules scroll into view + flash.
  initRailSearch(container);
};

const initRailSearch = (container) => {
  const search = document.querySelector("[data-rail-search]");
  const suggestions = document.getElementById("rail-search-suggestions");
  if (!search || !suggestions) return;

  let index = [];
  let activeIdx = -1;
  let currentMatches = [];

  const buildIndex = () => {
    index = [];
    container.querySelectorAll(".policy-module-card").forEach((card) => {
      // Strip the trailing "<n> policies" counter off the title text.
      const rawTitle = card.querySelector(".rail-title")?.textContent || "";
      const moduleName = rawTitle.replace(/\d+\s+polic(?:y|ies)\s*$/i, "").trim();
      index.push({
        type: "module",
        label: moduleName,
        meta: "Module",
        moduleId: card.dataset.module,
      });
      card.querySelectorAll(".policy-item").forEach((item) => {
        const policyName = (item.querySelector("span")?.textContent || item.textContent || "").trim();
        index.push({
          type: "policy",
          label: policyName,
          meta: moduleName,
          moduleId: card.dataset.module,
          policyId: item.dataset.policyId,
        });
      });
    });
  };

  const close = () => {
    suggestions.hidden = true;
    search.setAttribute("aria-expanded", "false");
    activeIdx = -1;
  };

  const highlight = (text, query) => {
    if (!query) return escape(text);
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx < 0) return escape(text);
    return `${escape(text.slice(0, idx))}<mark>${escape(text.slice(idx, idx + query.length))}</mark>${escape(text.slice(idx + query.length))}`;
  };

  const escape = (value = "") =>
    String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const render = (query) => {
    if (!query) {
      close();
      return;
    }
    const q = query.toLowerCase();
    const allMatches = index.filter((entry) => entry.label.toLowerCase().includes(q));
    // Policy names are what users actually search for; module/tile matches are
    // navigation hints. Show up to 7 policies first, then up to 3 modules if
    // there's room left within the 8-result cap.
    const policyMatches = allMatches.filter((m) => m.type === "policy").slice(0, 7);
    const moduleMatches = allMatches.filter((m) => m.type === "module").slice(0, 3);
    currentMatches = [...policyMatches, ...moduleMatches].slice(0, 8);
    if (!currentMatches.length) {
      suggestions.innerHTML = `<li class="rail-search-suggestions-empty">No matches</li>`;
      suggestions.hidden = false;
      search.setAttribute("aria-expanded", "true");
      activeIdx = -1;
      return;
    }
    activeIdx = 0;
    suggestions.innerHTML = currentMatches
      .map(
        (m, i) => `
        <li class="rail-search-suggestion${i === 0 ? " is-active" : ""}" role="option" data-idx="${i}">
          <span class="suggestion-icon" aria-hidden="true">${m.type === "module" ? "▢" : "·"}</span>
          <div class="suggestion-main">
            <span class="suggestion-label">${highlight(m.label, query)}</span>
            <span class="suggestion-meta">${escape(m.meta)}</span>
          </div>
        </li>`
      )
      .join("");
    suggestions.hidden = false;
    search.setAttribute("aria-expanded", "true");
  };

  const open = (entry) => {
    close();
    search.value = "";
    if (entry.type === "policy" && entry.policyId) {
      previewLatestDocument({ policyId: entry.policyId });
      return;
    }
    const card = container.querySelector(`.policy-module-card[data-module="${entry.moduleId}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: "smooth", block: "center" });
    card.classList.remove("is-flash");
    // Reflow forces the animation to restart even if the class was just present.
    void card.offsetWidth;
    card.classList.add("is-flash");
    setTimeout(() => card.classList.remove("is-flash"), 1700);
  };

  search.addEventListener("input", () => render(search.value.trim()));
  search.addEventListener("keydown", (event) => {
    if (suggestions.hidden) return;
    const items = suggestions.querySelectorAll(".rail-search-suggestion");
    if (!items.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIdx = (activeIdx + 1) % items.length;
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIdx = (activeIdx - 1 + items.length) % items.length;
    } else if (event.key === "Enter") {
      event.preventDefault();
      const match = currentMatches[activeIdx];
      if (match) open(match);
      return;
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    } else {
      return;
    }
    items.forEach((item, i) => item.classList.toggle("is-active", i === activeIdx));
    items[activeIdx]?.scrollIntoView({ block: "nearest" });
  });

  suggestions.addEventListener("click", (event) => {
    const li = event.target.closest(".rail-search-suggestion");
    if (!li) return;
    const match = currentMatches[Number(li.dataset.idx)];
    if (match) open(match);
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest("[data-rail-search-field]")) close();
  });

  // Rebuild the index whenever the rail re-renders (admin actions in flight).
  buildIndex();
  new MutationObserver(buildIndex).observe(container, { childList: true, subtree: true });
};

const previewLatestDocument = async ({ policyId, item }) => {
  // Subtle "we're opening this" state — a tiny inline spinner appears next to
  // the policy name while the fetch is in flight. No big overlay, no toast.
  item?.classList.add("is-opening");
  try {
    const files = await listPolicyDocuments({ policyId });
    if (!files.length) {
      showToast("No files uploaded for this policy.", "info");
      return;
    }
    const latest = files[0];
    const name = latest.file_path ? latest.file_path.split("/").pop() : "Document preview";
    openDocumentViewer({ url: latest.url, name });
  } catch (error) {
    console.error("Preview failed:", error);
    showToast("Unable to open document preview.", "error");
  } finally {
    item?.classList.remove("is-opening");
  }
};

const openDocumentViewer = ({ url, name }) => {
  if (!url) {
    showToast("Preview not available for this file.", "error");
    return;
  }
  const extension = String(name || "").split(".").pop()?.toLowerCase();
  const isPdf = extension === "pdf";
  const isDoc = extension === "doc" || extension === "docx";
  // PDFs: hide the side panel (thumbnails/outline) so the file shows as one
  // continuous scroll, not a paginated sidebar layout. FitH = fit page width.
  let viewerUrl = isPdf ? `${url}#toolbar=1&navpanes=0&scrollbar=1&view=FitH` : url;

  if (isDoc) {
    viewerUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
  }

  const modal = ensureViewerModal();
  const frame = modal.querySelector(".viewer-frame");
  const title = modal.querySelector(".viewer-title");
  const fallback = modal.querySelector(".viewer-fallback");
  const download = modal.querySelector("[data-viewer-download]");

  title.textContent = name || "Document preview";
  fallback.textContent = "";
  frame.style.opacity = "1";
  frame.src = viewerUrl;
  if (download) {
    download.href = url;
    download.setAttribute("download", name || "document");
  }
  modal.classList.add("is-visible");

  if (!isPdf && !isDoc) {
    fallback.textContent = "Preview not available for this file type.";
  }
};

const ensureViewerModal = () => {
  let modal = document.querySelector(".viewer-backdrop");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "viewer-backdrop";
  modal.innerHTML = `
    <div class="viewer" role="dialog" aria-modal="true">
      <div class="viewer-head">
        <span class="viewer-title"></span>
        <div class="viewer-actions">
          <a class="viewer-btn" data-viewer-download target="_blank" rel="noopener">Download</a>
          <button class="viewer-btn" type="button" data-viewer-close>Close</button>
        </div>
      </div>
      <div class="viewer-body">
        <iframe title="Document preview" class="viewer-frame"></iframe>
        <div class="viewer-fallback"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const close = () => {
    const frame = modal.querySelector(".viewer-frame");
    frame.src = "";
    frame.style.opacity = "1";
    modal.classList.remove("is-visible");
  };

  modal.addEventListener("click", (event) => {
    if (event.target === modal) close();
    if (event.target.closest("[data-viewer-close]")) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && modal.classList.contains("is-visible")) {
      close();
    }
  });

  return modal;
};

const showToast = (message, variant = "info") => {
  if (!message) return;
  let container = document.querySelector(".toast-container");
  if (!container) {
    container = document.createElement("div");
    container.className = "toast-container";
    document.body.appendChild(container);
  }
  const toast = document.createElement("div");
  toast.className = `toast toast--${variant}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add("toast--hide");
    setTimeout(() => toast.remove(), 300);
  }, 2400);
};

import { listPolicyDocuments } from "../lib/policy-upload.js";

// policyId → cached { url, file_path } | "pending" | null. Populated on
// hover so double-click has zero latency.
const prefetchedDocs = new Map();

const prefetchFileBlob = (url) => {
  if (!url) return;
  const link = document.createElement("link");
  link.rel = "prefetch";
  link.as = "fetch";
  link.href = url;
  link.crossOrigin = "anonymous";
  document.head.appendChild(link);
};

// Below this the rail is a stacked accordion; above it, hover flyouts.
// Kept in sync with the @media blocks in dashboard.css by hand — there is
// one breakpoint and both sides name it explicitly.
const TOUCH_LAYOUT = "(max-width: 980px)";

/**
 * Decide which side each flyout opens on, and bound it to the room actually
 * available there.
 *
 * The side used to come from `:nth-child(3n)`, which baked in a three-column
 * grid. Two things now make the index unusable: the column count responds to
 * the canvas, and a partial last row is centred — card 7 of 7 is the
 * rightmost card in a centred row of three, yet it is not a 4th child.
 *
 * The measured bounds are not belt-and-braces. Before them, a right-column
 * flyout at 1280px pushed the document to 1321px; `overflow-x: hidden` on
 * body turned that into silently clipped content rather than a visible bug.
 */
const layoutFlyouts = (container) => {
  const list = container.querySelector(".rail-list");
  if (!list) return;
  const cards = [...list.querySelectorAll(".policy-module-card")];
  if (!cards.length) return;

  if (window.matchMedia(TOUCH_LAYOUT).matches) {
    // Stacked: no side to choose and nothing to bound, but the toggle state
    // still needs to be announced.
    cards.forEach((card) => {
      card.removeAttribute("data-flyout");
      card.style.removeProperty("--flyout-space");
      card.style.removeProperty("--flyout-vspace");
      card
        .querySelector(".rail-item")
        ?.setAttribute("aria-expanded", String(card.classList.contains("is-open")));
    });
    return;
  }

  const cols = Number.parseInt(getComputedStyle(list).getPropertyValue("--rail-cols"), 10) || 3;
  const edge = 16; // Breathing room against the viewport edge.

  cards.forEach((card, index) => {
    card.classList.remove("is-open");
    const item = card.querySelector(".rail-item");
    item?.removeAttribute("aria-expanded");

    const lastInRow = (index + 1) % cols === 0 || index === cards.length - 1;
    card.dataset.flyout = lastInRow ? "left" : "right";

    const rect = card.getBoundingClientRect();
    const side = lastInRow ? rect.left : window.innerWidth - rect.right;
    card.style.setProperty("--flyout-space", `${Math.max(240, Math.floor(side - 24 - edge))}px`);
    card.style.setProperty(
      "--flyout-vspace",
      `${Math.max(200, Math.floor(window.innerHeight - rect.top - edge))}px`
    );
  });
};

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

  // The cards are rendered later by policy-render.js (after the API call) and
  // re-rendered when the cached payload changes, so watch the container
  // rather than measuring once at init.
  let frame = 0;
  const scheduleLayout = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => layoutFlyouts(container));
  };
  new MutationObserver(scheduleLayout).observe(container, { childList: true, subtree: true });
  window.addEventListener("resize", scheduleLayout);
  scheduleLayout();

  // Touch equivalent of the hover flyout: tap a card to open its policies,
  // one at a time. Registered before the navigation handler below so an
  // accordion tap doesn't also count as a card activation.
  container.addEventListener("click", (event) => {
    if (!window.matchMedia(TOUCH_LAYOUT).matches) return;
    const item = event.target.closest(".rail-item");
    if (!item) return;
    const card = item.closest(".policy-module-card");
    if (!card) return;
    const wasOpen = card.classList.contains("is-open");
    container.querySelectorAll(".policy-module-card.is-open").forEach((open) => {
      open.classList.remove("is-open");
      open.querySelector(".rail-item")?.setAttribute("aria-expanded", "false");
    });
    if (!wasOpen) {
      card.classList.add("is-open");
      item.setAttribute("aria-expanded", "true");
    }
  });

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

  // Hover prefetch: as soon as the pointer lingers on a policy row, ask the
  // server for its signed URL and drop a <link rel="prefetch"> so the browser
  // starts pulling the PDF from Supabase Storage in the background. When the
  // user actually double-clicks, both the URL fetch AND the file blob are
  // usually already cached, so the viewer opens near-instantly.
  container.addEventListener("mouseover", (event) => {
    const item = event.target.closest(".policy-item");
    if (!item) return;
    const policyId = item.dataset.policyId;
    if (!policyId || prefetchedDocs.has(policyId)) return;
    prefetchedDocs.set(policyId, "pending");
    listPolicyDocuments({ policyId })
      .then((files) => {
        const latest = files?.[0];
        prefetchedDocs.set(policyId, latest || null);
        if (latest?.url) prefetchFileBlob(latest.url);
      })
      .catch(() => prefetchedDocs.delete(policyId));
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
    container.querySelectorAll(".doc-row").forEach((row) => {
      const policyName = (row.querySelector(".doc-row__name-text")?.textContent || row.textContent || "").trim();
      if (!policyName) return;
      index.push({
        type: "policy",
        label: policyName,
        meta: "Policy",
        policyId: row.dataset.policyId,
        direct: true,
      });
    });
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

  const filterDirectRows = (query) => {
    const rows = [...container.querySelectorAll(".doc-row")];
    if (!rows.length) return;
    const q = query.toLowerCase();
    rows.forEach((row) => {
      const name = (row.querySelector(".doc-row__name-text")?.textContent || row.textContent || "").toLowerCase();
      row.hidden = Boolean(q) && !name.includes(q);
    });
  };

  const render = (query) => {
    filterDirectRows(query);
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
      const directRow = entry.direct
        ? container.querySelector(`.doc-row[data-policy-id="${CSS.escape(entry.policyId)}"]`)
        : null;
      directRow?.scrollIntoView({ behavior: "smooth", block: "center" });
      directRow?.classList.remove("is-flash");
      if (directRow) {
        void directRow.offsetWidth;
        directRow.classList.add("is-flash");
        setTimeout(() => directRow.classList.remove("is-flash"), 1700);
      }
      previewLatestDocument({ policyId: entry.policyId, item: directRow || undefined });
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

/**
 * Open a policy's most recent document in the shared viewer.
 *
 * Exported so Direct Policy View can reuse this exact path — same prefetch
 * cache, same viewer modal, same toasts. There is deliberately no second
 * viewer implementation.
 */
export const previewLatestDocument = async ({ policyId, item }) => {
  item?.classList.add("is-opening");
  try {
    // Hit the hover-prefetch cache first — usually populated by the time
    // the user has moved from hover to double-click.
    let latest = null;
    const cached = prefetchedDocs.get(policyId);
    if (cached && cached !== "pending") latest = cached;
    if (!latest) {
      const files = await listPolicyDocuments({ policyId });
      if (!files.length) { showToast("No files uploaded for this policy.", "info"); return; }
      latest = files[0];
      prefetchedDocs.set(policyId, latest);
    }
    if (!latest) { showToast("No files uploaded for this policy.", "info"); return; }
    // Skip the outer catch/try for the original files variable
    const files = [latest];
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

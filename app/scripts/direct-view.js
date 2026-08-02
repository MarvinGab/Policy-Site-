// Direct Policy + Genie view — the presentation an organization gets when
// policy_display_mode = "direct".
//
// Three states, one attribute (data-state on .direct-view):
//
//   browsing  full policy library + composer. Conversation is NOT rendered,
//             even when history exists. Always the state on page load.
//   genie     library compresses to a shallow full-width shelf; the
//             conversation becomes an internally-scrolling region so the
//             document height stops growing.
//   history   same workspace, older turns revealed on demand.
//
// Nothing here touches retrieval or answer generation — askGenie() is the
// same /api/chat call the floating assistant makes.

import { previewLatestDocument } from "./modules.js";
import {
  askGenie,
  cleanBotMessage,
  loadGenieConversation,
  saveChatHistory,
  syncGenieStorage,
  toApiHistory,
} from "./chatbot.js";

// Safety bounds only — the actual recent-turn count is measured (see
// computeWindow). Two or fewer turns are never folded.
const MIN_TURNS = 1;
const MAX_TURNS = 8;
const ALWAYS_SHOW_UP_TO = 2;

const escapeHtml = (value = "") =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const DOC_ICON = `
  <svg class="doc-row__glyph" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h4" />
  </svg>`;

// The same animated character the Module View's floating toggle uses —
// .bot-face + .bot-hand from chatbot.css, so the waving hand and the float
// come along with it. Reused rather than re-drawn so Genie is one identity
// across both display modes; only the scale differs here.
const GENIE_MARK = `<span class="genie-mark" aria-hidden="true"><span class="bot-face"></span><span class="bot-hand"></span></span>`;

export const flattenPolicies = (modules = []) => {
  const seen = new Set();
  const out = [];
  modules.forEach((module) => {
    (module.policies || []).forEach((policy) => {
      if (!policy?.id || seen.has(policy.id)) return;
      seen.add(policy.id);
      out.push({ id: policy.id, name: policy.name || "Untitled policy" });
    });
  });
  return out;
};

const docRow = (p) => `
  <li class="doc-row" data-policy-id="${escapeHtml(p.id)}">
    <button class="doc-row__btn" type="button">
      <span class="doc-row__icon">${DOC_ICON}</span>
      <span class="doc-row__name" tabindex="-1"><span class="doc-row__name-text">${escapeHtml(p.name)}</span></span>
      <span class="doc-row__go" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
      </span>
    </button>
  </li>`;

export const buildDirectView = (data = {}) => {
  const policies = flattenPolicies(data.modules || []);
  const list = policies.length
    ? `<ul class="shelf__list">${policies.map(docRow).join("")}</ul>`
    : `<p class="shelf__empty">No policies published yet.</p>`;

  return `
    <div class="direct-view" data-direct data-state="browsing">
      <!-- Shelf and library are one element. Collapsing changes its height
           and density, never its width — that horizontal jump is what made
           the previous compact state read as an awkward centred box. -->
      <section class="shelf" data-shelf>
        <div class="shelf__bar">
          <span class="shelf__title">Policies</span>
          <span class="shelf__count">${policies.length}</span>
          <div class="shelf__chips" data-shelf-chips>
            ${policies
              .map(
                (p) =>
                  `<button class="chip" type="button" data-policy-id="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`
              )
              .join("")}
          </div>
          <button class="shelf__toggle" type="button" data-shelf-toggle>
            <span data-shelf-label>View all</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
          </button>
        </div>
        <div class="shelf__body">${list}</div>
      </section>

      <section class="genie" data-genie>
        <div class="genie__scroll" data-genie-scroll>
          <button class="genie__earlier" type="button" data-history-toggle hidden>
            <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            <span data-history-label>Earlier conversation</span>
            <span class="genie__earlier-count" data-history-count></span>
          </button>
          <div class="genie__turns" data-genie-thread role="log" aria-live="polite"></div>
        </div>

        <form class="composer" data-genie-form>
          <label class="sr-only" for="genie-input">Ask about your company policies</label>
          ${GENIE_MARK}
          <textarea class="composer__input" id="genie-input" data-genie-input rows="1"
            placeholder="Ask about leave, holidays, POSH..." required></textarea>
          <button class="composer__send" type="submit" aria-label="Send">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
          </button>
        </form>
      </section>
    </div>`;
};

/** Escaped first, then grouped — model output is never treated as markup. */
const formatAnswer = (text = "") => {
  const blocks = [];
  let para = [];
  let bullets = [];
  const flushP = () => { if (para.length) { blocks.push(`<p>${para.map(escapeHtml).join("<br />")}</p>`); para = []; } };
  const flushB = () => { if (bullets.length) { blocks.push(`<ul>${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`); bullets = []; } };
  String(text).split("\n").forEach((raw) => {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) { flushP(); bullets.push(bullet[1]); return; }
    flushB();
    if (!line) { flushP(); return; }
    para.push(line);
  });
  flushP(); flushB();
  return blocks.join("") || `<p>${escapeHtml(text)}</p>`;
};

const turnMarkup = ({ question, answer }, { pending = false } = {}) => `
  <article class="turn${pending ? " is-pending" : ""}">
    <p class="turn__role">You</p>
    <p class="turn__q">${escapeHtml(question)}</p>
    <p class="turn__role turn__role--genie">${GENIE_MARK}Genie</p>
    <div class="turn__a" data-genie-body>${formatAnswer(answer)}</div>
  </article>`;

const toExchanges = (history = []) => {
  const turns = [];
  for (let i = 0; i < history.length; i += 1) {
    if (history[i]?.variant !== "user") continue;
    const reply = history[i + 1]?.variant === "bot" ? history[i + 1] : null;
    turns.push({ question: history[i].text, answer: reply?.text || "…" });
  }
  return turns;
};

export const initDirectView = (container) => {
  const root = container.querySelector("[data-direct]");
  if (!root) return;

  const genie = root.querySelector("[data-genie]");
  const scroll = root.querySelector("[data-genie-scroll]");
  const thread = root.querySelector("[data-genie-thread]");
  const earlier = root.querySelector("[data-history-toggle]");
  const earlierCount = root.querySelector("[data-history-count]");
  const earlierLabel = root.querySelector("[data-history-label]");
  const shelfToggle = root.querySelector("[data-shelf-toggle]");
  const shelfLabel = root.querySelector("[data-shelf-label]");
  const form = root.querySelector("[data-genie-form]");
  const input = root.querySelector("[data-genie-input]");
  const send = root.querySelector(".composer__send");

  let history = loadGenieConversation();
  let state = "browsing";
  let visibleTurns = ALWAYS_SHOW_UP_TO;
  let retuning = false;

  const flagOverflowingPolicyNames = () => {
    root.querySelectorAll(".doc-row__name").forEach((name) => {
      const text = name.querySelector(".doc-row__name-text");
      const overflowing = Boolean(text && text.scrollWidth > name.clientWidth + 1);
      name.classList.toggle("is-overflowing", overflowing);
      if (text) text.style.setProperty("--policy-name-window", `${name.clientWidth}px`);
    });
  };

  /**
   * Recent turns that fit the scroll region. Measured because it depends on
   * how tall this org's answers actually render — the constants are only
   * floor and ceiling.
   */
  const computeWindow = () => {
    const total = toExchanges(history).length;
    if (total <= ALWAYS_SHOW_UP_TO) return total;
    const avail = scroll?.clientHeight || 0;
    if (!avail) return visibleTurns;
    const rendered = [...thread.querySelectorAll(".turn")].map((n) => n.offsetHeight).filter(Boolean);
    const per = rendered.length ? rendered.reduce((a, b) => a + b, 0) / rendered.length + 28 : 190;
    return Math.max(MIN_TURNS, Math.min(total, MAX_TURNS, Math.floor(avail / per) + 1));
  };

  const setState = (next) => {
    if (state === next) return;
    state = next;
    root.dataset.state = next;
    // Mirrored onto body so the dashboard's own bottom padding can stand
    // down while the workspace owns the viewport — otherwise that padding
    // is added below a full-height workspace and the page scrolls.
    document.body.dataset.genieState = next;
    if (shelfLabel) shelfLabel.textContent = next === "browsing" ? "View all" : "Expand";
    render();
    requestAnimationFrame(retune);
  };

  const render = () => {
    const turns = toExchanges(history);

    // Browsing renders no conversation at all. History still lives in
    // storage; it simply isn't the page's subject until Genie is engaged.
    if (state === "browsing") {
      thread.innerHTML = "";
      earlier.hidden = true;
      return;
    }

    const showAll = state === "history";
    const recent = showAll ? turns : turns.slice(-visibleTurns);
    const olderCount = turns.length - recent.length;

    thread.innerHTML = recent.map((t) => turnMarkup(t)).join("");

    if (olderCount > 0 || showAll) {
      earlier.hidden = turns.length <= ALWAYS_SHOW_UP_TO;
      earlierCount.textContent = showAll ? "" : `${olderCount}`;
      earlierLabel.textContent = showAll ? "Show recent only" : "Earlier conversation";
    } else {
      earlier.hidden = true;
    }
  };

  const retune = () => {
    if (retuning || state === "browsing") return;
    retuning = true;
    for (let i = 0; i < 3; i += 1) {
      const next = computeWindow();
      if (next === visibleTurns) break;
      visibleTurns = next;
      render();
    }
    retuning = false;
  };

  const toBottom = () => {
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  };

  render();
  requestAnimationFrame(flagOverflowingPolicyNames);

  syncGenieStorage().then((synced) => {
    if (!synced.length && !history.length) return;
    history = synced;
    render();
  });

  // ── State transitions ───────────────────────────────────────────────────

  input?.addEventListener("focus", () => setState("genie"));

  // "View all" is an explicit request to browse — and the deliberate way out
  // of the workspace, for people who don't discover click-outside.
  shelfToggle?.addEventListener("click", () => setState("browsing"));

  earlier?.addEventListener("click", () => setState(state === "history" ? "genie" : "history"));

  /**
   * Symmetrical exit. Focus alone is the wrong signal — clicking an answer or
   * the history control blurs the textarea but is still working with Genie.
   * Only real chat controls/content are protected; blank gutters in the Genie
   * section should behave like outside clicks and reopen the policies.
   */
  document.addEventListener("pointerdown", (event) => {
    if (state === "browsing") return;
    if (event.target.closest("[data-genie-form], [data-genie-thread], [data-history-toggle]")) return;
    if (event.target.closest(".viewer-backdrop")) return;
    setState("browsing");
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state !== "browsing") setState("browsing");
  });

  // ── Composer ────────────────────────────────────────────────────────────

  const autoGrow = () => {
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  };
  input?.addEventListener("input", autoGrow);
  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    form?.requestSubmit();
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input?.value.trim();
    if (!question) return;

    // Submitting always keeps the workspace open.
    setState("genie");
    input.value = "";
    autoGrow();
    input.disabled = true;
    if (send) send.disabled = true;

    history.push({ text: question, variant: "user" });
    saveChatHistory(history);
    render();
    toBottom();

    const turn = thread.lastElementChild;
    turn?.classList.add("is-pending");
    if (turn) turn.querySelector("[data-genie-body]").innerHTML = "<p>Thinking…</p>";

    const requestHistory = toApiHistory(history).slice(-6);
    try {
      history.push({ text: await askGenie({ question, history: requestHistory }), variant: "bot" });
    } catch (error) {
      history.push({ text: cleanBotMessage(error?.message || "Unable to answer right now."), variant: "bot" });
    } finally {
      saveChatHistory(history);
      render();
      retune();
      toBottom();
      input.disabled = false;
      if (send) send.disabled = false;
      input.focus();
    }
  });

  let frame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      retune();
      flagOverflowingPolicyNames();
    });
  });

  // Policy rows and shelf chips both open the existing viewer.
  container.addEventListener("click", (event) => {
    const trigger = event.target.closest(".doc-row__btn, .chip");
    if (!trigger) return;
    const item = trigger.closest(".doc-row") || trigger;
    const policyId = item?.dataset.policyId || trigger.dataset.policyId;
    if (policyId) previewLatestDocument({ policyId, item });
  });
};

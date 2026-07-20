export const initChatbot = () => {
  const chatbot = document.querySelector("[data-chatbot]");
  if (!chatbot) return;

  const toggle = chatbot.querySelector(".chatbot-toggle");
  const panel = chatbot.querySelector(".chatbot-panel");
  const close = chatbot.querySelector(".chatbot-close");
  const form = chatbot.querySelector(".chatbot-form");
  const input = chatbot.querySelector(".chatbot-input");
  const messages = chatbot.querySelector(".chatbot-messages");
  const sendButton = chatbot.querySelector(".chatbot-send");
  const logout = document.getElementById("logout");
  let history = loadChatHistory();

  if (messages) {
    renderChatHistory(messages, history);
  }

  resolveChatStorageKey().then((storageKey) => {
    if (!storageKey || storageKey === activeChatStorageKey) return;
    activeChatStorageKey = storageKey;
    history = loadChatHistory();
    if (messages) renderChatHistory(messages, history);
  });

  const setOpen = (isOpen) => {
    chatbot.classList.toggle("is-open", isOpen);
    toggle.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      input?.focus();
    }
  };

  toggle?.addEventListener("click", () => {
    const next = !chatbot.classList.contains("is-open");
    setOpen(next);
  });

  close?.addEventListener("click", () => setOpen(false));

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-chatbot]")) return;
    setOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") setOpen(false);
  });

  input?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    form?.requestSubmit();
  });

  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!input || !messages) return;
    const text = input.value.trim();
    if (!text) return;
    input.disabled = true;
    if (sendButton) sendButton.disabled = true;
    appendMessage(messages, text, "user");
    history.push({ text, variant: "user" });
    saveChatHistory(history);
    input.value = "";
    const pending = appendMessage(messages, "Thinking...", "bot", { pending: true });
    const requestHistory = toApiHistory(history).slice(-6);
    messages.scrollTop = messages.scrollHeight;
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ question: text, history: requestHistory }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const contentType = response.headers.get("content-type") || "";
          const payload = contentType.includes("application/json")
            ? await response.json().catch(() => null)
            : null;
          const message = payload?.answer || payload?.message || await response.text();
          throw new Error(message || "Unable to answer right now.");
        }
        return response.json();
      })
      .then((data) => {
        const answer = cleanBotMessage(data?.answer || "I don't have enough information to answer that.");
        pending.classList.remove("is-pending");
        pending.textContent = answer;
        history.push({ text: answer, variant: "bot" });
        saveChatHistory(history);
      })
      .catch((error) => {
        const message = cleanBotMessage(error?.message || "Unable to answer right now.");
        pending.classList.remove("is-pending");
        pending.textContent = message;
        history.push({ text: message, variant: "bot" });
        saveChatHistory(history);
      })
      .finally(() => {
        input.disabled = false;
        if (sendButton) sendButton.disabled = false;
        input.focus();
        messages.scrollTop = messages.scrollHeight;
      });
  });

  logout?.addEventListener("click", () => {
    localStorage.removeItem(activeChatStorageKey);
  });
};

const appendMessage = (container, text, variant, options = {}) => {
  const row = document.createElement("div");
  row.className = `chatbot-message-row ${variant}`;
  if (variant === "bot") {
    const avatar = document.createElement("div");
    avatar.className = "chatbot-avatar";
    avatar.setAttribute("aria-hidden", "true");
    const face = document.createElement("span");
    face.className = "bot-face";
    avatar.appendChild(face);
    row.appendChild(avatar);
  }
  const message = document.createElement("div");
  message.className = `chatbot-message ${variant}`;
  if (options.pending) message.classList.add("is-pending");
  message.textContent = text;
  row.appendChild(message);
  container.appendChild(row);
  return message;
};

const CHAT_STORAGE_PREFIX = "policy-chat-history-v5";
let activeChatStorageKey = `${CHAT_STORAGE_PREFIX}:${window.location.hostname || "local"}`;

const resolveChatStorageKey = async () => {
  try {
    const response = await fetch("/api/session", { credentials: "include" });
    if (!response.ok) return activeChatStorageKey;
    const session = await response.json();
    const orgKey = session?.companyId || session?.selectedCompany?.id || window.location.hostname || "local";
    return `${CHAT_STORAGE_PREFIX}:${orgKey}`;
  } catch {
    return activeChatStorageKey;
  }
};

const cleanBotMessage = (value = "") => {
  const text = String(value || "").trim();
  if (!text) return "Unable to answer right now.";
  if (text.startsWith("{")) {
    try {
      const parsed = JSON.parse(text);
      if (parsed?.answer) return cleanBotMessage(parsed.answer);
      if (parsed?.message) return cleanBotMessage(parsed.message);
    } catch {
      // Keep falling through to generic cleanup.
    }
  }
  if (/^failed to fetch$/i.test(text)) {
    return "The chat connection failed. Please try again.";
  }
  return text;
};

const shouldDropHistoryItem = (item) => {
  const text = String(item?.text || "").trim();
  if (!text) return true;
  return (
    text === "Unable to answer question." ||
    /^failed to fetch$/i.test(text) ||
    /^The chat connection failed/i.test(text) ||
    /^The chat service took too long to respond/i.test(text) ||
    /^Not in the uploaded policies/i.test(text) ||
    /^I could not search the policies right now/i.test(text) ||
    /^\{"answer":/i.test(text)
  );
};

const loadChatHistory = () => {
  try {
    const stored = localStorage.getItem(activeChatStorageKey);
    const parsed = stored ? JSON.parse(stored) : [];
    if (Array.isArray(parsed) && parsed.length) {
      const cleaned = parsed
        .filter((item) => !shouldDropHistoryItem(item))
        .map((item) => ({
          ...item,
          text: item?.variant === "bot" ? cleanBotMessage(item.text) : item.text,
        }));
      if (cleaned.length !== parsed.length || cleaned.some((item, index) => item.text !== parsed[index]?.text)) {
        saveChatHistory(cleaned);
      }
      return cleaned.length ? cleaned : [{ text: "Hi! How can I help you?", variant: "bot" }];
    }
  } catch (error) {
    console.warn("Failed to load chat history:", error);
  }
  return [{ text: "Hi! How can I help you?", variant: "bot" }];
};

const saveChatHistory = (history) => {
  try {
    localStorage.setItem(activeChatStorageKey, JSON.stringify(history));
  } catch (error) {
    console.warn("Failed to save chat history:", error);
  }
};

const toApiHistory = (history = []) =>
  history
    .filter((item) => item?.text && (item.variant === "user" || item.variant === "bot"))
    .map((item) => ({
      role: item.variant === "bot" ? "assistant" : "user",
      text: item.text,
    }));

const renderChatHistory = (container, history) => {
  container.innerHTML = "";
  history.forEach((item) => {
    if (!item?.text || !item?.variant) return;
    appendMessage(container, item.text, item.variant);
  });
};

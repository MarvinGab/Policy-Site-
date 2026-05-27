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
  const history = loadChatHistory();

  if (messages) {
    renderChatHistory(messages, history);
  }

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
    messages.scrollTop = messages.scrollHeight;
    fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ question: text }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const message = await response.text();
          throw new Error(message || "Unable to answer right now.");
        }
        return response.json();
      })
      .then((data) => {
        const answer = data?.answer || "I don't have enough information to answer that.";
        pending.classList.remove("is-pending");
        pending.textContent = answer;
        history.push({ text: answer, variant: "bot" });
        saveChatHistory(history);
      })
      .catch((error) => {
        const message = error?.message || "Unable to answer right now.";
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
    localStorage.removeItem(CHAT_STORAGE_KEY);
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

const CHAT_STORAGE_KEY = "policy-chat-history-v2";

const loadChatHistory = () => {
  try {
    const stored = localStorage.getItem(CHAT_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];
    if (Array.isArray(parsed) && parsed.length) {
      const cleaned = parsed.filter((item) => item?.text !== "Unable to answer question.");
      return cleaned.length ? cleaned : [{ text: "Hi! How can I help you?", variant: "bot" }];
    }
  } catch (error) {
    console.warn("Failed to load chat history:", error);
  }
  return [{ text: "Hi! How can I help you?", variant: "bot" }];
};

const saveChatHistory = (history) => {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(history));
  } catch (error) {
    console.warn("Failed to save chat history:", error);
  }
};

const renderChatHistory = (container, history) => {
  container.innerHTML = "";
  history.forEach((item) => {
    if (!item?.text || !item?.variant) return;
    appendMessage(container, item.text, item.variant);
  });
};

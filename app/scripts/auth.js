export const initAuth = async () => {
  // The server is the authority on subdomain vs root (it runs the Host-header
  // → company resolution). Ask it directly. While we wait (<50ms typical),
  // the login card is kept invisible via [data-login-mode="loading"] so we
  // never flash the wrong form.
  const loginSection = document.getElementById("login");
  const loginForm = document.getElementById("login-form");

  let mode = "password"; // safe default
  if (loginSection) {
    loginSection.dataset.loginMode = "loading";
    try {
      const ctx = await fetch("/api/auth/context", { credentials: "include" });
      if (ctx.ok) {
        const data = await ctx.json();
        if (["password", "magic", "hrms_only"].includes(data.mode)) mode = data.mode;
      }
    } catch (err) {
      console.error("Auth context fetch failed; defaulting to password mode:", err);
    }
    loginSection.dataset.loginMode = mode;
    // hrms_only: hide the entire form, show the HRMS-only message.
    if (mode === "hrms_only") {
      if (loginForm) loginForm.hidden = true;
      document.querySelector("[data-login-hrms]")?.removeAttribute("hidden");
      return { authenticated: false };
    }
  }

  if (loginForm) {
    const submitBtn = loginForm.querySelector("[data-submit]");
    const submitLabel = loginForm.querySelector("[data-submit-label]");
    const titleEl = document.querySelector("[data-login-title]");
    const subEl = document.querySelector("[data-login-sub]");
    const toggle = loginForm.querySelector("[data-password-toggle]");
    const passwordInput = loginForm.querySelector("[data-password]");
    const sentPanel = document.querySelector("[data-login-sent]");
    const sentTo = document.querySelector("[data-sent-to]");
    const devLinkWrap = document.querySelector("[data-dev-link]");
    const devLinkAnchor = document.querySelector("[data-dev-link-anchor]");
    const resendBtn = document.querySelector("[data-resend]");
    const banner = document.querySelector("[data-login-banner]");
    const bannerTitle = document.querySelector("[data-banner-title]");
    const bannerMessage = document.querySelector("[data-banner-message]");
    let lastEmail = "";

    // Mode-specific copy + behavior.
    if (mode === "magic") {
      if (titleEl) titleEl.textContent = "Sign in";
      if (subEl) subEl.textContent = "Enter your email — we'll send a one-time sign-in link.";
      if (submitLabel) submitLabel.textContent = "Send sign-in link";
      // Password field is hidden via CSS [data-login-mode=magic] [data-password-field].
      // Remove the required attribute too so HTML validation doesn't block submit.
      passwordInput?.removeAttribute("required");
    } else {
      if (titleEl) titleEl.textContent = "Sign in";
      if (subEl) subEl.textContent = "Admin sign-in. Use your work email and password.";
      if (submitLabel) submitLabel.textContent = "Sign in";
    }

    // Query-param error from a failed /auth/link click (browser mismatch,
    // expired, etc.) is surfaced as a banner above the form.
    const params = new URLSearchParams(window.location.search);
    const loginError = params.get("login_error");
    if (loginError && banner) {
      const map = {
        device: ["Open this link from the right device", "This sign-in link was issued for a different browser. Enter your email below to get a fresh link on this device."],
        expired: ["This link has expired", "Magic links work for 15 minutes after they're requested. Enter your email to get a new one."],
        used: ["Link already used", "This sign-in link has already been used. Enter your email to get a new one."],
        missing: ["Invalid sign-in link", "We couldn't find this sign-in link. Request a new one below."],
      };
      const [title, message] = map[loginError] || ["Sign-in failed", "Request a new sign-in link below."];
      if (bannerTitle) bannerTitle.textContent = title;
      if (bannerMessage) bannerMessage.textContent = message;
      banner.hidden = false;
    }

    if (toggle && passwordInput) {
      toggle.addEventListener("click", () => {
        const showing = passwordInput.type === "text";
        passwordInput.type = showing ? "password" : "text";
        toggle.setAttribute("aria-pressed", showing ? "false" : "true");
        toggle.setAttribute("aria-label", showing ? "Show password" : "Hide password");
      });
    }

    const showSent = (email, devLink) => {
      loginForm.hidden = true;
      if (sentPanel) sentPanel.hidden = false;
      if (sentTo) sentTo.textContent = email;
      if (devLink && devLinkWrap && devLinkAnchor) {
        devLinkAnchor.href = devLink;
        devLinkWrap.hidden = false;
      } else if (devLinkWrap) {
        devLinkWrap.hidden = true;
      }
    };

    const requestLink = async (email) =>
      fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        credentials: "include",
      });

    resendBtn?.addEventListener("click", async () => {
      if (!lastEmail) return;
      try {
        const response = await requestLink(lastEmail);
        if (response.ok) {
          const data = await response.json();
          if (data?.magic_link_sent) showSent(lastEmail, data.dev_link);
        }
      } catch (err) {
        console.error("Resend failed:", err);
      }
    });

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const email = String(formData.get("email") || "").trim().toLowerCase();
      const password = mode === "password" ? String(formData.get("password") || "") : "";
      const error = document.getElementById("login-error");
      if (error) error.textContent = "";
      lastEmail = email;

      if (submitBtn) submitBtn.dataset.loading = "true";

      try {
        const body = mode === "password" ? { email, password } : { email };
        const response = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });

        if (!response.ok) {
          const message = await response.text();
          if (error) error.textContent = message || "Sign-in failed.";
          return;
        }

        const data = await response.json();
        if (data?.redirect) {
          window.location.href = data.redirect;
          return;
        }
        if (data?.magic_link_sent) {
          showSent(data.email || email, data.dev_link);
          return;
        }
      } catch (err) {
        if (error) error.textContent = "Sign-in failed. Try again.";
        console.error("Login failed:", err);
      } finally {
        if (submitBtn) delete submitBtn.dataset.loading;
      }
    });
  }

  // Pages behind the gate verify the session client-side and bounce to login if cookie is gone.
  const protectedPages = new Set(["orgs", "policies", "policy-admin"]);
  const page = document.body?.dataset.page;
  let session = null;
  if (protectedPages.has(page)) {
    try {
      const response = await fetch("/api/session", { credentials: "include" });
      if (!response.ok) {
        window.location.replace("index.html#login");
        return { authenticated: false };
      }
      session = await response.json();
      document.body.dataset.role = session.role || "employee";
      applyRoleAccess(session.role || "employee", page);
      window.dispatchEvent(new CustomEvent("role-ready", { detail: session }));
      if (page === "policies") {
        verifyOrgAccess();
      }
    } catch (err) {
      console.error("Session check failed:", err);
      window.location.replace("index.html#login");
      return { authenticated: false };
    }
  }

  const logout = document.getElementById("logout");
  if (logout) {
    logout.addEventListener("click", async () => {
      try {
        await fetch("/api/logout", { method: "POST", credentials: "include" });
      } catch (err) {
        console.error("Logout failed:", err);
      }
      // Wipe any SWR caches so the next user on this browser doesn't see the
      // previous org's data flash before their own loads.
      try { sessionStorage.clear(); } catch { /* ignore quota errors */ }
      window.location.href = "index.html";
    });
  }
  return { authenticated: !protectedPages.has(page) || Boolean(session), session };
};

const isAdminRole = (role) => role === "admin" || role === "super_admin";

const applyRoleAccess = (role, page) => {
  const canManage = isAdminRole(role);
  const isSuperAdmin = role === "super_admin";
  document.querySelectorAll("[data-admin-only], [data-org-admin-only], [data-module-admin-only], [data-people-admin-only]").forEach((element) => {
    if (!canManage) element.remove();
  });
  document.querySelectorAll("[data-super-admin-only], [data-super-admin-section]").forEach((element) => {
    if (!isSuperAdmin) element.remove();
  });

  if (page === "policy-admin" && !canManage) {
    window.location.replace("policies.html");
  }
};

const verifyOrgAccess = () => {
  fetch("/api/org/access", { credentials: "include" })
    .then((response) => {
      if (response.status === 403 || response.status === 404) {
        window.location.replace("index.html#login");
      }
    })
    .catch((error) => {
      console.error("Org access check failed:", error);
    });
};

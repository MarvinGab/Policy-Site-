export const initAuth = async () => {
  // The server is the authority on root vs org access mode (it runs the
  // Host-header → company resolution). Ask it directly. While we wait (<50ms typical),
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
        if (["password", "magic", "standalone", "hrms_only"].includes(data.mode)) mode = data.mode;
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

  // Calm setup-screen greeting rotation with separate exit/entry phases.
  const welcomeEl = document.querySelector("[data-welcome]");
  if (welcomeEl) {
    const words = ["Welcome", "Bonjour", "Hola", "Ciao", "Olá", "こんにちは", "你好"];
    let i = 0;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduceMotion) window.setInterval(() => {
      welcomeEl.classList.remove("is-entering");
      welcomeEl.classList.add("is-leaving");
      setTimeout(() => {
        i = (i + 1) % words.length;
        welcomeEl.textContent = words[i];
        welcomeEl.classList.remove("is-leaving");
        welcomeEl.classList.add("is-entering");
      }, 480);
    }, 3400);
  }

  if (loginForm) {
    const submitBtn = loginForm.querySelector("[data-submit]");
    const submitLabel = loginForm.querySelector("[data-submit-label]");
    const titleEl = document.querySelector("[data-login-title]");
    const subEl = document.querySelector("[data-login-sub]");
    const toggle = loginForm.querySelector("[data-password-toggle]");
    const passwordInput = loginForm.querySelector("[data-password]");
    const identifierInput = loginForm.querySelector("[data-email]");
    const identifierLabel = loginForm.querySelector("[data-identifier-label]");
    const forgotStart = loginForm.querySelector("[data-forgot-start]");
    const resetForm = document.querySelector("[data-reset-form]");
    const resetSend = resetForm?.querySelector("[data-reset-send]");
    const resetSendLabel = resetSend?.querySelector("[data-reset-send-label]");
    const resetOtpStep = resetForm?.querySelector("[data-reset-otp-step]");
    const resetPasswordStep = resetForm?.querySelector("[data-reset-password-step]");
    const resetVerify = resetForm?.querySelector("[data-reset-verify]");
    const resetVerifyLabel = resetForm?.querySelector("[data-reset-verify-label]");
    const resetCancel = resetForm?.querySelector("[data-reset-cancel]");
    const resetMessage = resetForm?.querySelector("[data-reset-message]");
    const sentPanel = document.querySelector("[data-login-sent]");
    const sentTo = document.querySelector("[data-sent-to]");
    const devLinkWrap = document.querySelector("[data-dev-link]");
    const devLinkAnchor = document.querySelector("[data-dev-link-anchor]");
    const resendBtn = document.querySelector("[data-resend]");
    const banner = document.querySelector("[data-login-banner]");
    const bannerTitle = document.querySelector("[data-banner-title]");
    const bannerMessage = document.querySelector("[data-banner-message]");
    let lastEmail = "";
    let otpCooldownTimer = null;
    let otpCooldownRemaining = 0;
    let passwordResetToken = "";

    const orgField = loginForm.querySelector("[data-org-field]");
    const orgInput = loginForm.querySelector("[data-org]");

    // Mode differences are behavioral only — label copy stays put ("Employee
    // code or email", set in login.html) so we don't restate the same idea
    // in the subtitle / placeholder / label three times.
    if (mode === "standalone") {
      identifierInput?.setAttribute("autocomplete", "username");
      passwordInput?.setAttribute("required", "required");
      if (orgField) orgField.hidden = true;
      if (forgotStart) forgotStart.hidden = false;
    } else {
      if (orgField) orgField.hidden = true;
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

    forgotStart?.addEventListener("click", () => {
      loginForm.hidden = true;
      if (resetForm) resetForm.hidden = false;
      if (resetOtpStep) resetOtpStep.hidden = false;
      if (resetPasswordStep) resetPasswordStep.hidden = true;
      passwordResetToken = "";
      const resetIdentifier = resetForm?.querySelector("[name='identifier']");
      if (resetIdentifier) resetIdentifier.disabled = false;
      if (resetIdentifier) resetIdentifier.value = String(identifierInput?.value || "");
      resetIdentifier?.focus();
    });

    resetCancel?.addEventListener("click", () => {
      if (resetForm) resetForm.hidden = true;
      loginForm.hidden = false;
      if (resetMessage) resetMessage.textContent = "";
      passwordResetToken = "";
      identifierInput?.focus();
    });

    const renderOtpSendState = () => {
      if (!resetSend || !resetSendLabel) return;
      resetSend.disabled = otpCooldownRemaining > 0;
      resetSendLabel.textContent = otpCooldownRemaining > 0
        ? `Sent - resend in ${otpCooldownRemaining}s`
        : "Resend OTP";
    };

    const startOtpCooldown = () => {
      if (otpCooldownTimer) window.clearInterval(otpCooldownTimer);
      otpCooldownRemaining = 10;
      renderOtpSendState();
      otpCooldownTimer = window.setInterval(() => {
        otpCooldownRemaining -= 1;
        renderOtpSendState();
        if (otpCooldownRemaining <= 0) {
          window.clearInterval(otpCooldownTimer);
          otpCooldownTimer = null;
        }
      }, 1000);
    };

    resetSend?.addEventListener("click", async () => {
      if (!resetForm || !resetMessage || resetSend.disabled) return;
      const formData = new FormData(resetForm);
      const identifier = String(formData.get("identifier") || "").trim();
      resetMessage.textContent = "";
      if (!identifier) {
        resetMessage.textContent = "Enter your employee code or email.";
        return;
      }
      resetSend.disabled = true;
      if (resetSendLabel) resetSendLabel.textContent = "Sending...";
      try {
        const response = await fetch("/api/password/forgot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier }),
          credentials: "include",
        });
        const text = await response.text();
        if (!response.ok) {
          resetMessage.textContent = text || "Could not send OTP.";
          resetSend.disabled = false;
          if (resetSendLabel) resetSendLabel.textContent = "Send OTP";
          return;
        }
        const data = text ? JSON.parse(text) : {};
        resetMessage.textContent = `OTP sent to ${data.sent_to || "your registered email"}.`;
        startOtpCooldown();
      } catch (err) {
        console.error("OTP request failed:", err);
        resetMessage.textContent = "Could not send OTP.";
        resetSend.disabled = false;
        if (resetSendLabel) resetSendLabel.textContent = "Send OTP";
      }
    });

    resetVerify?.addEventListener("click", async () => {
      if (!resetForm || !resetMessage || resetVerify.disabled) return;
      const formData = new FormData(resetForm);
      const identifier = String(formData.get("identifier") || "").trim();
      const otp = String(formData.get("otp") || "").trim();
      resetMessage.textContent = "";
      if (!/^\d{6}$/.test(otp)) {
        resetMessage.textContent = "Enter the 6-digit OTP.";
        return;
      }
      resetVerify.disabled = true;
      if (resetVerifyLabel) resetVerifyLabel.textContent = "Verifying...";
      try {
        const response = await fetch("/api/password/verify-otp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier, otp }),
          credentials: "include",
        });
        const text = await response.text();
        if (!response.ok) {
          resetMessage.textContent = text || "OTP is invalid or expired.";
          return;
        }
        const data = text ? JSON.parse(text) : {};
        passwordResetToken = String(data.reset_token || "");
        if (!passwordResetToken) throw new Error("Missing password reset token.");
        const resetIdentifier = resetForm.querySelector("[name='identifier']");
        if (resetIdentifier) resetIdentifier.disabled = true;
        if (resetOtpStep) resetOtpStep.hidden = true;
        if (resetPasswordStep) resetPasswordStep.hidden = false;
        resetMessage.textContent = "OTP verified. Set your new password.";
        resetForm.querySelector("[name='password']")?.focus();
      } catch (err) {
        console.error("OTP verification failed:", err);
        resetMessage.textContent = "Could not verify OTP. Please try again.";
      } finally {
        resetVerify.disabled = false;
        if (resetVerifyLabel) resetVerifyLabel.textContent = "Verify OTP";
      }
    });

    resetForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!resetMessage) return;
      const formData = new FormData(resetForm);
      const password = String(formData.get("password") || "");
      const confirmPassword = String(formData.get("confirm_password") || "");
      resetMessage.textContent = "";
      if (!passwordResetToken) {
        resetMessage.textContent = "Verify your OTP first.";
        return;
      }
      if (password.length < 8) {
        resetMessage.textContent = "Password must be at least 8 characters.";
        return;
      }
      if (password !== confirmPassword) {
        resetMessage.textContent = "Passwords do not match.";
        return;
      }
      try {
        const response = await fetch("/api/password/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reset_token: passwordResetToken, password }),
          credentials: "include",
        });
        if (!response.ok) {
          resetMessage.textContent = await response.text() || "Could not reset password.";
          return;
        }
        resetMessage.textContent = "Password reset. Sign in with the new password.";
        resetForm.reset();
        passwordResetToken = "";
        const resetIdentifier = resetForm.querySelector("[name='identifier']");
        if (resetIdentifier) resetIdentifier.disabled = false;
        if (resetOtpStep) resetOtpStep.hidden = false;
        if (resetPasswordStep) resetPasswordStep.hidden = true;
        if (resetForm) resetForm.hidden = true;
        loginForm.hidden = false;
      } catch (err) {
        console.error("Password reset failed:", err);
        resetMessage.textContent = "Could not reset password.";
      }
    });

    // Pre-fill identifier from ?identifier=... — set by the root-domain
    // redirect after the user picked their org.
    try {
      const search = new URLSearchParams(
        window.location.hash.includes("?")
          ? window.location.hash.slice(window.location.hash.indexOf("?"))
          : window.location.search
      );
      const prefill = search.get("identifier");
      if (prefill && identifierInput && !identifierInput.value) {
        identifierInput.value = prefill;
        setTimeout(() => passwordInput?.focus(), 40);
      }
    } catch { /* URL parsing shouldn't ever block login */ }

    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const identifier = String(formData.get("email") || "").trim();
      const email = identifier.toLowerCase();
      const password = String(formData.get("password") || "");
      const organization = String(formData.get("organization") || "").trim();
      const error = document.getElementById("login-error");
      if (error) error.textContent = "";
      lastEmail = identifier;

      if (submitBtn) submitBtn.dataset.loading = "true";

      try {
        // Subdomain: send code/email + password. Root: send email + password
        // (super admin path), plus organization once the field is revealed.
        const body = mode === "standalone"
          ? { userid: identifier, password }
          : { email, password, ...(organization ? { organization } : {}) };
        const response = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          credentials: "include",
        });

        if (!response.ok) {
          let message = "";
          const bodyText = await response.text();
          let parsed = null;
          if (bodyText) {
            try {
              parsed = JSON.parse(bodyText);
            } catch {
              message = bodyText;
            }
          }
          if (parsed) {
            if (parsed?.error === "org_required") {
              // First-time reveal of the Organization field. Don't paint the
              // "error" red — this is progressive disclosure, not a failure.
              if (orgField) orgField.hidden = false;
              if (subEl) subEl.textContent = "Enter your organization to continue to its portal.";
              if (submitLabel) submitLabel.textContent = "Continue";
              orgInput?.focus();
              return;
            }
            message = parsed?.message || bodyText;
          }
          if (error) error.textContent = message || "Sign-in failed.";
          return;
        }

        const data = await response.json();
        if (data?.csrfToken) window.__csrfToken = data.csrfToken;
        // First-login gate: send them to the set-new-password screen instead
        // of the dashboard, so the temp password from the invite email dies
        // immediately.
        if (data?.must_reset_password) {
          showPasswordChangeForm();
          return;
        }
        if (data?.redirect) {
          window.location.href = data.redirect;
          return;
        }
      } catch (err) {
        if (error) {
          error.textContent = navigator.onLine
            ? "Could not reach the sign-in service. Please try again."
            : "You appear to be offline. Check your connection and try again.";
        }
        console.error("Login failed:", err);
      } finally {
        if (submitBtn) delete submitBtn.dataset.loading;
      }
    });

    // Inline first-login password change. Reuses the existing login card
    // shell so we don't have to add a whole new component. Session cookie
    // from the successful password login is what authenticates the change.
    function showPasswordChangeForm() {
      loginForm.hidden = true;
      if (resetForm) resetForm.hidden = true;
      if (sentPanel) sentPanel.hidden = true;
      const holder = loginSection?.querySelector("[data-first-login]") || document.createElement("form");
      if (!holder.dataset.firstLogin) {
        holder.dataset.firstLogin = "true";
        holder.className = "login-form";
        holder.innerHTML = `
          <div class="login-head">
            <h2>Set a new password</h2>
            <p class="login-sub">Your temporary password only works once. Pick a new one to continue.</p>
          </div>
          <label class="login-field">
            <span>New password</span>
            <input type="password" name="password" placeholder="At least 8 characters" autocomplete="new-password" required minlength="8" />
          </label>
          <label class="login-field">
            <span>Confirm password</span>
            <input type="password" name="confirm" placeholder="Repeat new password" autocomplete="new-password" required minlength="8" />
          </label>
          <button type="submit" class="btn primary login-submit">Save & continue</button>
          <p class="login-error" data-first-login-error role="alert"></p>
        `;
        loginSection?.querySelector(".login-card")?.appendChild(holder);
      }
      const form = holder;
      const errorEl = form.querySelector("[data-first-login-error]");
      form.onsubmit = async (event) => {
        event.preventDefault();
        errorEl.textContent = "";
        const pw = String(form.password?.value || "");
        const confirm = String(form.confirm?.value || "");
        if (pw.length < 8) { errorEl.textContent = "Password must be at least 8 characters."; return; }
        if (pw !== confirm) { errorEl.textContent = "Passwords don't match."; return; }
        try {
          const response = await fetch("/api/password/change", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: pw }),
            credentials: "include",
          });
          if (!response.ok) { errorEl.textContent = await response.text() || "Could not save password."; return; }
          // After the change, land wherever a normal login would.
          window.location.href = "policies.html";
        } catch (err) {
          console.error("Password change failed:", err);
          errorEl.textContent = "Could not save password. Try again.";
        }
      };
      form.querySelector("input[name='password']")?.focus();
    }
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
      if (session?.csrfToken) window.__csrfToken = session.csrfToken;
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

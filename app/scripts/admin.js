import { deletePolicyDocument, listPolicyDocuments, uploadPolicyDocument } from "../lib/policy-upload.js";

const readFileAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("File read failed."));
    reader.readAsDataURL(file);
  });

const apiJson = async (url, options = {}) => {
  const response = await fetch(url, {
    credentials: "include",
    headers: options.body instanceof FormData ? options.headers : { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try {
      const data = text ? JSON.parse(text) : {};
      message = data.email_error || data.error || data.message || text;
    } catch {
      // Plain-text API errors are already suitable to show.
    }
    throw new Error(message || `Request failed (${response.status})`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
};

export const initAdmin = () => {
  if (document.body?.dataset.page !== "policy-admin") return;

  const grid = document.querySelector("[data-admin-grid]");
  const adminsList = document.querySelector("[data-admins-list]");
  const adminsForm = document.querySelector("[data-admins-form]");
  const peopleList = document.querySelector("[data-people-list]");
  const moduleCreate = document.querySelector("[data-module-create]");
  const peopleForm = document.querySelector("[data-people-form]");
  const peopleFile = document.querySelector("[data-people-file]");
  const peopleModeNote = document.querySelector("[data-people-mode-note]");
  const emailForm = document.querySelector("[data-email-settings]");
  const templateForm = document.querySelector("[data-template-form]");
  const templateList = document.querySelector("[data-template-list]");
  const templateStatus = document.querySelector("[data-template-status]");
  const settingsForm = document.querySelector("[data-settings-form]");
  const brandingForm = document.querySelector("[data-branding-form]");
  const hrmsForm = document.querySelector("[data-hrms-settings]");
  const hrmsLaunchUrl = document.querySelector("[data-hrms-launch-url]");
  const hrmsSecret = document.querySelector("[data-hrms-secret]");
  const hrmsTestResult = document.querySelector("[data-hrms-test-result]");
  const searchInput = document.querySelector("[data-admin-search]");
  const filterButtons = Array.from(document.querySelectorAll("[data-admin-filter]"));
  const adminTitle = document.querySelector("[data-admin-title]");
  const currentRole = document.body?.dataset.role || "employee";
  const isSuperAdmin = currentRole === "super_admin";
  const tabTitles = {
    modules: "Modules",
    admins: "Org Admins",
    people: "People",
    communication: "Communication",
    email: "Email",
    hrms: "HRMS Access",
    settings: "Settings",
    branding: "Branding",
  };
  let activeFilter = "all";
  let policyData = [];
  let peopleData = [];
  let emailTemplates = [];
  let activeTemplateId = null;
  let accessMode = "standalone";
  let orgLoginUrl = "";
  let hrmsSettings = null;

  const isSectionAllowed = (section) => {
    if (section !== "modules" && !isSuperAdmin) return false;
    if (section === "branding") return true;
    if (section === "people" || section === "communication" || section === "email") {
      return accessMode !== "hrms_link";
    }
    if (section === "hrms") return accessMode === "hrms_link";
    return Boolean(tabTitles[section]);
  };

  // Apply the org's current access mode to the chrome: show/hide standalone-only
  // affordances (Email tab, password toast) and refresh the People mode hint.
  const applyAccessMode = () => {
    document.querySelectorAll("[data-mode-show]").forEach((element) => {
      element.classList.toggle("is-mode-visible", element.dataset.modeShow === accessMode);
    });
    if (peopleModeNote) {
      peopleModeNote.textContent =
        accessMode === "hrms_link"
          ? "HRMS Tile mode — people are managed by the HRMS and this section is hidden."
          : "Standalone mode — employee code + email are required. New employees get a temporary password.";
    }
    const activeSection = document.querySelector("[data-admin-section].is-active")?.dataset.adminSection || "modules";
    if (!isSectionAllowed(activeSection)) {
      activateTab(accessMode === "hrms_link" ? "hrms" : "settings");
    }
  };

  // Keep the org's public login URL ready for the compact Standalone copy action.
  const renderOrgLoginUrl = async () => {
    const copyBtn = document.querySelector("[data-action='copy-org-url']");
    if (!copyBtn) return;
    const standaloneRadio = settingsForm?.querySelector('input[name="access_mode"][value="standalone"]');
    if (!standaloneRadio?.checked) { copyBtn.hidden = true; return; }
    try {
      const url = orgLoginUrl || (await apiJson("/api/org/settings")).login_url;
      if (!url) { copyBtn.hidden = true; return; }
      orgLoginUrl = url;
      copyBtn.hidden = false;
    } catch {
      copyBtn.hidden = true;
    }
  };

  const loadSettings = async () => {
    try {
      const data = await apiJson("/api/org/settings");
      accessMode = data.access_mode || "standalone";
      orgLoginUrl = data.login_url || "";
      if (settingsForm) {
        const radio = settingsForm.querySelector(`input[name="access_mode"][value="${accessMode}"]`);
        if (radio) radio.checked = true;
        const branding = data.branding || {};
        const setValue = (name, value) => { const input = settingsForm.elements[name]; if (input && value) input.value = value; };
        setValue("theme_id", branding.theme_id || "default");
        setValue("portal_name", branding.portal_name);
        setValue("login_background_color", branding.login_background_color);
        populateBranding(branding);
      }
      applyAccessMode();
      await renderOrgLoginUrl();
    } catch (error) {
      console.error("Settings load failed:", error);
    }
  };

  const loadModules = async () => {
    if (!grid) return;
    grid.innerHTML = `<div class="admin-empty">Loading modules...</div>`;
    try {
      const data = await apiJson("/api/org/policies?include_hidden=1");
      policyData = data.modules || [];
      renderAdminGrid(grid, policyData, searchInput?.value || "", activeFilter);
    } catch (error) {
      console.error("Module load failed:", error);
      grid.innerHTML = `<div class="admin-empty">${escapeHtml(error.message || "Unable to load modules.")}</div>`;
    }
  };

  const loadPeople = async () => {
    if (!peopleList) return;
    peopleList.innerHTML = `<div class="admin-empty">Loading people...</div>`;
    try {
      peopleData = await apiJson("/api/org/people");
      renderPeople(peopleList, peopleData);
    } catch (error) {
      console.error("People load failed:", error);
      peopleList.innerHTML = `<div class="admin-empty">${escapeHtml(error.message || "Unable to load people.")}</div>`;
    }
  };

  const loadAdmins = async () => {
    if (!adminsList || !isSuperAdmin) return;
    adminsList.innerHTML = `<div class="admin-empty">Loading admins...</div>`;
    try {
      const admins = await apiJson("/api/org/admins");
      renderPeople(adminsList, admins, { empty: "No org admins added yet.", adminList: true });
    } catch (error) {
      console.error("Admins load failed:", error);
      adminsList.innerHTML = `<div class="admin-empty">${escapeHtml(error.message || "Unable to load admins.")}</div>`;
    }
  };

  const loadEmailSettings = async () => {
    if (!emailForm) return;
    try {
      const data = await apiJson("/api/org/email-settings");
      const smtp = data.smtp || {};
      setField(emailForm, "host", smtp.host || "");
      setField(emailForm, "port", smtp.port || "");
      setField(emailForm, "username", smtp.username || "");
      setField(emailForm, "from_email", smtp.from_email || "");
      setField(emailForm, "from_name", smtp.from_name || "");
    } catch (error) {
      console.error("Email settings load failed:", error);
    }
  };

  const renderHrmsSettings = (data = {}) => {
    hrmsSettings = data;
    if (hrmsForm) {
      const enabled = hrmsForm.querySelector('input[name="enabled"]');
      const origin = hrmsForm.querySelector('input[name="allowed_origin"]');
      if (enabled) enabled.checked = data.enabled === true;
      if (origin) origin.value = data.allowed_origin || "";
    }
    if (hrmsLaunchUrl) hrmsLaunchUrl.textContent = data.launch_url_template || "Launch URL unavailable.";
    if (hrmsSecret) hrmsSecret.textContent = data.launch_secret || "Generate by saving HRMS settings.";
    if (hrmsTestResult) {
      hrmsTestResult.textContent = data.enabled
        ? "Ready to test with the generated sample launch URL."
        : "Enable HRMS launch and save settings before testing.";
    }
  };

  const loadHrmsSettings = async () => {
    if (!hrmsForm && !hrmsLaunchUrl) return;
    try {
      const data = await apiJson(isSuperAdmin ? "/api/org/hrms-settings" : "/api/org/hrms-launch-config");
      renderHrmsSettings(data);
    } catch (error) {
      console.error("HRMS launch config load failed:", error);
      if (hrmsLaunchUrl) hrmsLaunchUrl.textContent = error.message || "Unable to load HRMS launch URL.";
    }
  };

  const activateTab = (tab) => {
    const [requestedTab = "modules", query = ""] = String(tab || "modules").split("?");
    const brandingMode = requestedTab === "branding";
    const sectionTab = requestedTab;
    const nextTab = isSectionAllowed(sectionTab) ? sectionTab : "modules";
    document.querySelectorAll("[data-admin-section]").forEach((section) => {
      section.classList.toggle("is-active", section.dataset.adminSection === nextTab);
      section.classList.toggle("is-branding-view", false);
    });
    if (adminTitle) adminTitle.textContent = brandingMode ? "Branding" : (tabTitles[nextTab] || "Manage organization");
    // Branding view: the section's own "Branding" legend is the heading, so
    // the shared admin head (duplicate H1 + old back pill) is hidden via CSS.
    document.body.classList.toggle("admin-branding", brandingMode);
    settingsForm?.classList.toggle("branding-mode", brandingMode);
    const normalizedHash = query ? `#${nextTab}?${query}` : `#${nextTab}`;
    if (window.location.hash !== normalizedHash) window.history.replaceState(null, "", normalizedHash);
    if (nextTab === "modules" && query.includes("create=1")) {
      setTimeout(() => document.querySelector("[data-module-create] input[name='name']")?.focus(), 50);
    }
    if (nextTab === "modules") {
      loadModules();
    }
    if (nextTab === "admins") {
      loadAdmins();
    }
    if (nextTab === "people") {
      loadPeople();
    }
    if (nextTab === "email") {
      loadEmailSettings();
    }
    if (nextTab === "hrms") {
      loadHrmsSettings();
    }
    if (nextTab === "communication") {
      loadEmailTemplates();
    }
    // Upload-sheet button only makes sense on the People page.
    document.querySelectorAll("[data-people-only]").forEach((el) => {
      el.hidden = nextTab !== "people";
    });
    // Collapse any open register panels when leaving the People tab.
    if (nextTab !== "people") {
      document.querySelectorAll("[data-register-panel]").forEach((p) => (p.hidden = true));
      document.querySelectorAll("[data-register-toggle]").forEach((b) => b.setAttribute("aria-expanded", "false"));
    }
  };

  // ---- Branding controls: theme swatches, background mode, image uploads ----
  const bgModeInput = brandingForm?.elements.login_background_mode;
  const colorPicker = brandingForm?.querySelector("[data-color-picker]");
  const colorHex = brandingForm?.elements.login_background_color;
  // Tracks whether the admin explicitly removed a stored image (vs just not
  // re-picking one), so save knows when to send "" to clear it server-side.
  const brandingState = { logoCleared: false, bgCleared: false };
  let savedBrandingSnapshot = null;
  const normalizeBranding = (branding = {}) => ({
    theme_id: branding.theme_id || "default",
    portal_name: (branding.portal_name || "").trim(),
    login_background_color: branding.login_background_color || "",
    login_background_image_url: branding.login_background_image_url || "",
    logo_url: branding.logo_url || "",
  });
  const getCurrentBrandingSnapshot = () => {
    if (!brandingForm) return normalizeBranding();
    const mode = bgModeInput?.value || "theme";
    const bgFile = brandingForm.elements.login_background_file?.files?.[0];
    const logoFile = brandingForm.elements.logo_file?.files?.[0];
    return {
      theme_id: brandingForm.elements.theme_id?.value || "default",
      portal_name: (brandingForm.elements.portal_name?.value || "").trim(),
      login_background_color: mode === "color" ? (brandingForm.elements.login_background_color?.value || "").trim() : "",
      login_background_image_url: mode === "image"
        ? bgFile?.name || (brandingState.bgCleared ? "" : savedBrandingSnapshot?.login_background_image_url || "")
        : "",
      logo_url: logoFile?.name || (brandingState.logoCleared ? "" : savedBrandingSnapshot?.logo_url || ""),
    };
  };
  const setBrandingDirty = (dirty) => {
    const save = brandingForm?.querySelector("[data-save-branding]");
    const discard = brandingForm?.querySelector("[data-discard-branding]");
    [save, discard].forEach((button) => {
      if (!button) return;
      button.toggleAttribute("disabled", !dirty);
      button.hidden = !dirty;
    });
  };
  const updateBrandingDirty = () => {
    setBrandingDirty(JSON.stringify(getCurrentBrandingSnapshot()) !== JSON.stringify(savedBrandingSnapshot || normalizeBranding()));
  };

  const setThemeSwatch = (themeId) => {
    if (!brandingForm) return;
    const value = themeId || "default";
    brandingForm.elements.theme_id.value = value;
    brandingForm.querySelectorAll("[data-theme-swatches] .swatch").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.theme === value));
    });
    window.__orgTheme = value;
    if (value === "default") {
      document.documentElement.removeAttribute("data-theme");
      document.body.removeAttribute("data-theme");
    } else {
      document.documentElement.dataset.theme = value;
      document.body.dataset.theme = value;
    }
  };

  const setBgMode = (mode) => {
    const value = ["theme", "color", "image"].includes(mode) ? mode : "theme";
    if (bgModeInput) bgModeInput.value = value;
    brandingForm?.querySelectorAll("[data-bg-mode] .seg-option").forEach((btn) => {
      btn.setAttribute("aria-pressed", String(btn.dataset.bgOption === value));
    });
    brandingForm?.querySelectorAll("[data-bg-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.bgPanel !== value;
    });
  };

  const setUploadName = (field, name) => {
    const label = brandingForm?.querySelector(`[data-upload-name="${field}"]`);
    const clear = brandingForm?.querySelector(`[data-upload-clear="${field}"]`);
    if (label) label.textContent = name || "No file chosen";
    if (clear) clear.hidden = !name;
  };

  const showPreview = (field, src) => {
    const wrap = brandingForm?.querySelector(`[data-preview="${field}"]`);
    const img = wrap?.querySelector("img");
    if (src) { if (img) img.src = src; if (wrap) wrap.hidden = false; }
    else { if (img) img.removeAttribute("src"); if (wrap) wrap.hidden = true; }
  };

  const populateBranding = (branding = {}) => {
    if (!brandingForm) return;
    setThemeSwatch(branding.theme_id || "default");
    if (brandingForm.elements.portal_name) brandingForm.elements.portal_name.value = branding.portal_name || "";
    const color = branding.login_background_color || "";
    const bgImage = branding.login_background_image_url || "";
    if (color) {
      if (colorHex) colorHex.value = color;
      if (colorPicker && /^#[0-9a-f]{6}$/i.test(color)) colorPicker.value = color;
    } else if (colorHex) {
      colorHex.value = "";
    }
    setBgMode(bgImage ? "image" : color ? "color" : "theme");
    brandingState.logoCleared = false;
    brandingState.bgCleared = false;
    if (brandingForm.elements.logo_file) brandingForm.elements.logo_file.value = "";
    if (brandingForm.elements.login_background_file) brandingForm.elements.login_background_file.value = "";
    showPreview("logo_file", branding.logo_url || "");
    setUploadName("logo_file", branding.logo_url ? "Current logo" : "");
    showPreview("login_background_file", bgImage);
    setUploadName("login_background_file", bgImage ? "Current image" : "");
    savedBrandingSnapshot = normalizeBranding(branding);
    setBrandingDirty(false);
  };

  brandingForm?.addEventListener("input", updateBrandingDirty);
  brandingForm?.addEventListener("change", updateBrandingDirty);
  brandingForm?.querySelector("[data-discard-branding]")?.addEventListener("click", async () => {
    const data = await apiJson("/api/org/settings");
    populateBranding(data.branding || {});
  });

  brandingForm?.querySelector("[data-theme-swatches]")?.addEventListener("click", (event) => {
    const swatch = event.target.closest(".swatch");
    if (swatch) { setThemeSwatch(swatch.dataset.theme); updateBrandingDirty(); }
  });
  brandingForm?.querySelector("[data-bg-mode]")?.addEventListener("click", (event) => {
    const option = event.target.closest(".seg-option");
    if (option) { setBgMode(option.dataset.bgOption); updateBrandingDirty(); }
  });
  colorPicker?.addEventListener("input", () => { if (colorHex) colorHex.value = colorPicker.value.toUpperCase(); updateBrandingDirty(); });
  colorHex?.addEventListener("input", () => {
    if (colorPicker && /^#[0-9a-f]{6}$/i.test(colorHex.value)) colorPicker.value = colorHex.value;
    updateBrandingDirty();
  });
  brandingForm?.querySelectorAll("[data-upload-trigger]").forEach((btn) => {
    btn.addEventListener("click", () => brandingForm.elements[btn.dataset.uploadTrigger]?.click());
  });
  brandingForm?.querySelectorAll(".brand-file").forEach((input) => {
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (input.name === "logo_file") brandingState.logoCleared = false;
      if (input.name === "login_background_file") brandingState.bgCleared = false;
      setUploadName(input.name, file?.name || "");
      if (file) {
        const reader = new FileReader();
        reader.onload = () => showPreview(input.name, reader.result);
        reader.readAsDataURL(file);
      } else {
        showPreview(input.name, "");
      }
      updateBrandingDirty();
    });
  });
  brandingForm?.querySelectorAll("[data-upload-clear]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const field = btn.dataset.uploadClear;
      const input = brandingForm.elements[field];
      if (input) input.value = "";
      setUploadName(field, "");
      showPreview(field, "");
      if (field === "logo_file") brandingState.logoCleared = true;
      if (field === "login_background_file") brandingState.bgCleared = true;
      updateBrandingDirty();
    });
  });

  const initialAdminRoute = (window.location.hash || "#modules").slice(1);
  loadSettings().finally(() => activateTab(initialAdminRoute));

  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = settingsForm.querySelector('input[name="access_mode"]:checked')?.value;
    if (!selected) return;
    try {
      const payload = { access_mode: selected };
      const data = await apiJson("/api/org/settings", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      accessMode = data.access_mode || selected;
      applyAccessMode();
      if (accessMode === "standalone") {
        await loadPeople();
        await loadEmailSettings();
      } else {
        await loadHrmsSettings();
      }
      showToast("Settings saved.", "info");
      setTimeout(() => {
        window.location.href = "policies.html";
      }, 350);
    } catch (error) {
      showToast(error.message || "Could not save settings.", "error");
    }
  });

  brandingForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      // access_mode is required by PATCH /api/org/settings; branding never
      // changes it, so echo the org's current mode back.
      const payload = {
        access_mode: accessMode || "standalone",
        theme_id: brandingForm.elements.theme_id.value || "default",
        portal_name: brandingForm.elements.portal_name.value.trim(),
      };

      // Login background is one choice: theme / color / image. Each mode
      // clears the other field so only the selected style is stored.
      const mode = bgModeInput?.value || "theme";
      if (mode === "color") {
        const hex = brandingForm.elements.login_background_color.value.trim();
        payload.login_background_color = /^#[0-9a-f]{6}$/i.test(hex) ? hex : "";
        payload.login_background_image_url = "";
      } else if (mode === "image") {
        payload.login_background_color = "";
        const bgFile = brandingForm.elements.login_background_file.files?.[0];
        if (bgFile) payload.login_background_image_url = await readFileAsDataUrl(bgFile);
        else if (brandingState.bgCleared) payload.login_background_image_url = "";
        // else: keep the existing stored image (omit the field).
      } else {
        payload.login_background_color = "";
        payload.login_background_image_url = "";
      }

      const logoFile = brandingForm.elements.logo_file.files?.[0];
      if (logoFile) payload.logo_url = await readFileAsDataUrl(logoFile);
      else if (brandingState.logoCleared) payload.logo_url = "";

      const data = await apiJson("/api/org/settings", { method: "PATCH", body: JSON.stringify(payload) });
      populateBranding(data.branding || (await apiJson("/api/org/settings")).branding || {});
      showToast("Branding saved.", "info");
      // Reflect the theme immediately and refresh the per-host cache so it's
      // enforced on the next load without a stale flash.
      const chosen = payload.theme_id;
      const themeKey = "zarohr-theme:" + window.location.host;
      try {
        if (chosen && chosen !== "default") {
          document.documentElement.dataset.theme = chosen;
          document.body.dataset.theme = chosen;
          localStorage.setItem(themeKey, chosen);
        } else {
          document.documentElement.removeAttribute("data-theme");
          document.body.removeAttribute("data-theme");
          localStorage.removeItem(themeKey);
        }
      } catch { /* ignore storage errors */ }
    } catch (error) { showToast(error.message || "Could not save branding.", "error"); }
  });

  hrmsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(hrmsForm);
    try {
      const data = await apiJson("/api/org/hrms-settings", {
        method: "PUT",
        body: JSON.stringify({
          enabled: form.get("enabled") === "on",
          allowed_origin: form.get("allowed_origin"),
        }),
      });
      accessMode = data?.org?.access_mode || (data.enabled ? "hrms_link" : "standalone");
      const radio = settingsForm?.querySelector(`input[name="access_mode"][value="${accessMode}"]`);
      if (radio) radio.checked = true;
      renderHrmsSettings(data);
      applyAccessMode();
      showToast("HRMS settings saved.", "info");
    } catch (error) {
      showToast(error.message || "Could not save HRMS settings.", "error");
    }
  });

  hrmsForm?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    try {
      if (action === "copy-hrms-url") {
        await navigator.clipboard.writeText(hrmsSettings?.launch_url_template || hrmsLaunchUrl?.textContent || "");
        showToast("Launch URL copied.", "info");
      }
      if (action === "copy-hrms-secret") {
        await navigator.clipboard.writeText(hrmsSettings?.launch_secret || "");
        showToast("Launch secret copied.", "info");
      }
      if (action === "rotate-hrms-secret") {
        const confirmed = await confirmDialog({
          title: "Rotate HRMS secret",
          message: "Existing HRMS launch links signed with the old secret will stop working.",
          confirmText: "Rotate",
        });
        if (!confirmed) return;
        const data = await apiJson("/api/org/hrms-settings/rotate", { method: "POST" });
        renderHrmsSettings(data);
        showToast("HRMS secret rotated.", "info");
      }
      if (action === "test-hrms-launch") {
        const url = hrmsSettings?.launch_url_template || "";
        if (!url) throw new Error("No launch URL available.");
        const launch = new URL(url);
        const payload = Object.fromEntries(launch.searchParams.entries());
        const result = await apiJson("/api/hrms/test", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        if (hrmsTestResult) {
          hrmsTestResult.textContent = result.ok
            ? "Test passed. The sample launch signature is valid."
            : `Test failed: ${(result.failures || []).join("; ") || "Unknown issue."}`;
        }
        showToast(result.ok ? "HRMS test passed." : "HRMS test failed.", result.ok ? "info" : "error");
      }
    } catch (error) {
      showToast(error.message || "HRMS action failed.", "error");
      if (hrmsTestResult && action === "test-hrms-launch") hrmsTestResult.textContent = error.message || "Test failed.";
    }
  });

  window.addEventListener("hashchange", () => activateTab((window.location.hash || "#modules").slice(1)));

  searchInput?.addEventListener("input", () => applyPolicyFilter(grid, searchInput.value, activeFilter));
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.adminFilter || "all";
      filterButtons.forEach((item) => item.classList.toggle("is-active", item === button));
      applyPolicyFilter(grid, searchInput?.value || "", activeFilter);
    });
  });

  adminsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(adminsForm);
    try {
      const data = await apiJson("/api/org/admins", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email: form.get("email"),
          send_email: form.get("send_email") === "on",
        }),
      });
      adminsForm.reset();
      const password = data?.temporary_password;
      const emailNote = data?.email_sent ? " Invite email sent." : "";
      const warning = data?.email_error ? ` Email not sent: ${data.email_error}` : "";
      showToast(password ? `Admin added. Temporary password: ${password}.${emailNote}${warning}` : `Admin added.${emailNote}${warning}`, data?.email_error ? "error" : "info");
      await loadAdmins();
    } catch (error) {
      const message = error?.message || "Admin add failed.";
      showToast(message, "error");
      await loadAdmins();
    }
  });

  adminsList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-people-action]");
    const row = button?.closest("[data-person-id]");
    if (!button || !row) return;
    const id = row.dataset.personId;
    try {
      if (button.dataset.peopleAction === "disable") {
        await apiJson(`/api/org/admins/${id}`, { method: "PATCH", body: JSON.stringify({ status: "disabled" }) });
        showToast("Admin disabled.", "info");
      }
      if (button.dataset.peopleAction === "send-invite") {
        const data = await apiJson(`/api/org/admins/${id}/send-invite`, { method: "POST" });
        showToast(data.email_sent ? "Admin invite email sent." : "Invite email was not sent.", data.email_sent ? "info" : "error");
      }
      if (button.dataset.peopleAction === "delete") {
        const confirmed = await confirmDialog({ title: "Delete admin", message: "Remove this admin account?", confirmText: "Delete" });
        if (!confirmed) return;
        await apiJson(`/api/org/admins/${id}`, { method: "DELETE" });
        showToast("Admin deleted.", "info");
      }
      await loadAdmins();
    } catch (error) {
      showToast(error.message || "Admin update failed.", "error");
    }
  });

  // Picked image filename → render it into the label so the user sees what
  // they selected (the real <input type=file> is hidden inside the label).
  const moduleImageInput = moduleCreate?.querySelector("[data-module-image-input]");
  const moduleImageLabelText = moduleCreate?.querySelector("[data-file-label-text]");
  moduleImageInput?.addEventListener("change", () => {
    const file = moduleImageInput.files?.[0];
    if (moduleImageLabelText) {
      moduleImageLabelText.textContent = file ? file.name : "Choose tile image (optional)";
    }
  });

  // Modal open/close for the "+ Add module" button in the toolbar.
  const moduleModal = document.getElementById("module-create-modal");
  const moduleModalError = moduleModal?.querySelector(".dialog-error");
  const openModuleModal = () => {
    if (!moduleModal) return;
    moduleCreate?.reset();
    if (moduleImageLabelText) moduleImageLabelText.textContent = "Choose tile image (optional)";
    if (moduleModalError) moduleModalError.textContent = "";
    moduleModal.classList.add("is-visible");
    moduleModal.setAttribute("aria-hidden", "false");
    setTimeout(() => moduleCreate?.querySelector('input[name="name"]')?.focus(), 50);
  };
  const closeModuleModal = () => {
    if (!moduleModal) return;
    moduleModal.classList.remove("is-visible");
    moduleModal.setAttribute("aria-hidden", "true");
  };
  document.addEventListener("click", (event) => {
    if (event.target.closest('[data-action="open-module-create"]')) openModuleModal();
  });
  moduleModal?.addEventListener("click", (event) => {
    if (event.target === moduleModal) closeModuleModal();
    if (event.target.closest("[data-action='cancel']")) closeModuleModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && moduleModal?.classList.contains("is-visible")) closeModuleModal();
  });

  moduleCreate?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(moduleCreate);
    if (moduleModalError) moduleModalError.textContent = "";
    try {
      const imageFile = moduleImageInput?.files?.[0] || null;
      // Read picked image as a data URL so it goes into the existing image_url
      // column verbatim — no separate upload endpoint or storage bucket needed.
      const imageUrl = imageFile ? await readFileAsDataUrl(imageFile) : "";
      await apiJson("/api/org/modules", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          image_url: imageUrl,
        }),
      });
      moduleCreate.reset();
      if (moduleImageLabelText) moduleImageLabelText.textContent = "Choose tile image (optional)";
      closeModuleModal();
      showToast("Module added.", "info");
      await loadModules();
    } catch (error) {
      if (moduleModalError) moduleModalError.textContent = error.message || "Module add failed.";
      else showToast(error.message || "Module add failed.", "error");
    }
  });

  // Keyboard parity with the click handler: Enter/Space on a focused module
  // header (role=button) toggles open. Buttons inside the header keep their
  // native handling.
  grid?.addEventListener("keydown", (event) => {
    const header = event.target.closest(".admin-module-head");
    if (!header || header !== event.target) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    header.closest(".admin-module")?.classList.toggle("is-open");
  });

  grid?.addEventListener("click", async (event) => {
    const actionButton = event.target.closest("[data-action]");
    if (!actionButton) return;
    const action = actionButton.dataset.action;
    const module = actionButton.closest(".admin-module");
    const item = actionButton.closest(".admin-policy");

    if (action === "toggle-module" && module) {
      module.classList.toggle("is-open");
      return;
    }

    if (action === "rename-module" && module) {
      event.stopPropagation();
      await inlineRename({
        target: module.querySelector(".admin-module-head [data-rename-target]"),
        currentValue: module.dataset.moduleName || "",
        save: async (next) =>
          apiJson(`/api/org/modules/${module.dataset.module}`, {
            method: "PATCH",
            body: JSON.stringify({ name: next }),
          }),
        onSaved: (next) => {
          module.dataset.moduleName = next;
          showToast("Module renamed.", "info");
        },
      });
      return;
    }

    if (action === "add-policy" && module) {
      event.stopPropagation();
      const name = await promptDialog({
        title: "Add policy",
        label: "Policy name",
        placeholder: "New policy name",
        confirmText: "Add policy",
      });
      if (!name) return;
      try {
        await apiJson(`/api/org/modules/${module.dataset.module}/policies`, {
          method: "POST",
          body: JSON.stringify({ name }),
        });
        showToast("Policy added.", "info");
        await loadModules();
      } catch (error) {
        showToast(error.message || "Policy add failed.", "error");
      }
      return;
    }

    if (action === "delete-module" && module) {
      event.stopPropagation();
      const confirmed = await confirmDialog({
        title: "Delete module",
        message: "Delete this module and all policies/files under it?",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      try {
        await apiJson(`/api/org/modules/${module.dataset.module}`, { method: "DELETE" });
        // Remove the node in place instead of re-rendering the whole grid.
        module.remove();
        updateFilterCounts(grid);
        showToast("Module deleted.", "info");
      } catch (error) {
        showToast(error.message || "Module delete failed.", "error");
      }
      return;
    }

    if (action === "hide-module" && module) {
      event.stopPropagation();
      const nextHidden = module.dataset.moduleHidden !== "true";
      try {
        await apiJson(`/api/org/modules/${module.dataset.module}`, {
          method: "PATCH",
          body: JSON.stringify({ is_hidden: nextHidden }),
        });
        // Toggle in place: dataset, class, button label, and the Hidden pill.
        module.dataset.moduleHidden = nextHidden ? "true" : "false";
        module.classList.toggle("is-hidden-module", nextHidden);
        actionButton.textContent = nextHidden ? "Unhide" : "Hide";
        const h2 = module.querySelector(".admin-module-head h2");
        const existingPill = h2?.querySelector(".module-status-pill");
        if (nextHidden && h2 && !existingPill) {
          const pill = document.createElement("span");
          pill.className = "module-status-pill";
          pill.textContent = "Hidden";
          h2.appendChild(pill);
        } else if (!nextHidden && existingPill) {
          existingPill.remove();
        }
        showToast(nextHidden ? "Module hidden from dashboard." : "Module restored to dashboard.", "info");
      } catch (error) {
        showToast(error.message || "Module visibility update failed.", "error");
      }
      return;
    }

    if (!item || !module) return;
    event.stopPropagation();
    if (action === "upload") {
      const file = item.querySelector(".hidden-input");
      file?.click();
    }
    if (action === "rename-policy") {
      await inlineRename({
        target: item.querySelector(".policy-name [data-rename-target]") || item.querySelector(".policy-name"),
        currentValue: item.dataset.policyName || "",
        save: async (next) =>
          apiJson(`/api/org/policies/${item.dataset.policyId}`, {
            method: "PATCH",
            body: JSON.stringify({ name: next }),
          }),
        onSaved: (next) => {
          item.dataset.policyName = next;
          showToast("Policy renamed.", "info");
        },
      });
    }
    if (action === "hide-policy") {
      const nextHidden = item.dataset.policyHidden !== "true";
      try {
        await apiJson(`/api/org/policies/${item.dataset.policyId}`, {
          method: "PATCH",
          body: JSON.stringify({ is_hidden: nextHidden }),
        });
        // Toggle in place: dataset, class, button label, and the inline pill.
        item.dataset.policyHidden = nextHidden ? "true" : "false";
        item.classList.toggle("is-hidden-policy", nextHidden);
        actionButton.textContent = nextHidden ? "Unhide" : "Hide";
        const nameEl = item.querySelector(".policy-name");
        const existingPill = nameEl?.querySelector(".module-status-pill");
        if (nextHidden && nameEl && !existingPill) {
          const pill = document.createElement("span");
          pill.className = "module-status-pill";
          pill.textContent = "Hidden";
          nameEl.appendChild(document.createTextNode(" "));
          nameEl.appendChild(pill);
        } else if (!nextHidden && existingPill) {
          existingPill.remove();
        }
        showToast(nextHidden ? "Policy hidden." : "Policy restored.", "info");
      } catch (error) {
        showToast(error.message || "Policy visibility update failed.", "error");
      }
    }
    if (action === "delete-policy") {
      const confirmed = await confirmDialog({
        title: "Delete policy",
        message: "Delete this policy and all uploaded versions?",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      try {
        await apiJson(`/api/org/policies/${item.dataset.policyId}`, { method: "DELETE" });
        // Remove the row in place. updateModuleStatus refreshes the module's
        // has-files state since the missing row may have been the only one
        // with a file.
        const parentModule = item.closest(".admin-module");
        item.remove();
        updateModuleStatus(parentModule);
        updateFilterCounts(grid);
        showToast("Policy deleted.", "info");
      } catch (error) {
        showToast(error.message || "Policy delete failed.", "error");
      }
    }
    if (action === "delete-file") {
      const filePath = actionButton.dataset.filePath;
      if (!filePath) return;
      const confirmed = await confirmDialog({
        title: "Delete file",
        message: "Remove this file version from the policy?",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      await deleteFile({ item, policyId: item.dataset.policyId, filePath });
    }
  });

  // Email validation shared by the two add-forms in the People register.
  const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
  const showFormError = (form, message) => {
    const box = form?.querySelector("[data-form-error]");
    if (!box) return;
    if (message) {
      box.textContent = message;
      box.hidden = false;
    } else {
      box.textContent = "";
      box.hidden = true;
    }
  };

  peopleForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(peopleForm);
    const email = String(form.get("email") || "").trim();
    const code = String(form.get("employee_code") || "").trim();
    if (!code) {
      showFormError(peopleForm, "Employee code is required.");
      return;
    }
    if (!EMAIL_RE.test(email)) {
      showFormError(peopleForm, "Enter a valid email address.");
      return;
    }
    showFormError(peopleForm, "");
    try {
      const people = await apiJson("/api/org/people", {
        method: "POST",
        body: JSON.stringify({
          email,
          employee_code: code,
          name: form.get("name"),
          role: "employee",
          status: "active",
        }),
      });
      peopleForm.reset();
      const first = people?.[0];
      if (first?.email_sent) {
        showToast(`Employee added. Credentials sent to ${first.email}.`, "info");
      } else if (first?.temporary_password) {
        showToast(`Employee added. Temporary password: ${first.temporary_password}`, "info");
      } else if (first?.email_error) {
        showToast(`Employee added but credentials email failed: ${first.email_error}`, "error");
      } else {
        showToast("Employee added.", "info");
      }
      await loadPeople();
    } catch (error) {
      showFormError(peopleForm, error.message || "Could not add person.");
    }
  });

  // Add-admin form living on the People page (mirrors the Admins-tab form,
  // hits the same endpoint).
  const peopleAdminForm = document.querySelector("[data-people-admin-form]");
  peopleAdminForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(peopleAdminForm);
    const email = String(form.get("email") || "").trim();
    if (!EMAIL_RE.test(email)) {
      showFormError(peopleAdminForm, "Enter a valid email address.");
      return;
    }
    showFormError(peopleAdminForm, "");
    try {
      const data = await apiJson("/api/org/admins", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          email,
          send_email: form.get("send_email") === "on",
        }),
      });
      peopleAdminForm.reset();
      const password = data?.temporary_password;
      const emailNote = data?.email_sent ? " Invite email sent." : "";
      const warning = data?.email_error ? ` Email not sent: ${data.email_error}` : "";
      showToast(password ? `Admin added. Temporary password: ${password}.${emailNote}${warning}` : `Admin added.${emailNote}${warning}`, data?.email_error ? "error" : "info");
      await loadPeople();
      await loadAdmins();
    } catch (error) {
      showFormError(peopleAdminForm, error.message || "Admin add failed.");
    }
  });

  // Register-panel accordion. Clicking a toggle opens its panel and closes
  // the others; clicking the same toggle again collapses it. Opening any
  // register panel also exits Invite/Delete selection mode so the two UIs
  // don't stack on screen.
  document.querySelectorAll("[data-register-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.registerToggle;
      const panel = document.querySelector(`[data-register-panel="${key}"]`);
      if (!panel) return;
      const willOpen = panel.hidden;
      document.querySelectorAll("[data-register-panel]").forEach((p) => (p.hidden = true));
      document.querySelectorAll("[data-register-toggle]").forEach((b) => b.setAttribute("aria-expanded", "false"));
      if (willOpen) {
        panel.hidden = false;
        btn.setAttribute("aria-expanded", "true");
        panel.querySelector("input, textarea")?.focus();
        // Exit selection mode if one was on.
        if (typeof setSelectionMode === "function" && selectionMode) setSelectionMode(null);
      }
    });
  });

  // Selection mode (Invite / Delete). Both modes are mutually exclusive.
  // Toggling either one on shows checkboxes on every person row and the
  // selection bar; toggling off returns to the normal view.
  const selectionBar = document.querySelector("[data-selection-bar]");
  const selectionCount = document.querySelector("[data-selection-count]");
  const selectionConfirm = document.querySelector("[data-selection-confirm]");
  const selectionCancel = document.querySelector("[data-selection-cancel]");
  const selectAllBox = document.querySelector("[data-select-all]");
  let selectionMode = null; // null | "invite" | "delete"

  const setSelectionMode = (nextMode) => {
    selectionMode = nextMode;
    const on = Boolean(nextMode);
    if (selectionBar) selectionBar.hidden = !on;
    // Entering selection mode collapses any open register panel so the two
    // UIs don't stack on screen.
    if (on) {
      document.querySelectorAll("[data-register-panel]").forEach((p) => (p.hidden = true));
      document.querySelectorAll("[data-register-toggle]").forEach((b) => b.setAttribute("aria-expanded", "false"));
    }
    document.querySelectorAll("[data-select-mode]").forEach((btn) => {
      const active = btn.dataset.selectMode === nextMode;
      btn.setAttribute("aria-pressed", active ? "true" : "false");
      btn.classList.toggle("is-active", active);
    });
    document.querySelectorAll("[data-person-select]").forEach((el) => {
      el.hidden = !on;
    });
    document.querySelectorAll("[data-person-checkbox]").forEach((cb) => {
      cb.checked = false;
    });
    if (selectAllBox) selectAllBox.checked = false;
    if (selectionConfirm) {
      selectionConfirm.textContent = nextMode === "delete" ? "Delete selected" : "Send invites";
      selectionConfirm.classList.toggle("selection-confirm-danger", nextMode === "delete");
    }
    updateSelectionCount();
  };

  const getSelectedIds = () =>
    Array.from(document.querySelectorAll("[data-person-checkbox]"))
      .filter((cb) => cb.checked && !cb.disabled)
      .map((cb) => cb.value);

  const updateSelectionCount = () => {
    if (!selectionCount) return;
    const n = getSelectedIds().length;
    selectionCount.textContent = `${n} selected`;
    if (selectionConfirm) selectionConfirm.disabled = n === 0;
  };

  document.querySelectorAll("[data-select-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.selectMode;
      setSelectionMode(selectionMode === next ? null : next);
    });
  });

  selectAllBox?.addEventListener("change", () => {
    const on = selectAllBox.checked;
    document.querySelectorAll("[data-person-checkbox]").forEach((cb) => {
      cb.checked = on;
    });
    updateSelectionCount();
  });

  // Row checkbox toggle (delegated so it works across re-renders).
  peopleList?.addEventListener("change", (event) => {
    if (event.target.matches("[data-person-checkbox]")) updateSelectionCount();
  });

  selectionCancel?.addEventListener("click", () => setSelectionMode(null));

  selectionConfirm?.addEventListener("click", async () => {
    const ids = getSelectedIds();
    if (!ids.length) return;

    if (selectionMode === "invite") {
      // Warn if any of the selected people were already invited — re-invite
      // regenerates the temp password and burns the old one.
      const rows = ids
        .map((id) => document.querySelector(`[data-person-id="${id}"]`))
        .filter(Boolean);
      const previouslyInvited = rows.filter((row) => row.dataset.invited === "1").length;
      let confirmed;
      if (previouslyInvited > 0) {
        confirmed = await confirmDialog({
          title: "Reset password for invited employees?",
          message: `${previouslyInvited} of the ${ids.length} selected employees were already invited. Re-sending will reset their password (any old temp password and active session become invalid). Continue?`,
          confirmText: "Send & reset",
        });
      } else {
        confirmed = await confirmDialog({
          title: `Invite ${ids.length} ${ids.length === 1 ? "employee" : "employees"}?`,
          message: "Each will receive a fresh temporary password by email.",
          confirmText: "Send invites",
        });
      }
      if (!confirmed) return;
      try {
        const result = await apiJson("/api/org/people/invite-many", {
          method: "POST",
          body: JSON.stringify({ ids }),
        });
        showToast(
          `Invites sent: ${result.sent}. Failed: ${result.failed}. Skipped: ${result.skipped}.`,
          result.failed > 0 ? "error" : "info"
        );
        setSelectionMode(null);
        await loadPeople();
      } catch (error) {
        showToast(error.message || "Invite failed.", "error");
      }
    } else if (selectionMode === "delete") {
      const confirmed = await confirmDialog({
        title: `Delete ${ids.length} ${ids.length === 1 ? "employee" : "employees"}?`,
        message:
          "They lose portal access immediately, any old invite links stop working, and their chat history is removed. This cannot be undone.",
        confirmText: "Delete",
      });
      if (!confirmed) return;
      try {
        const result = await apiJson("/api/org/people/delete-many", {
          method: "POST",
          body: JSON.stringify({ ids }),
        });
        showToast(
          `Deleted: ${result.deleted}. Failed: ${result.failed}. Skipped: ${result.skipped}.`,
          result.failed > 0 ? "error" : "info"
        );
        setSelectionMode(null);
        await loadPeople();
      } catch (error) {
        showToast(error.message || "Delete failed.", "error");
      }
    }
  });

  // Re-apply selection-mode UI whenever the People list re-renders, so
  // toggling to a mode and adding a person via the form keeps checkboxes on.
  if (peopleList) {
    new MutationObserver(() => {
      if (selectionMode) {
        document.querySelectorAll("[data-person-select]").forEach((el) => (el.hidden = false));
      }
      applyPeopleSearch();
    }).observe(peopleList, { childList: true });
  }

  // Simple client-side search over rendered person rows. Runs against the
  // name (first cell strong), the employee code / email line, and matches
  // by substring, case-insensitive. Empty query → show everything.
  const peopleSearch = document.querySelector("[data-people-search]");
  const applyPeopleSearch = () => {
    const query = String(peopleSearch?.value || "").trim().toLowerCase();
    const rows = document.querySelectorAll("[data-people-list] .person-row");
    rows.forEach((row) => {
      if (!query) { row.hidden = false; return; }
      const info = row.querySelector(".person-info")?.textContent?.toLowerCase() || "";
      row.hidden = !info.includes(query);
    });
  };
  peopleSearch?.addEventListener("input", applyPeopleSearch);

  // Reusable communication templates. The active template is used for new
  // employee credentials; other templates remain available for later use.
  const DEFAULT_DRAFT = {
    subject: "Your {{org_name}} policy portal access",
    body:
      "Hi {{name}},\n\n" +
      "You've been added to the {{org_name}} policy portal.\n\n" +
      "Login URL: {{login_url}}\n" +
      "Employee code: {{employee_code}}\n" +
      "Temporary password: {{password}}\n\n" +
      "If you did not expect this email, contact your HR team.\n\n" +
      "{{org_name}}",
  };

  const renderEmailTemplates = () => {
    if (!templateList) return;
    templateList.innerHTML = emailTemplates.length
      ? emailTemplates.map((template) => `
          <button
            class="template-list-item${template.id === activeTemplateId ? " is-selected" : ""}"
            type="button"
            data-template-id="${template.id}"
          >
            <span>${escapeHtml(template.name)}</span>
            ${template.is_default ? "<small>Active</small>" : ""}
          </button>
        `).join("")
      : `<div class="admin-empty">No templates yet.</div>`;
  };

  const selectEmailTemplate = (id) => {
    const template = emailTemplates.find((item) => item.id === id);
    if (!template || !templateForm) return;
    activeTemplateId = id;
    templateForm.name.value = template.name || "";
    templateForm.subject.value = template.subject || "";
    templateForm.body.value = template.body || "";
    templateForm.is_default.checked = template.is_default === true;
    if (templateStatus) {
      templateStatus.textContent = template.is_default
        ? "Active employee invitation"
        : "Saved communication template";
    }
    renderEmailTemplates();
  };

  async function loadEmailTemplates({ force = false } = {}) {
    if (!templateForm || (!force && emailTemplates.length)) return;
    try {
      emailTemplates = await apiJson("/api/org/email-templates");
      const selected = emailTemplates.find((item) => item.id === activeTemplateId)
        || emailTemplates.find((item) => item.is_default)
        || emailTemplates[0];
      renderEmailTemplates();
      if (selected) selectEmailTemplate(selected.id);
    } catch (error) {
      showToast(error.message || "Templates could not be loaded.", "error");
    }
  }

  templateList?.addEventListener("click", (event) => {
    const item = event.target.closest("[data-template-id]");
    if (item) selectEmailTemplate(item.dataset.templateId);
  });

  document.querySelector("[data-action='template-create']")?.addEventListener("click", async () => {
    try {
      const created = await apiJson("/api/org/email-templates", {
        method: "POST",
        body: JSON.stringify({
          name: "New template",
          subject: DEFAULT_DRAFT.subject,
          body: DEFAULT_DRAFT.body,
        }),
      });
      emailTemplates.push(created);
      selectEmailTemplate(created.id);
      templateForm?.name.select();
      showToast("Template created.", "info");
    } catch (error) {
      showToast(error.message || "Template creation failed.", "error");
    }
  });

  templateForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeTemplateId) return;
    try {
      const saved = await apiJson(`/api/org/email-templates/${activeTemplateId}`, {
        method: "PUT",
        body: JSON.stringify({
          name: templateForm.name.value,
          subject: templateForm.subject.value,
          body: templateForm.body.value,
        }),
      });
      if (templateForm.is_default.checked && !saved.is_default) {
        await apiJson(`/api/org/email-templates/${activeTemplateId}/default`, { method: "POST" });
      }
      await loadEmailTemplates({ force: true });
      showToast("Template saved.", "info");
    } catch (error) {
      showToast(error.message || "Template save failed.", "error");
    }
  });

  document.querySelector("[data-action='template-delete']")?.addEventListener("click", async () => {
    if (!activeTemplateId) return;
    const confirmed = await confirmDialog({
      title: "Delete template",
      message: "Delete this communication template?",
      confirmText: "Delete",
    });
    if (!confirmed) return;
    try {
      await apiJson(`/api/org/email-templates/${activeTemplateId}`, { method: "DELETE" });
      activeTemplateId = null;
      emailTemplates = [];
      await loadEmailTemplates({ force: true });
      showToast("Template deleted.", "info");
    } catch (error) {
      showToast(error.message || "Template deletion failed.", "error");
    }
  });

  // Toggle Standalone copy action as the user flips between access modes.
  settingsForm?.querySelectorAll('input[name="access_mode"]').forEach((radio) => {
    radio.addEventListener("change", () => { renderOrgLoginUrl(); });
  });

  document.querySelector("[data-action='copy-org-url']")?.addEventListener("click", async () => {
    const url = orgLoginUrl || (await apiJson("/api/org/settings")).login_url;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Link copied.", "info");
    } catch { showToast("Could not copy — select and copy manually.", "error"); }
  });

  // Upload-sheet slide-out toggle. Uses a class (not the hidden attribute)
  // so the CSS transition actually plays on toggle instead of the panel
  // popping into layout from display:none.
  const uploadSheetToggle = document.querySelector("[data-upload-sheet-toggle]");
  const uploadSheetPanel = document.querySelector("[data-upload-sheet-panel]");
  uploadSheetToggle?.addEventListener("click", () => {
    if (!uploadSheetPanel) return;
    const willOpen = !uploadSheetPanel.classList.contains("is-open");
    uploadSheetPanel.classList.toggle("is-open", willOpen);
    uploadSheetToggle.setAttribute("aria-expanded", willOpen ? "true" : "false");
  });

  document.querySelector("[data-action='people-template']")?.addEventListener("click", () => {
    const csv = "employee_code,name,email\nEMP001,Jane Doe,jane.doe@example.com\nEMP002,,employee@example.com\n";
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "zarohr-policy-employee-upload-template.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  });

  document.querySelector("[data-action='people-upload']")?.addEventListener("click", () => peopleFile?.click());
  peopleFile?.addEventListener("change", async () => {
    const file = peopleFile.files?.[0];
    if (!file) return;
    try {
      const people = parsePeopleCsv(await file.text());
      await apiJson("/api/org/people", {
        method: "POST",
        body: JSON.stringify({ people }),
      });
      peopleFile.value = "";
      showToast("People imported. Review the list, then send invites when ready.", "info");
      await loadPeople();
    } catch (error) {
      showToast(error.message || "Import failed.", "error");
    }
  });

  peopleList?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-people-action]");
    if (!button) return;
    const row = button.closest("[data-person-id]");
    if (!row) return;
    const id = row.dataset.personId;
    try {
      if (button.dataset.peopleAction === "invite") {
        const data = await apiJson(`/api/org/people/${id}/resend-invite`, { method: "POST" });
        showToast(data.email_sent ? "Invite email sent." : "Invite email was not sent.", data.email_sent ? "info" : "error");
      }
      if (button.dataset.peopleAction === "disable") {
        await apiJson(`/api/org/people/${id}`, { method: "PATCH", body: JSON.stringify({ status: "disabled" }) });
        showToast("Person disabled.", "info");
      }
      if (button.dataset.peopleAction === "resend-invite") {
        const data = await apiJson(`/api/org/people/${id}/resend-invite`, { method: "POST" });
        if (data.email_sent) {
          showToast(`Fresh credentials sent to ${data.email}.`, "info");
        } else if (data.temporary_password) {
          showToast(`Temporary password: ${data.temporary_password}`, "info");
        } else {
          showToast(data.email_error || "Could not send credentials.", "error");
        }
      }
      if (button.dataset.peopleAction === "delete") {
        const confirmed = await confirmDialog({ title: "Delete person", message: "Remove this person?", confirmText: "Delete" });
        if (!confirmed) return;
        await apiJson(`/api/org/people/${id}`, { method: "DELETE" });
        showToast("Person deleted.", "info");
      }
      await loadPeople();
    } catch (error) {
      showToast(error.message || "People update failed.", "error");
    }
  });

  emailForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(emailForm);
    try {
      await apiJson("/api/org/email-settings", {
        method: "PUT",
        body: JSON.stringify({
          smtp: {
            host: form.get("host"),
            port: form.get("port"),
            username: form.get("username"),
            password: form.get("password"),
            from_email: form.get("from_email"),
            from_name: form.get("from_name"),
          },
        }),
      });
      showToast("SMTP settings saved.", "info");
    } catch (error) {
      showToast(error.message || "Email settings failed.", "error");
    }
  });
};

const renderAdminGrid = (grid, data, filterValue = "", filterMode = "all") => {
  if (!data.length) {
    grid.innerHTML = `<div class="admin-empty">No modules yet for this organization.</div>`;
    updateFilterCounts(grid);
    return;
  }

  grid.innerHTML = data
    .map((module, index) => {
      const isHidden = module.is_hidden === true;
      const policyItems = (module.policies || [])
        .map((policy) => {
          const policyHidden = policy.is_hidden === true;
          return `
            <li class="admin-policy ${policyHidden ? "is-hidden-policy" : ""}" data-policy-id="${policy.id}" data-policy-hidden="${policyHidden ? "true" : "false"}" data-policy-name="${escapeHtml(policy.name)}">
              <div class="policy-main">
                <span class="policy-name" data-rename-target>${escapeHtml(policy.name)}${policyHidden ? ` <span class="module-status-pill">Hidden</span>` : ""}</span>
              </div>
              <div class="admin-actions">
                <button class="icon-btn" type="button" data-action="upload">Upload</button>
                <button class="icon-btn icon-only" type="button" data-action="rename-policy" title="Rename" aria-label="Rename policy">✎</button>
                <button class="icon-btn" type="button" data-action="hide-policy">${policyHidden ? "Unhide" : "Hide"}</button>
                <button class="icon-btn icon-only icon-only--danger" type="button" data-action="delete-policy" title="Delete" aria-label="Delete policy">×</button>
              </div>
              <input class="hidden-input" type="file" />
              <div class="policy-files">Loading files...</div>
            </li>
          `;
        })
        .join("");

      return `
        <article class="admin-module ${index === 0 ? "is-open" : ""} ${isHidden ? "is-hidden-module" : ""}" data-module="${module.id}" data-module-hidden="${isHidden ? "true" : "false"}" data-module-name="${escapeHtml(module.name)}" data-module-description="${escapeHtml(module.description || "")}" data-module-image="${escapeHtml(module.image_url || "")}">
          <header class="admin-module-head" data-action="toggle-module" role="button" tabindex="0" aria-label="Toggle module">
            <div>
              <h2><span data-rename-target>${escapeHtml(module.name)}</span>${isHidden ? `<span class="module-status-pill">Hidden</span>` : ""}</h2>
            </div>
            <div class="admin-module-actions">
              <button class="icon-btn icon-only" type="button" data-action="rename-module" title="Rename" aria-label="Rename module">✎</button>
              <button class="icon-btn" type="button" data-action="hide-module">${isHidden ? "Unhide" : "Hide"}</button>
              <button class="icon-btn icon-only icon-only--danger" type="button" data-action="delete-module" title="Delete" aria-label="Delete module">×</button>
            </div>
          </header>
          <div class="admin-add">
            <button class="admin-add-btn" type="button" data-action="add-policy">
              <span class="admin-add-icon" aria-hidden="true">+</span> Add policy
            </button>
          </div>
          <ul class="admin-policy-list">
            ${policyItems || `<li class="admin-empty">No policies in this module.</li>`}
          </ul>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll(".admin-policy").forEach((item) => {
    const input = item.querySelector(".hidden-input");
    input?.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      if (!file) return;
      await uploadFile(item, file);
      input.value = "";
    });
    loadPolicyFiles(item);
  });

  applyPolicyFilter(grid, filterValue, filterMode);
  updateFilterCounts(grid);
};

const renderPeople = (container, people, options = {}) => {
  if (!people.length) {
    container.innerHTML = `<div class="admin-empty">${escapeHtml(options.empty || "No employees or admins added yet.")}</div>`;
    return;
  }
  container.innerHTML = people
    .map(
      (person) => `
        <article class="person-row" data-person-id="${person.id}" data-invited="${person.invited_at ? "1" : "0"}">
          <label class="person-select" data-person-select hidden>
            <input type="checkbox" data-person-checkbox value="${person.id}" />
          </label>
          <div class="person-info">
            <strong>${escapeHtml(person.name || person.email)}</strong>
            <span>${escapeHtml(person.employee_code || "No code")} · ${escapeHtml(person.email)}</span>
          </div>
          <div class="admin-actions">
            ${person.invited_at
              ? `<span class="person-pill person-pill-invited" title="Invited on ${escapeHtml(new Date(person.invited_at).toLocaleString())}">✓ Invited</span>`
              : `<span class="person-pill person-pill-pending">Not invited</span>`}
          </div>
        </article>
      `
    )
    .join("");
};

const applyPolicyFilter = (grid, rawQuery, filterMode = "all") => {
  if (!grid) return;
  const query = rawQuery.trim().toLowerCase();
  let visibleModules = 0;

  grid.querySelectorAll(".admin-module").forEach((module) => {
    const moduleTitle = module.querySelector("h2")?.textContent?.toLowerCase() || "";
    const matchesModule = query && moduleTitle.includes(query);
    const policies = module.querySelectorAll(".admin-policy");
    let visiblePolicies = 0;

    policies.forEach((item) => {
      const name = item.querySelector(".policy-name")?.textContent?.toLowerCase() || "";
      const hasFile = item.classList.contains("has-file");
      const passesFilter =
        filterMode === "all" || (filterMode === "present" && hasFile) || (filterMode === "missing" && !hasFile);
      const matchesSearch = !query || name.includes(query);
      const show = passesFilter && matchesSearch;
      item.style.display = show ? "" : "none";
      if (show) visiblePolicies += 1;
    });

    const isNarrowed = query || filterMode !== "all";
    const showModule = isNarrowed ? matchesModule || visiblePolicies > 0 : true;
    module.style.display = showModule ? "" : "none";
    if (showModule && isNarrowed && visiblePolicies > 0) {
      module.classList.add("is-open");
      const toggle = module.querySelector("[data-action='toggle-module']");
      if (toggle) toggle.textContent = "Close";
    }
    if (showModule) visibleModules += 1;
  });

  let emptyState = grid.querySelector(".admin-empty-filter");
  if (!emptyState) {
    emptyState = document.createElement("div");
    emptyState.className = "admin-empty admin-empty-filter";
    emptyState.textContent = "No policies match your search.";
    grid.appendChild(emptyState);
  }
  emptyState.style.display = (query || filterMode !== "all") && visibleModules === 0 ? "block" : "none";
  updateFilterCounts(grid);
};

// Swap a label span with an in-place <input>. Commit on Enter or blur, cancel
// on Escape. Reverts on save error. No modal, no prompt() — the only chrome
// is the input itself.
const inlineRename = ({ target, currentValue, save, onSaved }) =>
  new Promise((resolve) => {
    if (!target) return resolve();
    const labelText = currentValue || target.textContent.trim();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-rename-input";
    input.value = labelText;
    let settled = false;

    const restore = (text) => {
      target.textContent = text;
    };

    const commit = async () => {
      if (settled) return;
      settled = true;
      const next = input.value.trim();
      if (!next || next === labelText) {
        restore(labelText);
        return resolve();
      }
      try {
        await save(next);
        restore(next);
        onSaved?.(next);
      } catch (error) {
        restore(labelText);
        showToast(error.message || "Rename failed.", "error");
      }
      resolve();
    };

    const cancel = () => {
      if (settled) return;
      settled = true;
      restore(labelText);
      resolve();
    };

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        input.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        input.value = labelText;
        cancel();
      }
    });
    input.addEventListener("blur", commit);

    target.textContent = "";
    target.appendChild(input);
    input.focus();
    input.select();
  });

const uploadFile = async (item, file) => {
  const policyId = item.dataset.policyId;
  if (!policyId) return;
  showToast("Uploading file...", "info");
  try {
    await uploadPolicyDocument({ policyId, file, displayName: file.name });
    showToast("Uploaded.", "info");
    await loadPolicyFiles(item);
  } catch (error) {
    console.error("Upload failed:", error);
    showToast(error?.message || "Upload failed. Please try again.", "error");
  }
};

const deleteFile = async ({ item, policyId, filePath }) => {
  showToast("Deleting file...", "info");
  try {
    await deletePolicyDocument({ policyId, filePath });
    showToast("File deleted.", "info");
    await loadPolicyFiles(item);
  } catch (error) {
    console.error("Delete failed:", error);
    showToast(error?.message || "Delete failed. Please try again.", "error");
  }
};

const loadPolicyFiles = async (item) => {
  const policyId = item.dataset.policyId;
  const container = item.querySelector(".policy-files");
  if (!policyId || !container) return;

  container.textContent = "Loading files...";
  try {
    const files = await listPolicyDocuments({ policyId });
    container.innerHTML = "";
    if (!files.length) {
      container.textContent = "No files yet.";
      item.classList.remove("has-file");
      updateModuleStatus(item.closest(".admin-module"));
      applyPolicyFilter(document.querySelector("[data-admin-grid]"), document.querySelector("[data-admin-search]")?.value || "", getActiveFilter());
      return;
    }

    item.classList.add("has-file");
    updateModuleStatus(item.closest(".admin-module"));
    const label = document.createElement("div");
    label.className = "policy-files-label";
    label.textContent = "File";
    const list = document.createElement("ul");
    list.className = "policy-files-list";
    files.forEach((doc) => {
      const li = document.createElement("li");
      const storedName = doc.file_path ? doc.file_path.split("/").pop() : "Unknown file";
      const name = doc.display_name || storedName;
      const fileButton = document.createElement("button");
      fileButton.type = "button";
      fileButton.className = "file-link";
      fileButton.textContent = name;
      fileButton.disabled = !doc.url;
      if (doc.url) {
        fileButton.dataset.fileUrl = doc.url;
        fileButton.dataset.fileName = name;
        fileButton.addEventListener("dblclick", () => openDocumentViewer({ url: doc.url, name }));
      }
      li.appendChild(fileButton);

      const deleteBtn = document.createElement("button");
      deleteBtn.type = "button";
      deleteBtn.className = "icon-btn danger";
      deleteBtn.dataset.action = "delete-file";
      deleteBtn.dataset.filePath = doc.file_path || "";
      deleteBtn.textContent = "Delete";
      li.appendChild(deleteBtn);
      list.appendChild(li);
    });
    container.appendChild(label);
    container.appendChild(list);
    applyPolicyFilter(document.querySelector("[data-admin-grid]"), document.querySelector("[data-admin-search]")?.value || "", getActiveFilter());
  } catch (error) {
    console.error("Failed to load policy files:", error);
    container.textContent = "Unable to load files.";
  }
};

const parsePeopleCsv = (text) => {
  const rows = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!rows.length) return [];
  const first = rows[0].toLowerCase();
  const hasHeader = first.includes("employee_code") || first.includes("email");
  const headers = hasHeader ? rows[0].split(",").map((h) => h.trim().toLowerCase()) : ["employee_code", "name", "email"];
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows
    .map((line) => {
      const cells = line.split(",").map((cell) => cell.trim());
      const get = (key, fallbackIndex) => {
        const index = headers.indexOf(key);
        return cells[index >= 0 ? index : fallbackIndex] || "";
      };
      return {
        employee_code: get("employee_code", 0),
        name: get("name", 1),
        email: get("email", 2),
        role: "employee",
        status: "active",
      };
    })
    .filter((row) => row.employee_code && row.email && row.email.includes("@"));
};

const setField = (form, name, value) => {
  const field = form.querySelector(`[name="${name}"]`);
  if (field) field.value = value || "";
};

const updateModuleStatus = (module) => {
  if (!module) return;
  const hasFile = Boolean(module.querySelector(".admin-policy.has-file"));
  module.classList.toggle("has-files", hasFile);
};

const getActiveFilter = () => document.querySelector(".admin-filter.is-active")?.dataset.adminFilter || "all";

const updateFilterCounts = (grid) => {
  if (!grid) return;
  const policies = Array.from(grid.querySelectorAll(".admin-policy"));
  const total = policies.length;
  const present = policies.filter((item) => item.classList.contains("has-file")).length;
  const missing = total - present;

  const update = (key, value) => {
    const node = document.querySelector(`[data-filter-count="${key}"]`);
    if (node) node.textContent = value;
  };

  update("all", total);
  update("present", present);
  update("missing", missing);
};

const confirmDialog = ({ title, message, confirmText = "OK", cancelText = "Cancel" }) =>
  new Promise((resolve) => {
    // Always build a fresh element. Reusing the first .dialog-backdrop in the
    // DOM clashes with statically-rendered modals (e.g. the "Add module" form)
    // that share the class — the wrong element gets returned and confirmDialog
    // silently throws when querying its own children.
    const modal = document.createElement("div");
    modal.className = "dialog-backdrop confirm-dialog-backdrop";
    modal.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <h3 class="dialog-title"></h3>
        <p class="dialog-message"></p>
        <div class="dialog-actions">
          <button class="btn ghost" data-dialog="cancel"></button>
          <button class="btn primary" data-dialog="confirm"></button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector(".dialog-title").textContent = title;
    modal.querySelector(".dialog-message").textContent = message;
    modal.querySelector("[data-dialog='cancel']").textContent = cancelText;
    modal.querySelector("[data-dialog='confirm']").textContent = confirmText;
    // Force a frame so the .is-visible transition runs from hidden → shown.
    requestAnimationFrame(() => modal.classList.add("is-visible"));

    const cleanup = () => {
      modal.remove();
    };

    modal.querySelector("[data-dialog='cancel']").addEventListener("click", () => {
      cleanup();
      resolve(false);
    });
    modal.querySelector("[data-dialog='confirm']").addEventListener("click", () => {
      cleanup();
      resolve(true);
    });
  });

// Modal text-input prompt. Resolves with the trimmed value, or null if the
// user cancels / submits empty. Mirrors confirmDialog so styling stays shared.
const promptDialog = ({ title, label = "", placeholder = "", value = "", confirmText = "OK", cancelText = "Cancel" }) =>
  new Promise((resolve) => {
    const modal = document.createElement("div");
    modal.className = "dialog-backdrop prompt-dialog-backdrop";
    modal.innerHTML = `
      <div class="dialog" role="dialog" aria-modal="true">
        <h3 class="dialog-title"></h3>
        <div class="field">
          <label></label>
          <input type="text" />
        </div>
        <div class="dialog-actions">
          <button class="btn ghost" data-dialog="cancel"></button>
          <button class="btn primary" data-dialog="confirm"></button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    modal.querySelector(".dialog-title").textContent = title;
    const labelEl = modal.querySelector("label");
    if (label) labelEl.textContent = label;
    else labelEl.remove();
    const input = modal.querySelector("input");
    input.placeholder = placeholder;
    input.value = value;
    modal.querySelector("[data-dialog='cancel']").textContent = cancelText;
    modal.querySelector("[data-dialog='confirm']").textContent = confirmText;
    // Force a frame so the .is-visible transition runs, then focus the field.
    requestAnimationFrame(() => {
      modal.classList.add("is-visible");
      input.focus();
    });

    const cleanup = () => {
      document.removeEventListener("keydown", onKey);
      modal.remove();
    };
    const submit = () => {
      const val = input.value.trim();
      cleanup();
      resolve(val || null);
    };
    const cancel = () => {
      cleanup();
      resolve(null);
    };
    const onKey = (event) => {
      if (event.key === "Escape") cancel();
      else if (event.key === "Enter") {
        event.preventDefault();
        submit();
      }
    };
    document.addEventListener("keydown", onKey);
    modal.querySelector("[data-dialog='cancel']").addEventListener("click", cancel);
    modal.querySelector("[data-dialog='confirm']").addEventListener("click", submit);
    // Click on the dark backdrop (outside the dialog) cancels.
    modal.addEventListener("mousedown", (event) => {
      if (event.target === modal) cancel();
    });
  });

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

const openDocumentViewer = ({ url, name }) => {
  if (!url) return;
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
  frame.dataset.type = isPdf ? "pdf" : isDoc ? "doc" : "other";
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
    const frame = modal.querySelector("iframe");
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

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

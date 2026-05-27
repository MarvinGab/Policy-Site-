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
  const settingsForm = document.querySelector("[data-settings-form]");
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
    email: "Email",
    hrms: "HRMS Access",
    settings: "Settings",
  };
  let activeFilter = "all";
  let policyData = [];
  let peopleData = [];
  let accessMode = "standalone";
  let hrmsSettings = null;

  const isSectionAllowed = (section) => {
    if (section !== "modules" && !isSuperAdmin) return false;
    if (section === "people" || section === "email") return accessMode !== "hrms_link";
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
          : "Standalone mode — adding an email auto-generates a portal password and shows it once.";
    }
    const activeSection = document.querySelector("[data-admin-section].is-active")?.dataset.adminSection || "modules";
    if (!isSectionAllowed(activeSection)) {
      activateTab(accessMode === "hrms_link" ? "hrms" : "settings");
    }
  };

  const loadSettings = async () => {
    try {
      const data = await apiJson("/api/org/settings");
      accessMode = data.access_mode || "standalone";
    if (settingsForm) {
        const radio = settingsForm.querySelector(`input[name="access_mode"][value="${accessMode}"]`);
        if (radio) radio.checked = true;
      }
      if (isSuperAdmin) await loadAdmins();
      applyAccessMode();
      if (accessMode === "standalone") {
        await loadPeople();
        await loadEmailSettings();
      } else {
        await loadHrmsSettings();
      }
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
      const draft = data.draft || {};
      setField(emailForm, "host", smtp.host || "");
      setField(emailForm, "port", smtp.port || "");
      setField(emailForm, "username", smtp.username || "");
      setField(emailForm, "from_email", smtp.from_email || "");
      setField(emailForm, "from_name", smtp.from_name || "");
      setField(emailForm, "subject", draft.subject || "You have been invited to the policy portal");
      setField(emailForm, "body", draft.body || "Hello {{name}}, you have been added to the {{organization}} policy portal.");
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
    const nextTab = isSectionAllowed(requestedTab) ? requestedTab : "modules";
    document.querySelectorAll("[data-admin-section]").forEach((section) => {
      section.classList.toggle("is-active", section.dataset.adminSection === nextTab);
    });
    if (adminTitle) adminTitle.textContent = tabTitles[nextTab] || "Manage organization";
    const normalizedHash = query ? `#${nextTab}?${query}` : `#${nextTab}`;
    if (window.location.hash !== normalizedHash) window.history.replaceState(null, "", normalizedHash);
    if (nextTab === "modules" && query.includes("create=1")) {
      setTimeout(() => document.querySelector("[data-module-create] input[name='name']")?.focus(), 50);
    }
    if (nextTab === "hrms") {
      loadHrmsSettings();
    }
  };

  const initialAdminRoute = (window.location.hash || "#modules").slice(1);
  loadSettings().finally(() => activateTab(initialAdminRoute));
  loadModules();

  settingsForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const selected = settingsForm.querySelector('input[name="access_mode"]:checked')?.value;
    if (!selected) return;
    try {
      const data = await apiJson("/api/org/settings", {
        method: "PATCH",
        body: JSON.stringify({ access_mode: selected }),
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
      const input = module.querySelector(".admin-input");
      const name = input?.value.trim();
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

  peopleForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(peopleForm);
    try {
      const people = await apiJson("/api/org/people", {
        method: "POST",
        body: JSON.stringify({
          email: form.get("email"),
          role: "employee",
          status: "active",
        }),
      });
      peopleForm.reset();
      const first = people?.[0];
      if (first?.email_sent) {
        showToast(`Employee added. Sign-in link sent to ${first.email}.`, "info");
      } else if (first?.dev_link) {
        // Dev-mode shortcut: copy this link, open it on the same browser as
        // the admin to verify the flow without checking email.
        showToast(`Employee added. Dev sign-in link: ${first.dev_link}`, "info");
      } else if (first?.email_error) {
        showToast(`Employee added but invite email failed: ${first.email_error}`, "error");
      } else {
        showToast("Employee added.", "info");
      }
      await loadPeople();
    } catch (error) {
      showToast(error.message || "Could not add person.", "error");
    }
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
      showToast("People imported.", "info");
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
        await apiJson(`/api/org/people/${id}`, { method: "PATCH", body: JSON.stringify({ status: "invited" }) });
        showToast("Marked invited.", "info");
      }
      if (button.dataset.peopleAction === "disable") {
        await apiJson(`/api/org/people/${id}`, { method: "PATCH", body: JSON.stringify({ status: "disabled" }) });
        showToast("Person disabled.", "info");
      }
      if (button.dataset.peopleAction === "resend-invite") {
        const data = await apiJson(`/api/org/people/${id}/resend-invite`, { method: "POST" });
        if (data.email_sent) {
          showToast(`Fresh sign-in link sent to ${data.email}.`, "info");
        } else if (data.dev_link) {
          showToast(`Dev link: ${data.dev_link}`, "info");
        } else {
          showToast(data.email_error || "Could not send invite.", "error");
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
          draft: {
            subject: form.get("subject"),
            body: form.get("body"),
          },
        }),
      });
      showToast("Email settings saved.", "info");
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
            <input class="admin-input" type="text" placeholder="New policy name" />
            <button class="admin-add-btn" type="button" data-action="add-policy">Add policy</button>
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
        <article class="person-row" data-person-id="${person.id}">
          <div>
            <strong>${escapeHtml(person.name || person.email)}</strong>
            <span>${escapeHtml(person.email)}</span>
          </div>
          <span class="person-pill">${escapeHtml(person.role)}</span>
          <span class="person-pill">${escapeHtml(person.status)}</span>
          ${
            options.adminList
              ? `<div class="admin-actions">
                  <span class="person-pill">${person.invited_at ? "Invite sent" : "Invite not sent"}</span>
                  <button class="icon-btn" type="button" data-people-action="send-invite">Send invite</button>
                  <button class="icon-btn" type="button" data-people-action="disable">Disable</button>
                  <button class="icon-btn danger" type="button" data-people-action="delete">Delete</button>
                </div>`
              : `<div class="admin-actions">
                  <button class="icon-btn" type="button" data-people-action="invite">Invite</button>
                  <button class="icon-btn" type="button" data-people-action="resend-invite">Resend invite</button>
                  <button class="icon-btn" type="button" data-people-action="disable">Disable</button>
                  <button class="icon-btn danger" type="button" data-people-action="delete">Delete</button>
                </div>`
          }
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
  // Single-column "email" file: drop any header line and keep the rest.
  const hasHeader = first === "email" || first.startsWith("email,") || first.startsWith("email ");
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows
    .map((line) => {
      const email = line.split(",")[0]?.trim();
      return { email, role: "employee", status: "active" };
    })
    .filter((row) => row.email && row.email.includes("@"));
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

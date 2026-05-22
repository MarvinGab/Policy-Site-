export const initAuth = () => {
  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(loginForm);
      const email = String(formData.get("email") || formData.get("userid") || "").trim().toLowerCase();
      const password = String(formData.get("password") || "");
      const error = document.getElementById("login-error");
      if (error) error.textContent = "";

      try {
        const response = await fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
          credentials: "include",
        });

        if (!response.ok) {
          const message = await response.text();
          if (error) error.textContent = message || "Login failed. Check your credentials.";
          return;
        }

        const data = await response.json();
        // Super admin → organizations list. (Org admin / employee flows come in Phase 5.)
        window.location.href = data?.role === "super_admin" ? "orgs.html" : "orgs.html";
      } catch (err) {
        if (error) error.textContent = "Login failed. Try again.";
        console.error("Login failed:", err);
      }
    });
  }

  // Pages behind the gate verify the session client-side and bounce to login if cookie is gone.
  const protectedPages = new Set(["orgs", "policies", "policy-admin"]);
  const page = document.body?.dataset.page;
  if (protectedPages.has(page)) {
    fetch("/api/session", { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) {
          window.location.replace("index.html#login");
          return null;
        }
        return response.json();
      })
      .then((data) => {
        if (!data) return;
        document.body.dataset.role = data.role || "employee";
        window.dispatchEvent(new CustomEvent("role-ready"));
      })
      .catch((err) => {
        console.error("Session check failed:", err);
        window.location.replace("index.html#login");
      });
  }

  const logout = document.getElementById("logout");
  if (logout) {
    logout.addEventListener("click", async () => {
      try {
        await fetch("/api/logout", { method: "POST", credentials: "include" });
      } catch (err) {
        console.error("Logout failed:", err);
      }
      window.location.href = "index.html";
    });
  }
};

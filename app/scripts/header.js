export const initHeader = () => {
  const header = document.querySelector(".site-header");
  if (!header) return;

  const onScroll = () => {
    const scrolled = window.scrollY > 20;
    header.classList.toggle("scrolled", scrolled);
    const progress = Math.min(window.scrollY / 160, 1);
    header.style.setProperty("--scroll-progress", progress.toString());
  };

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  // Logo behavior: on the landing page, smooth-scroll to top instead of reloading.
  // On other pages, the anchor's default navigation to index.html takes over.
  const homeLink = header.querySelector("[data-home]");
  const page = document.body?.dataset.page || "landing";
  if (homeLink && page === "policies") {
    homeLink.setAttribute("href", "policies.html");
    homeLink.setAttribute("aria-label", "ZaroHR — modules");
  } else if (homeLink && page === "policy-admin") {
    homeLink.setAttribute("href", "policies.html");
    homeLink.setAttribute("aria-label", "ZaroHR — back to modules");
  } else if (homeLink && page === "orgs") {
    homeLink.setAttribute("href", "orgs.html");
    homeLink.setAttribute("aria-label", "ZaroHR — organizations");
  }

  if (homeLink && page === "landing") {
    homeLink.addEventListener("click", (event) => {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
};

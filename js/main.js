"use strict";

const header = document.getElementById("site-header");
const navToggle = document.getElementById("nav-toggle");
const nav = document.getElementById("site-nav");

navToggle.addEventListener("click", () => {
  const isOpen = header.classList.toggle("nav-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    header.classList.remove("nav-open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});

// Highlights the nav link for whichever section is currently in view,
// matching the app's own "active" underline state (app.css's #nav
// button.active) instead of leaving nav state static during a scroll.
const sectionLinks = new Map();
nav.querySelectorAll("a[href^='#']").forEach((link) => {
  const section = document.querySelector(link.getAttribute("href"));
  if (section) {
    sectionLinks.set(section, link);
  }
});

if (sectionLinks.size > 0 && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const link = sectionLinks.get(entry.target);
        if (!link) return;
        if (entry.isIntersecting) {
          nav.querySelectorAll("a.active").forEach((a) => a.classList.remove("active"));
          link.classList.add("active");
        }
      });
    },
    { rootMargin: "-50% 0px -50% 0px" }
  );

  sectionLinks.forEach((_link, section) => observer.observe(section));
}

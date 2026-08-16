"use strict";

const header = document.getElementById("site-header");
const navToggle = document.getElementById("nav-toggle");
const nav = document.getElementById("site-nav");

// Mobile navigation toggle
navToggle.addEventListener("click", () => {
  const isOpen = header.classList.toggle("nav-open");
  navToggle.setAttribute("aria-expanded", String(isOpen));
});

// Close mobile navigation after clicking a link
nav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    header.classList.remove("nav-open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});

// ------------------------------------------------------------
// Active navigation underline
// ------------------------------------------------------------

const navLinks = nav.querySelectorAll("a[href^='#']");
const sectionLinks = new Map();

navLinks.forEach((link) => {
  const target = document.querySelector(link.getAttribute("href"));

  if (target) {
    sectionLinks.set(target, link);
  }
});

function setActiveLink(activeLink) {
  nav.querySelectorAll("a.active").forEach((link) => {
    link.classList.remove("active");
  });

  if (activeLink) {
    activeLink.classList.add("active");
  }
}

// Immediately activate the clicked navigation link
navLinks.forEach((link) => {
  link.addEventListener("click", () => {
    setActiveLink(link);
  });
});

// Update active link while scrolling
if (sectionLinks.size > 0 && "IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      const visibleSections = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => {
          return b.intersectionRatio - a.intersectionRatio;
        });

      if (visibleSections.length === 0) {
        return;
      }

      const activeLink = sectionLinks.get(visibleSections[0].target);

      if (activeLink) {
        setActiveLink(activeLink);
      }
    },
    {
      rootMargin: "-20% 0px -60% 0px",
      threshold: [0, 0.1, 0.25, 0.5, 1],
    }
  );

  sectionLinks.forEach((_link, section) => {
    observer.observe(section);
  });
}
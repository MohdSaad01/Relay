"use strict";

/**
 * Small hand-written inline SVGs used with dom.js's iconBadge(). Kept as
 * plain strings (no icon-font/library dependency, per the finalized
 * plain HTML/CSS/JS desktop stack) and reused wherever a state needs a
 * clear visual focal point instead of a bare heading.
 */

export const qrIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="6" height="6" rx="1"/>
    <rect x="15" y="3" width="6" height="6" rx="1"/>
    <rect x="3" y="15" width="6" height="6" rx="1"/>
    <rect x="15" y="15" width="2.5" height="2.5"/>
    <rect x="18.5" y="15" width="2.5" height="2.5"/>
    <rect x="15" y="18.5" width="2.5" height="2.5"/>
    <rect x="18.5" y="18.5" width="2.5" height="2.5"/>
  </svg>`;

export const deviceIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <rect x="6" y="2" width="12" height="20" rx="2"/>
    <line x1="11" y1="18" x2="13" y2="18"/>
  </svg>`;

export const checkIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>`;

export const xIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>`;

export const clockIcon = `
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="9"/>
    <polyline points="12 7 12 12 15 15"/>
  </svg>`;

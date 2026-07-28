// tenant-bg.js — applies per-tenant visual theme from Firestore + Storage.
//
// Reads tenants/{tenantId} for: accent_color
// Reads Storage for: {tenantId}/background.{ext}  (conventional path)
//
// Call applyTenantBackground() on every kiosk page.

import {
  storage,
  storageRef,
  getDownloadURL,
  getTenantConfig,
} from "./firebase.js?v=1";

const EXTENSIONS = ["jpg", "jpeg", "png", "webp"];
const BG_TIMEOUT_MS = 2500;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findBackgroundURL(tenantId) {
  for (const ext of EXTENSIONS) {
    try {
      return await getDownloadURL(storageRef(storage, `${tenantId}/background.${ext}`));
    } catch (_) { /* try next */ }
  }
  return null;
}

/** Darken a #rrggbb hex color by `amount` (0–255). */
function darken(hex, amount = 20) {
  const r = Math.max(0, parseInt(hex.slice(1, 3), 16) - amount);
  const g = Math.max(0, parseInt(hex.slice(3, 5), 16) - amount);
  const b = Math.max(0, parseInt(hex.slice(5, 7), 16) - amount);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

// ── Font ──────────────────────────────────────────────────────────────────────

function applyFont(family) {
  if (!family) return;
  const link = document.createElement("link");
  link.rel  = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
  document.documentElement.style.setProperty("--font-primary", `"${family}", serif`);
}

// ── Accent color ─────────────────────────────────────────────────────────────

function applyAccentColor(hex) {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return;
  const root = document.documentElement;
  root.style.setProperty("--color-accent", hex);
  root.style.setProperty("--color-accent-dark", darken(hex, 20));
}

// ── Feature flags ────────────────────────────────────────────────────────────
// tenants/{id}.features is a map like { slideshow: true, family: false }. Each
// enabled flag adds an `html.feat-<key>` class (and a data-feat-<key> attr) so
// features can be shown/hidden per tenant from CSS alone — no per-page JS edits.
// An absent flag means "off", so new features stay dark for existing tenants.
function applyFeatureFlags(features) {
  if (!features || typeof features !== "object") return;
  const root = document.documentElement;
  for (const [key, on] of Object.entries(features)) {
    root.classList.toggle(`feat-${key}`, !!on);
    root.setAttribute(`data-feat-${key}`, on ? "on" : "off");
  }
}

// ── String overrides ─────────────────────────────────────────────────────────
// tenants/{id}.strings is a map of { i18nKey: "text" } that overrides the
// page's default copy for any element carrying data-i18n. Absent key = default.
function applyStringOverrides(strings) {
  if (!strings || typeof strings !== "object") return;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const v = strings[el.dataset.i18n];
    if (v != null) el.textContent = v;
  });
}

// ── Main export ──────────────────────────────────────────────────────────────

export async function applyTenantBackground() {
  const tenantId = window.__ENV__?.TENANT_ID;

  document.body.classList.add("bg-loading");
  const timeout = setTimeout(() => document.body.classList.remove("bg-loading"), BG_TIMEOUT_MS);

  try {
    if (!tenantId) return;

    // Fetch tenant config + background URL in parallel
    const [config, bgUrl] = await Promise.all([
      getTenantConfig(),
      findBackgroundURL(tenantId),
    ]);

    if (config.accent_color) applyAccentColor(config.accent_color);
    if (config.font_family)  applyFont(config.font_family);
    applyFeatureFlags(config.features);
    applyStringOverrides(config.strings);

    // Pre-load background image before revealing page
    if (bgUrl) {
      await new Promise((resolve) => {
        const img = new Image();
        img.onload = resolve;
        img.onerror = resolve;
        img.src = bgUrl;
      });
      document.body.style.setProperty("--tenant-bg-url", `url("${bgUrl}")`);
      document.body.classList.add("has-tenant-bg");
    }

  } catch (err) {
    console.warn("[tenant-bg] theme apply failed:", err);
  } finally {
    clearTimeout(timeout);
    document.body.classList.remove("bg-loading");
  }
}

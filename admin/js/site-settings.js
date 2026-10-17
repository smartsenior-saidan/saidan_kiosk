// site-settings.js — 施設設定 tab (super admins only): the per-site look of
// the kiosk, edited from the console instead of the Firebase console.
//
// What it edits, and where the kiosk reads it (kiosk/js/tenant-bg.js):
//   • Site background      Storage  {tid}/background.{jpg|jpeg|png|webp}
//   • Memorial presets 1–5 Storage  {tid}/backgrounds/background{n}.{ext}
//                          (an empty slot falls back to individuals_backgrounds/)
//   • Accent colour, font, welcome text, feature switches
//                          Firestore tenants/{tid} — accent_color, font_family,
//                          strings, features
// The kiosk looks for an image under each extension in that order and uses
// the first it finds, so replacing an image deletes every extension first.
// firestore.rules lets a super admin change only those four keys; storage.rules
// lets only a super admin write the background and preset paths.

import {
  storage,
  storageRef,
  getDownloadURL,
  uploadBytesResumable,
  deleteObject,
  getDoc,
  updateDoc,
  serverTimestamp,
  tenantDoc,
  TENANT_ID,
} from "./firebase.js?v=16";
import { t } from "./i18n.js?v=60";

let esc = (s) => String(s ?? "");
let setStatus = () => {};
let confirmDialog = async () => false;
let onPresetsChanged = () => {};

const EXTS = ["jpg", "jpeg", "png", "webp"];   // same order as the kiosk
const MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const PRESET_COUNT = 5;
const STRING_KEYS = ["greetingMain", "greetingSub", "startBtn", "startHint", "icNote"];
// Google Fonts families with Japanese glyphs, offered in the font dropdown.
// The empty value is the kiosk's own default (Shippori Mincho in kiosk.css).
// [family, style] — the style word is translated for the label.
const FONT_OPTIONS = [
  ["Noto Serif JP", "mincho"],
  ["Noto Sans JP", "gothic"],
  ["Zen Old Mincho", "mincho"],
  ["Zen Kaku Gothic New", "gothic"],
  ["BIZ UDPMincho", "mincho"],
  ["BIZ UDPGothic", "gothic"],
  ["Sawarabi Mincho", "mincho"],
  ["Kosugi Maru", "rounded"],
  ["Klee One", "hand"],
  ["Kaisei Tokumin", "mincho"],
];
const FEATURE_KEYS = ["family", "slideshow"];
const MAX_BYTES = 8 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const bgBase = () => `${TENANT_ID}/background`;
const presetBase = (n) => `${TENANT_ID}/backgrounds/background${n}`;
const sharedBase = (n) => `individuals_backgrounds/background${n}`;

// ── Storage helpers ─────────────────────────────────────────────────────────

/** The first existing image under `base` across the known extensions. */
async function findImage(base) {
  for (const ext of EXTS) {
    const path = `${base}.${ext}`;
    try { return { path, url: await getDownloadURL(storageRef(storage, path)) }; } catch (_) { /* next */ }
  }
  return null;
}

async function deleteImage(base) {
  for (const ext of EXTS) {
    try { await deleteObject(storageRef(storage, `${base}.${ext}`)); } catch (_) { /* not there */ }
  }
}

/** Replace whatever is under `base` with `file` (its own extension). */
async function replaceImage(base, file) {
  const ext = MIME_EXT[file.type];
  if (!ext) throw new Error(t("site.badType"));
  if (file.size > MAX_BYTES) throw new Error(t("site.tooBig"));
  await deleteImage(base);
  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(storageRef(storage, `${base}.${ext}`), file, {
      contentType: file.type,
      cacheControl: "public,max-age=300",
    });
    task.on("state_changed", null, reject, resolve);
  });
}

// ── Site background ─────────────────────────────────────────────────────────

async function renderBackground() {
  const box = $("siteBgPreview");
  const del = $("siteBgDelete");
  if (!box) return;
  box.innerHTML = `<span class="site-bg-empty">${esc(t("site.loading"))}</span>`;
  const img = await findImage(bgBase());
  if (img) {
    box.innerHTML = `<img src="${esc(img.url)}" alt="" />`;
    if (del) del.disabled = false;
  } else {
    box.innerHTML = `<span class="site-bg-empty">${esc(t("site.bgNone"))}</span>`;
    if (del) del.disabled = true;
  }
}

async function uploadBackground(file) {
  setStatus(t("site.uploading"), "info");
  try {
    await replaceImage(bgBase(), file);
    await renderBackground();
    setStatus(t("site.bgSaved"), "success");
  } catch (err) {
    console.error("[site] background upload failed:", err);
    setStatus(t("site.uploadFailed", { msg: err.message || err }), "error");
  }
}

async function removeBackground() {
  const ok = await confirmDialog({
    title: t("site.removeBgTitle"),
    body: t("site.removeBgBody"),
    confirmLabel: t("site.remove"),
  });
  if (!ok) return;
  setStatus(t("site.removing"), "info");
  try {
    await deleteImage(bgBase());
    await renderBackground();
    setStatus(t("site.bgRemoved"), "success");
  } catch (err) {
    console.error("[site] background delete failed:", err);
    setStatus(t("site.uploadFailed", { msg: err.message || err }), "error");
  }
}

// ── Memorial-page presets ───────────────────────────────────────────────────

async function renderPresets() {
  const wrap = $("sitePresets");
  if (!wrap) return;
  wrap.innerHTML = Array.from({ length: PRESET_COUNT }, (_, i) => `
    <div class="site-preset" data-n="${i + 1}">
      <div class="site-preset-img"><span class="site-bg-empty">${esc(t("site.loading"))}</span></div>
      <div class="site-preset-meta">
        <span class="site-preset-no">${i + 1}</span>
        <span class="site-preset-badge" data-badge></span>
      </div>
      <div class="site-preset-actions">
        <label class="btn-secondary btn-file"><input type="file" accept="image/jpeg,image/png,image/webp" data-upload="${i + 1}" hidden /><span>${esc(t("site.upload"))}</span></label>
        <button type="button" class="btn-danger" data-delete="${i + 1}" disabled>${esc(t("site.remove"))}</button>
      </div>
    </div>`).join("");

  await Promise.all(Array.from({ length: PRESET_COUNT }, (_, i) => renderPresetSlot(i + 1)));

  wrap.querySelectorAll("[data-upload]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      const n = Number(input.dataset.upload);
      setStatus(t("site.uploading"), "info");
      try {
        await replaceImage(presetBase(n), file);
        await renderPresetSlot(n);
        onPresetsChanged();
        setStatus(t("site.presetSaved", { n }), "success");
      } catch (err) {
        console.error("[site] preset upload failed:", err);
        setStatus(t("site.uploadFailed", { msg: err.message || err }), "error");
      }
    });
  });
  wrap.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const n = Number(btn.dataset.delete);
      const ok = await confirmDialog({
        title: t("site.removePresetTitle", { n }),
        body: t("site.removePresetBody"),
        confirmLabel: t("site.remove"),
      });
      if (!ok) return;
      setStatus(t("site.removing"), "info");
      try {
        await deleteImage(presetBase(n));
        await renderPresetSlot(n);
        onPresetsChanged();
        setStatus(t("site.presetRemoved", { n }), "success");
      } catch (err) {
        console.error("[site] preset delete failed:", err);
        setStatus(t("site.uploadFailed", { msg: err.message || err }), "error");
      }
    });
  });
}

/** One slot: the site's own image, else the shared default (marked), else empty. */
async function renderPresetSlot(n) {
  const slot = document.querySelector(`.site-preset[data-n="${n}"]`);
  if (!slot) return;
  const imgBox = slot.querySelector(".site-preset-img");
  const badge = slot.querySelector("[data-badge]");
  const del = slot.querySelector("[data-delete]");
  const own = await findImage(presetBase(n));
  const shared = own ? null : await findImage(sharedBase(n));
  if (own) {
    imgBox.innerHTML = `<img src="${esc(own.url)}" alt="" />`;
    badge.textContent = t("site.presetOwn");
    badge.className = "site-preset-badge own";
    del.disabled = false;
  } else if (shared) {
    imgBox.innerHTML = `<img src="${esc(shared.url)}" alt="" class="is-shared" />`;
    badge.textContent = t("site.presetShared");
    badge.className = "site-preset-badge shared";
    del.disabled = true;
  } else {
    imgBox.innerHTML = `<span class="site-bg-empty">${esc(t("site.presetEmpty"))}</span>`;
    badge.textContent = "";
    badge.className = "site-preset-badge";
    del.disabled = true;
  }
}

// ── Theme, welcome text, features (tenant document) ─────────────────────────

const isHex = (v) => /^#[0-9a-f]{6}$/i.test(v || "");

/** Fill the font dropdown; a saved family that isn't in the list is kept as
 *  its own option so an older setting is never silently dropped. */
function renderFontOptions(current) {
  const sel = $("siteFont");
  if (!sel) return;
  const opts = [`<option value="">${esc(t("site.fontDefault"))}</option>`];
  for (const [family, style] of FONT_OPTIONS) {
    opts.push(`<option value="${esc(family)}">${esc(family)}（${esc(t(`site.fontStyle.${style}`))}）</option>`);
  }
  if (current && !FONT_OPTIONS.some(([f]) => f === current)) {
    opts.push(`<option value="${esc(current)}">${esc(current)}</option>`);
  }
  sel.innerHTML = opts.join("");
  sel.value = current || "";
}

async function loadTheme() {
  let cfg = {};
  try {
    const snap = await getDoc(tenantDoc());
    cfg = snap.exists() ? snap.data() : {};
  } catch (err) {
    console.warn("[site] tenant config load failed:", err);
  }
  const accent = isHex(cfg.accent_color) ? cfg.accent_color : "";
  if ($("siteAccent")) $("siteAccent").value = accent || "#3a7d44";
  if ($("siteAccentHex")) $("siteAccentHex").value = accent;
  renderFontOptions((cfg.font_family || "").trim());
  const strings = cfg.strings || {};
  STRING_KEYS.forEach((k) => { const el = $(`siteStr_${k}`); if (el) el.value = strings[k] || ""; });
  const features = cfg.features || {};
  // Absent means "not switched off": the kiosk shows everything unless told not to.
  FEATURE_KEYS.forEach((k) => { const el = $(`siteFeat_${k}`); if (el) el.checked = features[k] !== false; });
}

async function saveTheme() {
  const btn = $("siteSaveBtn");
  const hex = ($("siteAccentHex")?.value || "").trim();
  if (hex && !isHex(hex)) { setStatus(t("site.badColor"), "error"); $("siteAccentHex")?.focus(); return; }
  const strings = {};
  STRING_KEYS.forEach((k) => { const v = ($(`siteStr_${k}`)?.value || "").trim(); if (v) strings[k] = v; });
  const features = {};
  FEATURE_KEYS.forEach((k) => { features[k] = !!$(`siteFeat_${k}`)?.checked; });

  if (btn) btn.disabled = true;
  setStatus(t("site.saving"), "info");
  try {
    await updateDoc(tenantDoc(), {
      accent_color: hex,
      font_family: ($("siteFont")?.value || "").trim(),
      strings,
      features,
      updated_at: serverTimestamp(),
    });
    setStatus(t("site.themeSaved"), "success");
  } catch (err) {
    console.error("[site] theme save failed:", err);
    setStatus(t("site.saveFailed", { msg: err.message || err }), "error");
  } finally {
    if (btn) btn.disabled = false;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

let loaded = false;
let loading = null;

export function initSiteSettingsPanel(deps) {
  esc = deps.esc;
  setStatus = deps.setStatus;
  confirmDialog = deps.confirmDialog;
  onPresetsChanged = deps.onPresetsChanged || (() => {});

  $("siteBgFile")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) uploadBackground(file);
  });
  $("siteBgDelete")?.addEventListener("click", removeBackground);

  // Colour picker ⇄ hex box stay in step; the hex box is what gets saved.
  $("siteAccent")?.addEventListener("input", (e) => { if ($("siteAccentHex")) $("siteAccentHex").value = e.target.value; });
  $("siteAccentHex")?.addEventListener("input", (e) => { if (isHex(e.target.value) && $("siteAccent")) $("siteAccent").value = e.target.value; });

  $("siteSaveBtn")?.addEventListener("click", saveTheme);
}

/** Called each time the tab is opened: loads once per session, then reuses. */
export async function openSiteSettingsPanel() {
  if (loaded) return;
  if (!loading) {
    loading = Promise.all([renderBackground(), renderPresets(), loadTheme()])
      .then(() => { loaded = true; })
      .finally(() => { loading = null; });
  }
  await loading;
}

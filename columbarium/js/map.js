// map.js — 2D floor map (STATE 3) + 2.5D niche detail (STATE 4).
//
// The visitor selects a record, sees its section highlighted on a floor map,
// then zooms into a 2.5D niche wall showing the row. Everything here is a
// SWAPPABLE PLACEHOLDER driven by the record's plot_section / plot_row:
//   • Replace the generated SVG with the client's real floor map by providing
//     assets/map/sections.json (array of { id, label, x, y, w, h }) — see
//     loadSections(). Coordinates are in the VIEW_W×VIEW_H space below.
//   • The niche wall dimensions come from config.json (nicheRows/nicheCols);
//     add a column/tier field in the admin to place the exact niche.

const VIEW_W = 1000;
const VIEW_H = 700;
const ZOOM_MIN = 1;
const ZOOM_MAX = 6;

// Default placeholder layout (2×4 blocks). Swapped by assets/map/sections.json.
const DEFAULT_SECTIONS = [
  { id: "A", x: 90,  y: 130, w: 175, h: 150 },
  { id: "B", x: 305, y: 130, w: 175, h: 150 },
  { id: "C", x: 520, y: 130, w: 175, h: 150 },
  { id: "D", x: 735, y: 130, w: 175, h: 150 },
  { id: "E", x: 90,  y: 340, w: 175, h: 150 },
  { id: "F", x: 305, y: 340, w: 175, h: 150 },
  { id: "G", x: 520, y: 340, w: 175, h: 150 },
  { id: "H", x: 735, y: 340, w: 175, h: 150 },
];
const KIOSK = { x: 500, y: 630 }; // "you are here" — kiosk position near entrance

let cfg = { zoomThreshold: 2.5, nicheRows: 6, nicheCols: 12 };
let S = {};
let els = {};
let sections = DEFAULT_SECTIONS;
let target = null; // active section object

// pan/zoom state
let scale = 1, tx = 0, ty = 0;
const pointers = new Map();
let pinchPrevDist = 0;
let dragLast = null;
let dragMoved = false;

// ── helpers ────────────────────────────────────────────────────────────────
const toHalf = (s) =>
  (s || "").toString().replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );

/** Optional real layout: assets/map/sections.json overrides the placeholder. */
async function loadSections() {
  try {
    const res = await fetch("./assets/map/sections.json", { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length) return data;
    }
  } catch (_) {}
  return DEFAULT_SECTIONS;
}

// ── 2D floor map ─────────────────────────────────────────────────────────────
function buildFloorSvg(targetId) {
  const rects = sections
    .map((s) => {
      const isTarget = s.id === targetId;
      const cx = s.x + s.w / 2;
      const cy = s.y + s.h / 2;
      return `
        <g class="sec ${isTarget ? "is-target" : ""}" data-section="${s.id}">
          <rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="10"/>
          <text x="${cx}" y="${cy}" class="sec-label">${s.label || s.id}</text>
        </g>`;
    })
    .join("");

  const t = sections.find((s) => s.id === targetId);
  const connector = t
    ? `<line class="here-path" x1="${KIOSK.x}" y1="${KIOSK.y}"
         x2="${t.x + t.w / 2}" y2="${t.y + t.h / 2}"/>`
    : "";

  return `
    <svg viewBox="0 0 ${VIEW_W} ${VIEW_H}" class="floor-svg" xmlns="http://www.w3.org/2000/svg">
      <rect class="building" x="40" y="70" width="${VIEW_W - 80}" height="${VIEW_H - 140}" rx="18"/>
      ${connector}
      ${rects}
      <g class="here">
        <circle cx="${KIOSK.x}" cy="${KIOSK.y}" r="13"/>
        <text x="${KIOSK.x}" y="${KIOSK.y + 40}" class="here-label">現在地</text>
      </g>
    </svg>`;
}

function applyTransform() {
  els.world.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
}

/** Reset to a centered, fully-visible view (contain-fit the 10:7 plan). */
function fitView() {
  scale = 1;
  const vp = els.viewport.getBoundingClientRect();
  const fitW = Math.min(vp.width, (vp.height * VIEW_W) / VIEW_H) * 0.92;
  els.world.style.width = `${fitW}px`;
  tx = (vp.width - fitW) / 2;
  ty = (vp.height - (fitW * VIEW_H) / VIEW_W) / 2;
  applyTransform();
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/** Zoom toward viewport point (cx, cy in px relative to viewport). */
function zoomAround(factor, cx, cy) {
  const next = clamp(scale * factor, ZOOM_MIN, ZOOM_MAX);
  const k = next / scale;
  tx = cx - (cx - tx) * k;
  ty = cy - (cy - ty) * k;
  scale = next;
  applyTransform();
  maybeEnter25d();
}

/** True when the highlighted section sits near the middle of the viewport. */
function targetCentered() {
  const tEl = els.world.querySelector(".sec.is-target rect");
  if (!tEl) return false;
  const r = tEl.getBoundingClientRect();
  const vp = els.viewport.getBoundingClientRect();
  const dx = (r.left + r.width / 2) - (vp.left + vp.width / 2);
  const dy = (r.top + r.height / 2) - (vp.top + vp.height / 2);
  return Math.abs(dx) < vp.width * 0.3 && Math.abs(dy) < vp.height * 0.3;
}

function maybeEnter25d() {
  if (scale >= cfg.zoomThreshold && targetCentered()) enter25d();
}

// ── 2.5D niche wall ──────────────────────────────────────────────────────────
function buildNicheWall(person) {
  const rows = cfg.nicheRows || 6;
  const cols = cfg.nicheCols || 12;
  const targetRow = parseInt(toHalf(person.plot_row), 10); // 1-based, may be NaN
  const targetCol = parseInt(toHalf(person.plot_col), 10); // usually absent → NaN

  let cells = "";
  for (let r = 1; r <= rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const rowHit = !isNaN(targetRow) && r === targetRow;
      const colHit = !isNaN(targetCol) && c === targetCol;
      const exact = rowHit && colHit;
      const cls = exact ? "niche exact" : rowHit ? "niche row-hit" : "niche";
      cells += `<div class="${cls}"></div>`;
    }
  }
  els.nicheWall.style.setProperty("--cols", cols);
  els.nicheWall.innerHTML = cells;

  const sec = person.plot_section || (person.plot || "").split(/[-－]/)[0] || "";
  const rowTxt = !isNaN(targetRow) ? `${targetRow}段目` : (person.plot_row || "");
  els.nicheLabel.textContent = [sec ? `${sec}区画` : "", rowTxt].filter(Boolean).join("　・　");
}

function enter25d() {
  buildNicheWall(target._person);
  els.map25d.classList.remove("hidden");
  els.map2d.classList.add("hidden");
}

function back2d() {
  els.map25d.classList.add("hidden");
  els.map2d.classList.remove("hidden");
  fitView();
}

// ── pointer interaction (pan + wheel/pinch zoom, tap-to-open) ─────────────────
function wireInteraction() {
  const vp = els.viewport;

  vp.addEventListener("pointerdown", (e) => {
    vp.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragLast = { x: e.clientX, y: e.clientY };
    dragMoved = false;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchPrevDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  vp.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const vpr = vp.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - vpr.left;
      const my = (a.y + b.y) / 2 - vpr.top;
      if (pinchPrevDist > 0) zoomAround(dist / pinchPrevDist, mx, my);
      pinchPrevDist = dist;
      dragMoved = true;
      return;
    }

    // single-pointer pan
    const dx = e.clientX - dragLast.x;
    const dy = e.clientY - dragLast.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
    tx += dx;
    ty += dy;
    dragLast = { x: e.clientX, y: e.clientY };
    applyTransform();
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchPrevDist = 0;
  };
  vp.addEventListener("pointerup", endPointer);
  vp.addEventListener("pointercancel", endPointer);

  // Wheel zoom (desktop testing).
  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    const vpr = vp.getBoundingClientRect();
    zoomAround(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - vpr.left, e.clientY - vpr.top);
  }, { passive: false });

  // Tap the highlighted section → open its 2.5D detail (no pinch needed).
  els.world.addEventListener("click", (e) => {
    if (dragMoved) return;
    if (e.target.closest(".sec.is-target")) enter25d();
  });
}

// ── public API ───────────────────────────────────────────────────────────────
export function initMap({ config, strings, elements }) {
  cfg = { ...cfg, ...config };
  S = strings || {};
  els = elements;
  wireInteraction();
  els.backTo2d?.addEventListener("click", back2d);
  loadSections().then((s) => { sections = s; });
}

/** Render the map for a person and reset to the 2D view. */
export function renderLocation(person) {
  const secId = person.plot_section || (person.plot || "").split(/[-－]/)[0] || "";
  target = sections.find((s) => s.id === secId) || { id: secId, _person: person };
  target._person = person;

  els.world.innerHTML = buildFloorSvg(target.id);
  els.map25d.classList.add("hidden");
  els.map2d.classList.remove("hidden");
  fitView();
}

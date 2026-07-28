// app.js — Columbarium guide kiosk: state machine, screens, idle timers.
//
// States (SRS §4):
//   welcome → search → map(2D) → map(2.5D)
// Map rendering is a placeholder for now; the real indoor map plugs into the
// #screen-map slot later. Everything else (wake, search, idle returns) is live.

import { searchByName, searchBySection, loadPersons, isOffline } from "./search.js";
import { mountKanaKeyboard, mountSectionKeypad } from "./kana-keyboard.js";
import { loadStrings } from "./strings.js";
import { initMap, renderLocation } from "./map.js";

// ── Config ────────────────────────────────────────────────────────────────
const DEFAULT_CFG = {
  idleToWelcomeMs: 180000,
  idleToSearchMs: 60000,
  zoomThreshold: 2.5,
  sensorKeystroke: null, // null = any key wakes from Welcome (dev-friendly)
};

async function loadConfig() {
  try {
    const res = await fetch("./config.json", { cache: "no-store" });
    if (!res.ok) return { ...DEFAULT_CFG };
    return { ...DEFAULT_CFG, ...(await res.json()) };
  } catch (_) {
    return { ...DEFAULT_CFG };
  }
}

/**
 * Load a screen's background photo and apply it once decoded (AC-9). Resolves
 * true when applied, false if there's no url / it fails — so boot can wait for
 * the entry image before revealing the page (no pop-in).
 */
function loadBackground(screenId, url) {
  return new Promise((resolve) => {
    if (!url) return resolve(false);
    const bg = document.querySelector(`#${screenId} .bg`);
    if (!bg) return resolve(false);
    const img = new Image();
    img.onload = () => {
      bg.style.backgroundImage = `url("${url}")`;
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

async function loadWelcomeOverride(strings) {
  try {
    const res = await fetch("./assets/welcome/welcome_text.json", { cache: "no-store" });
    if (res.ok) return { ...strings, ...(await res.json()) };
  } catch (_) {}
  return strings;
}

// ── App ─────────────────────────────────────────────────────────────────────
let CFG = DEFAULT_CFG;
let S = {}; // strings
let STATE = "welcome";
let selected = null; // person chosen for the map view

const el = (id) => document.getElementById(id);

// ── Text application ──────────────────────────────────────────────────────
function applyText() {
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    if (S[key] != null) node.textContent = S[key];
  });
  document.querySelectorAll("[data-i18n-html]").forEach((node) => {
    const key = node.dataset.i18nHtml;
    if (S[key] != null) node.innerHTML = S[key];
  });
  el("nameInput").placeholder = S.namePlaceholder || "";
  el("sectionInput").placeholder = S.sectionPlaceholder || "";
}

// ── State machine ─────────────────────────────────────────────────────────
let idleTimer = null;

function armIdle() {
  clearTimeout(idleTimer);
  idleTimer = null;
  if (STATE === "search") {
    idleTimer = setTimeout(() => go("welcome"), CFG.idleToWelcomeMs);
  } else if (STATE === "map") {
    idleTimer = setTimeout(() => go("search"), CFG.idleToSearchMs);
  }
}

function go(state) {
  STATE = state;
  for (const s of ["welcome", "search", "map"]) {
    el(`screen-${s}`).classList.toggle("active", s === state);
  }
  if (state === "welcome") resetSearch();
  if (state === "search") setTimeout(() => el("nameInput")?.focus?.(), 50);
  armIdle();
}

function onActivity() {
  if (STATE !== "welcome") armIdle();
}

// ── Search screen ─────────────────────────────────────────────────────────
let activeMode = "name"; // 'name' | 'section'

function switchMode(mode) {
  activeMode = mode;
  el("tabName").classList.toggle("active", mode === "name");
  el("tabSection").classList.toggle("active", mode === "section");
  el("panel-name").classList.toggle("hidden", mode !== "name");
  el("panel-section").classList.toggle("hidden", mode !== "section");
  el("results").innerHTML = "";
}

function resetSearch() {
  el("nameInput").value = "";
  el("sectionInput").value = "";
  el("results").innerHTML = "";
  switchMode("name");
}

function formatDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return "";
  return `${y}年${m}月${d}日`;
}

function renderResults(list) {
  const box = el("results");
  box.innerHTML = "";
  if (!list.length) {
    box.innerHTML = `<div class="results-empty">${S.noResults}</div>`;
    return;
  }
  const count = document.createElement("p");
  count.className = "results-count";
  count.textContent = (S.resultsCount || "{n}").replace("{n}", list.length);
  box.appendChild(count);

  for (const person of list) {
    const name = `${person.last_name || ""} ${person.first_name || ""}`.trim();
    const reading = `${person.last_name_kana || ""} ${person.first_name_kana || ""}`.trim();
    const card = document.createElement("div");
    card.className = "result-card";
    card.innerHTML = `
      <div class="rc-main">
        <div class="rc-name">${name || "—"}</div>
        ${reading ? `<div class="rc-reading">${reading}</div>` : ""}
      </div>
      <div class="rc-meta">
        ${person.plot ? `<span class="rc-section">${S.labelSection} <strong>${person.plot}</strong></span>` : ""}
      </div>
      <button type="button" class="rc-go">${S.showLocation}</button>`;
    card.querySelector(".rc-go").addEventListener("click", () => {
      selected = person;
      showMap(person);
    });
    box.appendChild(card);
  }
}

async function runSearch() {
  const box = el("results");
  try {
    const list =
      activeMode === "name"
        ? await searchByName(el("nameInput").value)
        : await searchBySection(el("sectionInput").value);
    renderResults(list);
    el("offlineBadge").classList.toggle("show", isOffline());
  } catch (err) {
    console.error("[search] failed:", err);
    box.innerHTML = `<div class="results-empty">${S.searchUnavailable}</div>`;
  }
}

function wireSearchInputs() {
  let debounce;
  const live = () => {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, 220);
  };
  el("nameInput").addEventListener("input", live);
  el("sectionInput").addEventListener("input", live);
  el("searchBtn").addEventListener("click", () => {
    clearTimeout(debounce);
    runSearch();
  });
  el("clearBtn").addEventListener("click", resetSearch);
  el("tabName").addEventListener("click", () => switchMode("name"));
  el("tabSection").addEventListener("click", () => switchMode("section"));
  el("backWelcomeBtn").addEventListener("click", () => go("welcome"));
}

// ── Map (placeholder) ─────────────────────────────────────────────────────
function showMap(person) {
  const name = `${person.last_name || ""} ${person.first_name || ""}`.trim();
  el("mapName").textContent = name || "—";
  el("mapSection").textContent = person.plot ? `${S.labelSection} ${person.plot}` : "";
  renderLocation(person);
  go("map");
}

function wireMap() {
  document
    .querySelectorAll(".js-end")
    .forEach((b) => b.addEventListener("click", () => go("search")));
}

// ── Wake / motion sensor ──────────────────────────────────────────────────
function wireWake() {
  // Touch anywhere on Welcome → Search.
  el("screen-welcome").addEventListener("pointerdown", () => {
    if (STATE === "welcome") go("search");
  });
  // Motion sensor emulates a keyboard (SRS §2). A keystroke wakes from Welcome.
  document.addEventListener("keydown", (e) => {
    if (STATE !== "welcome") return;
    if (!CFG.sensorKeystroke || e.key === CFG.sensorKeystroke) go("search");
  });
  // Any activity resets the idle timers (counts as "touch/motion" for §4).
  document.addEventListener("pointerdown", onActivity, true);
  document.addEventListener("keydown", onActivity, true);
}

// ── Boot ──────────────────────────────────────────────────────────────────
async function boot() {
  CFG = await loadConfig();
  S = await loadWelcomeOverride(await loadStrings());
  applyText();

  // Search bg loads lazily — it isn't the first screen shown.
  loadBackground("screen-search", CFG.assets?.searchBackground);

  mountKanaKeyboard({ root: el("kanaKeyboard"), input: el("nameInput") });
  mountSectionKeypad({ mainEl: el("sectionKeypad"), input: el("sectionInput") });
  wireSearchInputs();
  wireMap();
  wireWake();

  initMap({
    config: {
      zoomThreshold: CFG.zoomThreshold,
      nicheRows: CFG.nicheRows,
      nicheCols: CFG.nicheCols,
    },
    strings: S,
    elements: {
      viewport: el("mapViewport"),
      world: el("mapWorld"),
      map2d: el("map2d"),
      map25d: el("map25d"),
      nicheWall: el("nicheWall"),
      nicheLabel: el("nicheLabel"),
      backTo2d: el("backTo2d"),
    },
  });

  // Warm the record cache so the first keystroke is instant (and seeds the
  // offline cache).
  loadPersons().catch((err) => console.warn("[boot] preload failed:", err));

  go("welcome");

  // Reveal only once the entry background + display font are ready, so the
  // welcome screen appears complete — no photo pop-in, no font-swap reflow.
  // Capped at 2.5s so a slow network can never block the reveal.
  const fontReady =
    document.fonts && document.fonts.load
      ? document.fonts.load("700 1em 'Shippori Mincho'").then(() => document.fonts.ready)
      : Promise.resolve();
  await Promise.race([
    Promise.all([loadBackground("screen-welcome", CFG.assets?.welcomeBackground), fontReady]),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  document.body.classList.remove("booting");
}

boot();

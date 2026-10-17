// access-log.js — one anonymous, append-only record per memorial page view,
// so the admin's 利用状況 tab can show how much each family's memorial is
// opened. Written by the unauthenticated kiosk; firestore.rules accepts only
// these fields, at these sizes, and never an update or delete.
//
// Every record carries a VISIT id: one use of the kiosk, from the welcome
// screen (or a direct card / QR / link open) until 参拝終了 or the welcome
// screen comes back. The admin counts visitors by distinct visit, so one
// person opening a family, two memorials and the slideshow is one visitor.
// A page opened directly (no `via`) ALWAYS starts a new visit: a card tap is
// a new visitor even if the previous one walked off without 参拝終了.
//
// Mirrors rem-multi's accessLogs shape (date / ym / h / w are JST so every
// chart aggregates on Japan time regardless of where it is viewed).

import {
  addDoc,
  collection,
  tenantDoc,
  serverTimestamp,
  TENANT_ID,
} from "./firebase.js?v=2";

const DEV_KEY   = "kiosk_dev_id";   // localStorage — one anonymous id per browser
const VISIT_KEY = "kiosk_visit";    // sessionStorage — the current use of the kiosk
const ENTRY_KEY = "kiosk_entry";    // sessionStorage — how this visit began
const LAST_KEY  = "kiosk_last_log"; // sessionStorage — reload guard
const DEDUPE_MS = 60 * 1000;

function deviceId() {
  try {
    let id = localStorage.getItem(DEV_KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
        .map((b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(DEV_KEY, id);
    }
    return id;
  } catch (_) {
    return "anon";
  }
}

/** The visit this page belongs to; `fresh` forces a new one. */
function currentVisit(fresh) {
  try {
    let v = fresh ? null : sessionStorage.getItem(VISIT_KEY);
    if (!v) {
      v = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      sessionStorage.setItem(VISIT_KEY, v);
    }
    return v;
  } catch (_) {
    return "anon";
  }
}

/** The visitor is done: called by thankyou.html and by the welcome screen,
 *  so the next person to touch the kiosk is a new visitor. */
export function endVisit() {
  try {
    sessionStorage.removeItem(VISIT_KEY);
    sessionStorage.removeItem(ENTRY_KEY);
    sessionStorage.removeItem(LAST_KEY);
  } catch (_) { /* private mode */ }
}

const readVia = () => new URLSearchParams(window.location.search).get("via");

/** How this visit began. A page opened with no `via` was reached directly —
 *  an NFC card, a QR code or a pasted link — and that sticks for the rest of
 *  the visit; search.js marks its own hand-offs `via=search`, and the other
 *  pages mark theirs with their own name so the stored entry carries over. */
export function resolveEntry() {
  const via = readVia();
  let entry;
  if (!via) entry = "link";
  else if (via === "search") entry = "search";
  else {
    try { entry = sessionStorage.getItem(ENTRY_KEY) || "search"; } catch (_) { entry = "search"; }
  }
  try { sessionStorage.setItem(ENTRY_KEY, entry); } catch (_) { /* private mode */ }
  return entry;
}

/** Record that `person`'s `page` ("profile" | "family" | "slideshow") was
 *  opened. Fire and forget: a failure is logged to the console and never
 *  disturbs the visitor. */
export function logAccess(person, page) {
  try {
    if (!person?.id || !TENANT_ID) return;
    const entry = resolveEntry();
    const visit = currentVisit(!readVia()); // direct open = new visitor

    // A reload of the same screen within a minute is not a second view.
    const key = `${page}:${person.id}`;
    try {
      const [lastKey, lastAt] = (sessionStorage.getItem(LAST_KEY) || "").split("|");
      if (lastKey === key && Date.now() - Number(lastAt || 0) < DEDUPE_MS) return;
      sessionStorage.setItem(LAST_KEY, `${key}|${Date.now()}`);
    } catch (_) { /* private mode: just log every view */ }

    const jst  = new Date(Date.now() + 9 * 3600 * 1000);
    const date = jst.toISOString().slice(0, 10);
    const name = `${person.last_name || ""} ${person.first_name || ""}`.trim().slice(0, 100);

    addDoc(collection(tenantDoc(), "access_logs"), {
      person_id: String(person.id).slice(0, 64),
      name,
      page,
      entry,
      visit,
      dev:  deviceId(),
      ts:   serverTimestamp(),
      at:   new Date().toISOString(),
      date,
      ym:   date.slice(0, 7),
      h:    jst.getUTCHours(),
      w:    jst.getUTCDay(),
    }).catch((e) => console.warn("[access-log] write failed:", e.message || e));
  } catch (e) {
    console.warn("[access-log] error:", e);
  }
}

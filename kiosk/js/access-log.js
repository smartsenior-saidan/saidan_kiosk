// access-log.js — one anonymous, append-only record per memorial page view,
// so the admin's 利用状況 tab can show how much each family's memorial is
// opened. Written by the unauthenticated kiosk; firestore.rules accepts only
// these fields, at these sizes, and never an update or delete.
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

/** How this visit began. A page opened with no `via` was reached directly —
 *  a QR code, an NFC card or a pasted link — and that sticks for the rest of
 *  the visit; search.js marks its own hand-offs `via=search`, and the other
 *  pages mark theirs with their own name so the stored entry carries over. */
export function resolveEntry() {
  const via = new URLSearchParams(window.location.search).get("via");
  let entry;
  if (!via) entry = "link";
  else if (via === "search") entry = "search";
  else {
    try { entry = sessionStorage.getItem(ENTRY_KEY) || "search"; } catch (_) { entry = "search"; }
  }
  try { sessionStorage.setItem(ENTRY_KEY, entry); } catch (_) { /* private mode */ }
  return entry;
}

/** Record that `person`'s `page` ("profile" | "family") was opened. Fire and
 *  forget: a failure is logged to the console and never disturbs the visitor. */
export function logAccess(person, page) {
  try {
    if (!person?.id || !TENANT_ID) return;
    const entry = resolveEntry();

    // A reload of the same screen within a minute is not a second visit.
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

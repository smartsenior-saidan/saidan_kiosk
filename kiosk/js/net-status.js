// net-status.js — small always-on connectivity badge for the welcome screen,
// so a staffer troubleshooting a stuck kiosk can tell at a glance whether
// it's a network problem before doing anything else.
//
// navigator.onLine only reflects the OS's view of the network interface — a
// tablet can be associated with wifi that has no real internet (captive
// portal, dead upstream) and still report online. So this combines the
// instant browser online/offline events with a periodic real Firestore read,
// which is what the kiosk actually depends on to search at all.

import { getDoc, tenantDoc } from "./firebase.js?v=2";

const CHECK_INTERVAL_MS = 10000;
const CHECK_TIMEOUT_MS = 6000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

export function initNetStatus() {
  const el = document.getElementById("netStatus");
  const label = document.getElementById("netStatusLabel");
  if (!el || !label) return;

  function setState(online) {
    el.classList.toggle("offline", !online);
    label.textContent = online ? "オンライン" : "オフライン";
  }

  // Instant feedback from the OS-level signal.
  window.addEventListener("online", () => setState(true));
  window.addEventListener("offline", () => setState(false));
  setState(navigator.onLine);

  // Periodic real check — catches "wifi says connected but nothing works."
  async function check() {
    if (!navigator.onLine) {
      setState(false);
      return;
    }
    try {
      await withTimeout(getDoc(tenantDoc()), CHECK_TIMEOUT_MS);
      setState(true);
    } catch (_) {
      setState(false);
    }
  }

  check();
  setInterval(check, CHECK_INTERVAL_MS);
}

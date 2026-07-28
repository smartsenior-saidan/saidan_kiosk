// config.js — per-device kiosk configuration (classic script, runs first).
//
// The Columbarium guide kiosk reads the SAME Firestore project as the Digital
// Altar (saidan) product, scoped to ONE tenant. Set DEFAULT_TENANT to this
// columbarium's tenant_id before installing the device.
//
// Runtime override: load once with ?site=<tenant> — the value is saved to
// localStorage so it persists across restarts and future sessions.
//
// Defaulted to "tokyo_reien" — this columbarium's tenant_id, matching its
// records in the shared database.

(function () {
  var DEFAULT_TENANT = "tokyo_reien"; // ← this columbarium's tenant_id (matches the data)

  var KEY = "columbarium_tenant";
  var param = new URLSearchParams(window.location.search).get("site");
  if (param) {
    try { localStorage.setItem(KEY, param); } catch (e) {}
    try { sessionStorage.setItem(KEY, param); } catch (e) {}
  }
  var tenant = null;
  try { tenant = sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch (e) {}
  tenant = tenant || DEFAULT_TENANT;

  window.__ENV__ = Object.assign({}, window.__ENV__, { TENANT_ID: tenant });
})();

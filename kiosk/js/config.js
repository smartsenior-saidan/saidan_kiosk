// config.js — per-device kiosk configuration (classic script, runs first).
//
// Each physical kiosk belongs to ONE memorial site (tenant). Set DEFAULT_TENANT
// to that site's tenant_id before installing the kiosk, e.g. "site1".
//
// You can also override at runtime by loading the kiosk once with ?site=site1 —
// the value is saved to localStorage so it persists across PWA restarts and
// remembered for all future sessions on the same device.

(function () {
  var DEFAULT_TENANT = "memorial-1"; // ← change per memorial site (e.g. "site1")

  var KEY = "kiosk_tenant";
  var param = new URLSearchParams(window.location.search).get("site");
  if (param) {
    // Save to both storages: localStorage persists across PWA launches,
    // sessionStorage is used within-session by other kiosk modules.
    try { localStorage.setItem(KEY, param); } catch (e) {}
    try { sessionStorage.setItem(KEY, param); } catch (e) {}
  }
  var tenant = null;
  try { tenant = sessionStorage.getItem(KEY) || localStorage.getItem(KEY); } catch (e) {}
  tenant = tenant || DEFAULT_TENANT;

  window.__ENV__ = Object.assign({}, window.__ENV__, { TENANT_ID: tenant });
})();

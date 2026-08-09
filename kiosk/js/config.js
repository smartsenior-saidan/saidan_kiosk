// config.js — per-device kiosk configuration (classic script, runs first).
//
// Each physical kiosk belongs to ONE memorial site (tenant), set via
// ?site=<tenant_id> on first load — the value is saved to localStorage so it
// persists across PWA restarts and all future sessions on the same device.
//
// DEFAULT_TENANT only fires if a device was never given ?site= or had its
// storage wiped. It is deliberately NOT a real tenant id: defaulting a blank
// device to an actual site (e.g. "kodaira_memorial") would risk a tablet
// silently showing one memorial site's data while physically installed at
// another. Better to show nothing and log loudly than show the wrong temple.

(function () {
  var DEFAULT_TENANT = "unconfigured-device"; // intentionally not a real tenant id — see note above

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
  if (!tenant) {
    console.warn("[kiosk] no tenant configured for this device — pass ?site=<tenant_id> once to set it.");
    tenant = DEFAULT_TENANT;
  }

  window.__ENV__ = Object.assign({}, window.__ENV__, { TENANT_ID: tenant });

  // ── Multi-tenant view hooks (additive) ────────────────────────────────────
  // These run before first paint, so per-tenant styling applies with no flash.
  // A tenant that defines NO overrides renders identically to the base.

  // 1) Expose the tenant id to CSS for scoped theming, e.g.
  //    [data-tenant="kodaira-m"] .home-title { ... }
  try { document.documentElement.setAttribute("data-tenant", tenant); } catch (e) {}

  // 2) Auto-load this tenant's optional theme stylesheet. It loads AFTER
  //    kiosk.css, so its rules win by cascade. A tenant without a theme file
  //    404s harmlessly (the link removes itself) and stays on the base look.
  try {
    var themeLink = document.createElement("link");
    themeLink.rel = "stylesheet";
    themeLink.href = "css/tenants/" + tenant + ".css?v=1";
    themeLink.onerror = function () { themeLink.remove(); };
    document.head.appendChild(themeLink);
  } catch (e) {}

  // 3) Hide the page from the FIRST paint until the tenant theme is applied, so
  //    the default accent color never flashes before the tenant's own color
  //    loads from Firestore. tenant-bg.js clears this once the theme is set; the
  //    timeout is a safety net so the page can never stay hidden if that fails.
  try {
    document.documentElement.classList.add("theme-pending");
    setTimeout(function () {
      document.documentElement.classList.remove("theme-pending");
    }, 3000);
  } catch (e) {}
})();

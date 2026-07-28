# Onboarding a saidan tenant

A tenant is **config, not a fork**. Adding one is: create a Firestore doc + an
admin login, and (optionally) a theme file. No code is copied, and existing
tenants are never touched — every override below is absent-means-default, so a
new tenant only changes its own experience.

There are **four** places a tenant is defined. Only the first is required.

---

## 1. Firestore — `tenants/{tenant_id}` (the tenant's config)

Read at kiosk startup by [js/tenant-bg.js](js/tenant-bg.js) via `getTenantConfig()`.
Every field is optional; omit what you don't need.

```jsonc
// tenants/kodaira_memorial   ← doc id must equal the device's TENANT_ID exactly
{
  "accent_color": "#3A7D44",        // hex; sets --color-accent (+ auto dark shade)
  "font_family":  "Shippori Mincho", // any Google Font family name

  // Feature flags → become html.feat-<key> classes for CSS gating.
  // Absent/false = off, so new features stay dark for existing tenants.
  "features": {
    "family":    true,
    "slideshow": true
  },

  // Per-tenant copy → overrides any element with a matching data-i18n key.
  // Absent key = the page's default text.
  "strings": {
    "greetingMain": "光福寺 納骨堂へようこそ",
    "startBtn":     "お名前で検索"
  }
}
```

- **accent_color / font_family** — the usual reskin. No file needed.
- **features** — toggle UI per tenant purely from config. In CSS, gate on the
  class, e.g. `:root:not(.feat-family) .fc-btn-family { display:none; }`.
- **strings** — swap wording per tenant with no code change.

## 2. Storage — background image (optional)

Upload to `{tenant_id}/background.{jpg|jpeg|png|webp}`. Auto-discovered and
pre-loaded before the page reveals (no flash). No doc field needed.

## 3. `css/tenants/{tenant_id}.css` (optional — only for structural changes)

Auto-loaded after the base stylesheet when the active tenant matches the
filename, and scoped by `[data-tenant="{id}"]`. Use it only when a tenant needs
**layout/structure** changes beyond colors/fonts/copy (spacing, hiding or
reordering sections, a different type scale). Copy
[css/tenants/_template.css](css/tenants/_template.css) to start. A tenant with
no file stays on the base look. If a screen needs a genuinely different *layout*,
that's the swappable view-module layer — ask before forking a screen.

## 4. Admin login — `admins/{uid}.tenant_id`

Create the staff Firebase Auth user, then an `admins/{uid}` doc with
`tenant_id: "{tenant_id}"`. [firestore.rules](../firestore.rules) scopes every
admin write to this value, so the tenant's staff only ever see/edit their own
records. Content they create (people, media) is auto-stamped with their tenant.

---

## Pin a device to the tenant

Each kiosk device is pinned in [js/config.js](js/config.js) via `DEFAULT_TENANT`,
or per-device at first load with `?site={tenant_id}` (persisted to localStorage).

> **Reconcile before launch:** `DEFAULT_TENANT` in config.js is currently
> `"memorial-1"`, but the Firestore doc id is `kodaira_memorial`. Before changing
> config, check what `tenant_id` the existing `deceased_individuals` docs carry —
> the device's active id, the `tenants/{id}` doc id, the content docs' `tenant_id`
> field, the admin's `tenant_id`, and the theme filename must ALL be the same
> string (underscores, not hyphens). Changing config to an id the content isn't
> tagged with makes search return nothing.

## Quick checklist for a new tenant

1. `tenants/{id}` doc (at minimum `accent_color`) — §1
2. background image at `{id}/background.jpg` — §2
3. `css/tenants/{id}.css` only if it needs structural changes — §3
4. admin auth user + `admins/{uid}` doc with `tenant_id` — §4
5. install device with `?site={id}` (or set `DEFAULT_TENANT`)

That's a whole tenant — no code fork, existing tenants unaffected.

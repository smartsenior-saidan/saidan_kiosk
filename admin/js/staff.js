// staff.js — Staff management tab (super admins only).
//
// Who may sign in to the admin panel is decided by membership DOCUMENTS:
//   admins/{tenantId}/staff/{uid}  → may manage that one memorial site
//   super_admins/{uid}             → may manage every site, and this tab
// There is no role field anywhere; the path a document sits at is the grant.
// This tab lists those documents, creates them, moves them and deletes them.
//
// What it cannot do, and why: the browser SDK has no way to list, look up by
// email, or delete Firebase Authentication users — that needs the Admin SDK on
// a server. So:
//   • "Register" creates the Auth user through a throwaway second Firebase app
//     (see createAuthUserDetached) with a random password nobody sees, then
//     emails the person a password-setup link.
//   • An account that already exists in Auth (someone who signed in with Google
//     once, or was made in the console) is linked by pasting its UID.
//   • "Remove" deletes the membership document, which revokes access at once
//     because the rules check exists() on every request. The Auth user stays
//     behind and is harmless without a grant; clean it up in the console.

import {
  db,
  auth,
  ROLE,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  collection,
  serverTimestamp,
  sendPasswordResetEmail,
  createAuthUserDetached,
  staffCollection,
  staffDoc,
  superAdminDoc,
  superAdminsCollection,
  COLLECTIONS,
} from "./firebase.js?v=12";
import { t } from "./i18n.js?v=45";

// Helpers handed in by admin.js so this module shares its toast, confirm
// dialog and escaper instead of growing its own.
let esc = (s) => String(s ?? "");
let setStatus = () => {};
let confirmDialog = async () => false;

// ── State ───────────────────────────────────────────────────────────────────

let tenants = [];     // [{ id, name }] — every memorial site, for the pickers and labels
let rows = [];        // [{ uid, role: "super"|"staff", tenantId|null, display_name, email, default_tenant }]
let editing = null;   // the row being edited, or null while registering
let loaded = false;
let loading = null;   // in-flight load promise, so two quick opens share one fetch

// ── DOM ─────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

function els() {
  return {
    form:         $("staffForm"),
    title:        $("staffFormTitle"),
    status:       $("staffFormStatus"),
    modeWrap:     $("staffModeWrap"),
    modeCreate:   $("staffModeCreate"),
    modeLink:     $("staffModeLink"),
    email:        $("staffEmail"),
    emailHint:    $("staffEmailHint"),
    uidField:     $("staffUidField"),
    uid:          $("staffUid"),
    name:         $("staffDisplayName"),
    role:         $("staffRole"),
    tenantField:  $("staffTenantField"),
    tenant:       $("staffTenant"),
    defaultField: $("staffDefaultField"),
    defaultTenant:$("staffDefaultTenant"),
    save:         $("staffSaveBtn"),
    cancel:       $("staffCancelBtn"),
    list:         $("staffList"),
  };
}

function showFormStatus(msg, kind = "error") {
  const el = els().status;
  if (!el) return;
  el.className = `form-status ${kind}`;
  el.textContent = msg;
  el.classList.remove("hidden");
}

function clearFormStatus() {
  els().status?.classList.add("hidden");
}

function tenantName(id) {
  return tenants.find((tn) => tn.id === id)?.name || id || "—";
}

function roleLabel(role) {
  return role === "super" ? t("staff.role.super") : t("staff.role.staff");
}

// ── Loading ─────────────────────────────────────────────────────────────────

async function loadTenants() {
  const snap = await getDocs(collection(db, COLLECTIONS.tenants));
  tenants = snap.docs
    .map((d) => ({ id: d.id, name: (d.data().name || "").trim() || d.id }))
    .sort((a, b) => a.name.localeCompare(b.name, "ja"));
}

async function loadRows() {
  const out = [];

  const supers = await getDocs(superAdminsCollection());
  supers.forEach((d) => {
    const data = d.data();
    out.push({
      uid: d.id, role: "super", tenantId: null,
      display_name: data.display_name || "", email: data.email || "",
      default_tenant: data.default_tenant || "",
    });
  });

  // One query per site — there are a handful of sites, not thousands.
  for (const tn of tenants) {
    const snap = await getDocs(staffCollection(tn.id));
    snap.forEach((d) => {
      const data = d.data();
      out.push({
        uid: d.id, role: "staff", tenantId: tn.id,
        display_name: data.display_name || "", email: data.email || "",
        default_tenant: "",
      });
    });
  }

  rows = out.sort((a, b) => {
    if (a.role !== b.role) return a.role === "super" ? -1 : 1;
    const ta = tenantName(a.tenantId), tb = tenantName(b.tenantId);
    if (ta !== tb) return ta.localeCompare(tb, "ja");
    return (a.display_name || a.email).localeCompare(b.display_name || b.email, "ja");
  });
}

/** Fetch everything the tab shows. Safe to call repeatedly; concurrent calls
 *  share one request. */
async function reload() {
  if (loading) return loading;
  loading = (async () => {
    const list = els().list;
    if (list && !loaded) list.innerHTML = `<div class="spinner"></div>`;
    try {
      await loadTenants();
      await loadRows();
      loaded = true;
    } finally {
      loading = null;
    }
    render();
  })();
  return loading;
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderPickers() {
  const { tenant, defaultTenant } = els();
  const opts = tenants.map((tn) => `<option value="${esc(tn.id)}">${esc(tn.name)}</option>`).join("");
  if (tenant) {
    const keep = tenant.value;
    tenant.innerHTML = opts;
    if (keep) tenant.value = keep;
  }
  if (defaultTenant) {
    const keep = defaultTenant.value;
    defaultTenant.innerHTML = `<option value="">${esc(t("staff.defaultTenant.none"))}</option>` + opts;
    if (keep) defaultTenant.value = keep;
  }
}

// A uid can legitimately appear twice (a super admin with a leftover site
// grant), so rows are keyed by where the document lives, not just by uid.
function rowKey(r) {
  return r.role === "super" ? `super:${r.uid}` : `staff:${r.tenantId}:${r.uid}`;
}

function renderList() {
  const list = els().list;
  if (!list) return;

  if (!rows.length) {
    list.innerHTML = `<p class="empty-state">${esc(t("staff.empty"))}</p>`;
    return;
  }

  const me = auth.currentUser?.uid;
  list.innerHTML = `
    <div class="profiles-table-wrap">
      <table class="profiles-table staff-table">
        <thead>
          <tr>
            <th>${esc(t("staff.table.name"))}</th>
            <th>${esc(t("staff.table.email"))}</th>
            <th>${esc(t("staff.table.role"))}</th>
            <th>${esc(t("staff.table.site"))}</th>
            <th>${esc(t("table.actions"))}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => {
            const self = r.uid === me;
            const initials = (r.display_name || r.email || "?").trim().charAt(0).toUpperCase();
            return `
              <tr data-uid="${esc(r.uid)}">
                <td>
                  <div class="avatar-cell">
                    <div class="avatar">${esc(initials)}</div>
                    <div>
                      <div class="profile-name">${esc(r.display_name || "—")}${self ? ` <span class="staff-you">${esc(t("staff.you"))}</span>` : ""}</div>
                      <div class="profile-meta staff-uid" title="UID">${esc(r.uid)}</div>
                    </div>
                  </div>
                </td>
                <td>${esc(r.email || "—")}</td>
                <td><span class="role-pill role-${esc(r.role)}">${esc(roleLabel(r.role))}</span></td>
                <td>${r.role === "super" ? esc(t("staff.allSites")) : esc(tenantName(r.tenantId))}</td>
                <td>
                  <div class="table-actions">
                    <button type="button" class="btn-secondary" data-staff-action="reset" data-key="${esc(rowKey(r))}" ${r.email ? "" : "disabled"}>${esc(t("staff.reset"))}</button>
                    <button type="button" class="btn-secondary" data-staff-action="edit" data-key="${esc(rowKey(r))}">${esc(t("btn.edit"))}</button>
                    <button type="button" class="btn-danger" data-staff-action="delete" data-key="${esc(rowKey(r))}" ${self ? "disabled" : ""}>${esc(t("btn.delete"))}</button>
                  </div>
                </td>
              </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;

  list.querySelectorAll("[data-staff-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const row = rows.find((r) => rowKey(r) === btn.dataset.key);
      if (!row) return;
      const action = btn.dataset.staffAction;
      if (action === "edit")   startEdit(row);
      if (action === "delete") await removeRow(row);
      if (action === "reset")  await sendReset(row);
    });
  });
}

/** Re-render everything that carries translated text. Called by admin.js on
 *  language change as well as after every data change. */
export function render() {
  renderPickers();
  renderList();
  syncFormChrome();
}

// ── Form ────────────────────────────────────────────────────────────────────

function mode() {
  return els().modeLink?.checked ? "link" : "create";
}

/** Show/hide fields for the current role, mode and editing state. */
function syncFormChrome() {
  const e = els();
  if (!e.form) return;
  const isSuper = e.role.value === "super";
  const self = !!editing && editing.uid === auth.currentUser?.uid;

  e.title.textContent = editing
    ? t("staff.editTitle", { name: editing.display_name || editing.email || editing.uid })
    : t("staff.newTitle");

  e.modeWrap.classList.toggle("hidden", !!editing);
  e.uidField.classList.toggle("hidden", !!editing || mode() !== "link");
  e.uid.required = !editing && mode() === "link";

  // Email is the Auth identity — it can't be edited from here, only shown.
  e.email.disabled = !!editing;
  e.email.required = !editing && mode() === "create";
  e.emailHint.textContent = editing
    ? t("staff.emailLocked")
    : mode() === "create" ? t("staff.createHint") : t("staff.linkEmailHint");

  e.tenantField.classList.toggle("hidden", isSuper);
  e.defaultField.classList.toggle("hidden", !isSuper);

  // Nobody can demote or move themselves: the rules refuse the super_admins
  // delete, and a half-done move would lock the operator out of this tab.
  e.role.disabled = self;
  e.save.textContent = editing ? t("staff.update") : t("staff.save");
  e.cancel.classList.toggle("hidden", !editing);
}

function resetForm() {
  const e = els();
  editing = null;
  e.form.reset();
  e.modeCreate.checked = true;
  if (tenants.length) e.tenant.value = tenants[0].id;
  e.defaultTenant.value = "";
  clearFormStatus();
  syncFormChrome();
}

function startEdit(row) {
  const e = els();
  editing = row;
  clearFormStatus();
  e.modeCreate.checked = true;
  e.email.value = row.email || "";
  e.uid.value = row.uid;
  e.name.value = row.display_name || "";
  e.role.value = row.role;
  e.tenant.value = row.tenantId || (tenants[0]?.id ?? "");
  e.defaultTenant.value = row.default_tenant || "";
  syncFormChrome();
  e.form.scrollIntoView({ behavior: "smooth", block: "start" });
  e.name.focus();
}

/** Where a grant document lives for a given role/tenant. */
function grantRef(role, tenantId, uid) {
  return role === "super" ? superAdminDoc(uid) : staffDoc(tenantId, uid);
}

/** A password the person will never see or need: they set their own from the
 *  reset email. Long and mixed so it satisfies any password policy. */
function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const b64 = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  return `${b64}Aa1!`;
}

function friendlyError(err) {
  switch (err?.code) {
    case "auth/email-already-in-use":  return t("staff.err.emailInUse");
    case "auth/invalid-email":         return t("staff.err.invalidEmail");
    case "auth/operation-not-allowed": return t("staff.err.emailProviderOff");
    case "permission-denied":          return t("staff.err.denied");
    case "staff/exists":               return t("staff.err.exists");
    default:                           return t("staff.err.generic", { msg: err?.message || String(err) });
  }
}

async function handleSubmit(ev) {
  ev.preventDefault();
  clearFormStatus();
  const e = els();

  const display_name = e.name.value.trim();
  const email = e.email.value.trim().toLowerCase();
  const role = e.role.value;
  const tenantId = role === "super" ? null : e.tenant.value;
  const default_tenant = role === "super" ? e.defaultTenant.value : "";

  if (!display_name) { showFormStatus(t("staff.err.nameRequired")); e.name.focus(); return; }
  if (role === "staff" && !tenantId) { showFormStatus(t("staff.err.tenantRequired")); return; }

  e.save.disabled = true;
  try {
    if (editing) {
      await saveEdit({ display_name, role, tenantId, default_tenant });
    } else if (mode() === "link") {
      const uid = e.uid.value.trim();
      if (!uid) { showFormStatus(t("staff.err.uidRequired")); e.uid.focus(); return; }
      await createGrant({ uid, email, display_name, role, tenantId, default_tenant });
      setStatus(t("staff.status.linked", { name: display_name }), "success");
      resetForm();
      await reload();
    } else {
      if (!email) { showFormStatus(t("staff.err.emailRequired")); e.email.focus(); return; }
      const uid = await createAuthUserDetached(email, randomPassword());
      await createGrant({ uid, email, display_name, role, tenantId, default_tenant });
      // Best effort: the grant is already in place, so a mail failure is worth
      // a warning, not a rollback — the admin can resend from the list.
      let mailed = true;
      try { await sendPasswordResetEmail(auth, email); } catch { mailed = false; }
      setStatus(
        mailed ? t("staff.status.created", { name: display_name, email })
               : t("staff.status.createdNoMail", { name: display_name }),
        mailed ? "success" : "warning",
      );
      resetForm();
      await reload();
    }
  } catch (err) {
    console.error("[staff] save failed:", err);
    showFormStatus(friendlyError(err));
  } finally {
    e.save.disabled = false;
  }
}

async function createGrant({ uid, email, display_name, role, tenantId, default_tenant }) {
  const ref = grantRef(role, tenantId, uid);
  if ((await getDoc(ref)).exists()) throw Object.assign(new Error("exists"), { code: "staff/exists" });

  const data = {
    display_name,
    created_at: serverTimestamp(),
    created_by: auth.currentUser?.uid || "",
  };
  if (email) data.email = email;
  if (role === "super" && default_tenant) data.default_tenant = default_tenant;
  await setDoc(ref, data);
}

async function saveEdit({ display_name, role, tenantId, default_tenant }) {
  const from = editing;
  const moved = role !== from.role || (role === "staff" && tenantId !== from.tenantId);

  const data = { display_name, updated_at: serverTimestamp() };
  if (from.email) data.email = from.email;
  if (role === "super" && default_tenant) data.default_tenant = default_tenant;

  if (moved) {
    // Write the new grant before dropping the old one so the person is never
    // left with no access if the second step fails.
    const target = grantRef(role, tenantId, from.uid);
    if ((await getDoc(target)).exists()) throw Object.assign(new Error("exists"), { code: "staff/exists" });
    await setDoc(target, { ...data, created_at: serverTimestamp(), created_by: auth.currentUser?.uid || "" });
    await deleteDoc(grantRef(from.role, from.tenantId, from.uid));
  } else {
    await setDoc(grantRef(from.role, from.tenantId, from.uid), data, { merge: true });
  }

  setStatus(t("staff.status.updated", { name: display_name }), "success");
  resetForm();
  await reload();
}

async function removeRow(row) {
  if (row.uid === auth.currentUser?.uid) { setStatus(t("staff.err.self"), "warning"); return; }
  const name = row.display_name || row.email || row.uid;
  const ok = await confirmDialog({
    title: t("staff.confirm.deleteTitle"),
    body: t("staff.confirm.delete", { name }),
    confirmLabel: t("staff.confirm.deleteBtn"),
  });
  if (!ok) return;

  try {
    await deleteDoc(grantRef(row.role, row.tenantId, row.uid));
    if (editing && rowKey(editing) === rowKey(row)) resetForm();
    setStatus(t("staff.status.deleted", { name }), "success");
    await reload();
  } catch (err) {
    console.error("[staff] delete failed:", err);
    setStatus(friendlyError(err), "error");
  }
}

async function sendReset(row) {
  if (!row.email) return;
  try {
    await sendPasswordResetEmail(auth, row.email);
    setStatus(t("staff.status.resetSent", { email: row.email }), "success");
  } catch (err) {
    console.error("[staff] reset mail failed:", err);
    setStatus(friendlyError(err), "error");
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

/** Wire the tab once. Does nothing for non-super sessions: the nav item is
 *  hidden for them and the rules would refuse every read anyway. */
export function initStaffPanel(deps) {
  if (deps?.esc) esc = deps.esc;
  if (deps?.setStatus) setStatus = deps.setStatus;
  if (deps?.confirmDialog) confirmDialog = deps.confirmDialog;
  if (ROLE !== "super") return;

  const e = els();
  if (!e.form) return;
  e.form.addEventListener("submit", handleSubmit);
  e.role.addEventListener("change", syncFormChrome);
  e.modeCreate.addEventListener("change", syncFormChrome);
  e.modeLink.addEventListener("change", syncFormChrome);
  e.cancel.addEventListener("click", resetForm);
  syncFormChrome();
}

/** Called whenever the tab is shown. Loads on first open, refreshes after. */
export function openStaffPanel() {
  if (ROLE !== "super") return;
  reload().catch((err) => {
    console.error("[staff] load failed:", err);
    const list = els().list;
    if (list) list.innerHTML = `<p class="empty-state">${esc(friendlyError(err))}</p>`;
  });
}

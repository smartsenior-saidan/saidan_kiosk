/**
 * rename-tenant.js — rename a SmartSenior tenant everywhere it's stored.
 *
 * Renames tenant "testtenant1" → "demo" and the login test1@gmail.com →
 * saidandemo@gmail.com. Because `tenant_id` is stamped on every record and the
 * /users + /tenants writes are blocked by the security rules, this runs with a
 * Firebase Admin service account (bypasses rules).
 *
 * It does NOT move Storage objects: media docs keep their existing download
 * URLs (files stay under the old prefix and still resolve); only new uploads
 * land under the new prefix. That keeps the migration safe and reversible.
 *
 * ── Setup ──────────────────────────────────────────────────────────────────
 *   1. Firebase console → Project settings → Service accounts →
 *      "Generate new private key". Save it next to this file as
 *      serviceAccountKey.json  (it's a secret — don't commit it).
 *   2. In this folder:  npm init -y  &&  npm install firebase-admin
 *
 * ── Run ────────────────────────────────────────────────────────────────────
 *   node rename-tenant.js            # DRY RUN — prints what it would change
 *   node rename-tenant.js --commit   # actually applies the changes
 */

const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const OLD_TENANT      = "testtenant1";
const NEW_TENANT      = "demo";
const NEW_TENANT_NAME = "Demo";                 // display name written to tenants/demo (kiosk reads `name`)
const OLD_EMAIL       = "test1@gmail.com";
const NEW_EMAIL       = "saidandemo@gmail.com";
const NEW_PASSWORD    = null;                     // set a string to also reset the password, or null to keep it
const SERVICE_ACCOUNT = path.resolve(__dirname, "serviceAccountKey.json");
// ─────────────────────────────────────────────────────────────────────────────

const COMMIT = process.argv.includes("--commit");

let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT);
} catch {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT}\n   Firebase console → Project settings → Service accounts → "Generate new private key",\n   save it as scripts/serviceAccountKey.json, then re-run.\n`);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();
const auth = getAuth();

async function main() {
  console.log(`\n${COMMIT ? "⚙️  COMMIT" : "🔎 DRY RUN"} — rename "${OLD_TENANT}" → "${NEW_TENANT}"\n`);

  // Collected {ref, data} writes, applied only on --commit.
  const writes = [];

  // 1. The login account (uid drives the /users doc that maps login → tenant).
  let uid = null;
  try {
    const user = await auth.getUserByEmail(OLD_EMAIL);
    uid = user.uid;
    console.log(`• login:  ${OLD_EMAIL}  (uid ${uid})  →  ${NEW_EMAIL}`);
  } catch {
    console.warn(`! no auth user for ${OLD_EMAIL} — skipping the email + users-doc steps`);
  }

  // 2. deceased_individuals + their media subcollection
  const personsSnap = await db.collection("deceased_individuals").where("tenant_id", "==", OLD_TENANT).get();
  let mediaCount = 0;
  for (const p of personsSnap.docs) {
    writes.push({ ref: p.ref, data: { tenant_id: NEW_TENANT } });
    const mediaSnap = await p.ref.collection("media").get();
    mediaSnap.forEach((m) => {
      writes.push({ ref: m.ref, data: { tenant_id: NEW_TENANT } });
      mediaCount++;
    });
  }
  console.log(`• deceased_individuals: ${personsSnap.size}   media docs: ${mediaCount}`);

  // 3. families
  const famSnap = await db.collection("deceased_families").where("tenant_id", "==", OLD_TENANT).get();
  famSnap.forEach((f) => writes.push({ ref: f.ref, data: { tenant_id: NEW_TENANT } }));
  console.log(`• families: ${famSnap.size}`);

  // 4. admins/{uid} — the doc that re-points the login to the new tenant
  if (uid) writes.push({ ref: db.doc(`admins/${uid}`), data: { tenant_id: NEW_TENANT } });

  // 5. tenants/OLD config doc → tenants/NEW (name/accent_color/bgm_path)
  const tOld = await db.doc(`tenants/${OLD_TENANT}`).get();
  console.log(tOld.exists
    ? `• tenants/${OLD_TENANT} → tenants/${NEW_TENANT} (name="${NEW_TENANT_NAME}")`
    : `! tenants/${OLD_TENANT} not found — will create a minimal tenants/${NEW_TENANT}`);

  console.log(`\nQueued field updates: ${writes.length}${uid ? `  + email/password on 1 account` : ""}`);

  if (!COMMIT) {
    console.log(`\nDry run only — nothing written. Re-run with --commit to apply.\n`);
    return;
  }

  // ── APPLY ───────────────────────────────────────────────────────────────────
  // merge:true so a write never clobbers other fields (and never fails if a doc
  // is unexpectedly missing).
  for (let i = 0; i < writes.length; i += 400) {
    const batch = db.batch();
    writes.slice(i, i + 400).forEach((w) => batch.set(w.ref, w.data, { merge: true }));
    await batch.commit();
  }

  const newTenantData = tOld.exists
    ? { ...tOld.data(), name: NEW_TENANT_NAME }
    : { name: NEW_TENANT_NAME };
  await db.doc(`tenants/${NEW_TENANT}`).set(newTenantData);
  if (tOld.exists) await db.doc(`tenants/${OLD_TENANT}`).delete();

  if (uid) {
    const update = { email: NEW_EMAIL };
    if (NEW_PASSWORD) update.password = NEW_PASSWORD;
    await auth.updateUser(uid, update);
  }

  console.log(`\n✅ Done. Tenant is now "${NEW_TENANT}"; login is ${NEW_EMAIL}.`);
  console.log(`   Kiosk URL:  https://kiosk.saidans.org?site=${NEW_TENANT}`);
  console.log(`   Re-point any physical kiosk with set-tenant-template.ps1 ($siteName="${NEW_TENANT}").\n`);
}

main().catch((e) => { console.error("\n❌ migration failed:", e); process.exit(1); });

/**
 * migrate-storage-tenant.js — move a tenant's uploaded media in Storage from
 * the old prefix to the new one, and rewrite the URLs saved on the media docs.
 *
 *     Storage:   testtenant1/{personId}/{file}   →   demo/{personId}/{file}
 *     Firestore: each media doc's storage_path + storage_url re-pointed
 *
 * Why "demo" (not "demotenant"): the app builds media paths as
 * `${tenant_id}/${personId}/...`, and this tenant's id is "demo" — so new
 * uploads already go to demo/. The folder MUST match the tenant id or old and
 * new media end up split across two folders.
 *
 * A GCS copy preserves the object's download token, so the saved download URL
 * only needs its path swapped (testtenant1%2F → demo%2F) — the token still works.
 *
 * ── Setup ──────────────────────────────────────────────────────────────────
 *   Same scripts/serviceAccountKey.json + firebase-admin as the other scripts.
 *
 * ── Safe run order ─────────────────────────────────────────────────────────
 *   1. node migrate-storage-tenant.js                 # DRY RUN — lists what moves
 *   2. node migrate-storage-tenant.js --commit         # copy files + rewrite Firestore
 *   3. Verify photos/videos still load on the admin + kiosk
 *   4. node migrate-storage-tenant.js --delete-old --commit   # remove the old testtenant1/ files
 */

const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const BUCKET     = "smartsenior-kiosk.firebasestorage.app";   // gs:// bucket (see Storage header in the console)
const OLD_PREFIX = "testtenant1";
const NEW_PREFIX = "demo";
const SERVICE_ACCOUNT = path.resolve(__dirname, "serviceAccountKey.json");
// ─────────────────────────────────────────────────────────────────────────────

const COMMIT     = process.argv.includes("--commit");
const DELETE_OLD = process.argv.includes("--delete-old");

let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT);
} catch {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT} — see the setup note at the top of this file.\n`);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount), storageBucket: BUCKET });
const db = getFirestore();
const bucket = getStorage().bucket();

const reOldPath = new RegExp(`^${OLD_PREFIX}/`);
const encOld = `${OLD_PREFIX}%2F`;   // "/" is %2F in the download URL
const encNew = `${NEW_PREFIX}%2F`;

async function copyFiles() {
  const [files] = await bucket.getFiles({ prefix: `${OLD_PREFIX}/` });
  console.log(`• Storage objects under ${OLD_PREFIX}/: ${files.length}`);
  if (COMMIT) {
    for (const file of files) {
      const dest = file.name.replace(reOldPath, `${NEW_PREFIX}/`);
      await file.copy(bucket.file(dest));   // preserves metadata + download token
    }
    console.log(`  ✅ copied ${files.length} → ${NEW_PREFIX}/`);
  }
  return files;
}

async function rewriteFirestore() {
  // collectionGroup finds every media subcollection regardless of the parent
  // collection's name (works whether or not the collection rename has run).
  const snap = await db.collectionGroup("media").get();
  const hits = snap.docs.filter((d) => (d.data().storage_path || "").startsWith(`${OLD_PREFIX}/`));
  console.log(`• media docs to re-point: ${hits.length}`);
  if (COMMIT) {
    for (let i = 0; i < hits.length; i += 400) {
      const batch = db.batch();
      for (const d of hits.slice(i, i + 400)) {
        const data = d.data();
        batch.update(d.ref, {
          storage_path: (data.storage_path || "").replace(reOldPath, `${NEW_PREFIX}/`),
          storage_url:  (data.storage_url || "").split(encOld).join(encNew),
        });
      }
      await batch.commit();
    }
    console.log(`  ✅ rewrote ${hits.length} media docs`);
  }
}

async function deleteOld() {
  const [files] = await bucket.getFiles({ prefix: `${OLD_PREFIX}/` });
  console.log(`• old objects to delete under ${OLD_PREFIX}/: ${files.length}`);
  if (COMMIT) {
    for (const file of files) await file.delete();
    console.log(`  🗑️  deleted ${files.length}`);
  }
}

async function main() {
  console.log(`\n${COMMIT ? "⚙️  COMMIT" : "🔎 DRY RUN"} — Storage ${OLD_PREFIX}/ → ${NEW_PREFIX}/\n`);
  if (DELETE_OLD) {
    await deleteOld();
  } else {
    await copyFiles();
    await rewriteFirestore();
  }
  if (!COMMIT) console.log(`\nDry run only — nothing changed. Add --commit to apply.\n`);
}

main().catch((e) => { console.error("\n❌ migration failed:", e); process.exit(1); });

/**
 * migrate-collections.js — rename the Firestore collections by copying every
 * document to the new collection name (preserving doc IDs), then optionally
 * deleting the old collections.
 *
 *     users             → admins
 *     deceased_persons  → deceased_individuals   (+ each doc's `media` subcollection)
 *     families          → deceased_families
 *
 * Doc IDs are PRESERVED — that's essential, because related_persons, family
 * member_ids, and Storage paths all reference person doc IDs.
 *
 * This is GLOBAL: it moves every tenant's data. Run it while traffic is low.
 *
 * ── Setup ──────────────────────────────────────────────────────────────────
 *   Same service account as rename-tenant.js: scripts/serviceAccountKey.json
 *   (and `npm install firebase-admin` in this folder if you haven't).
 *
 * ── Safe run order ─────────────────────────────────────────────────────────
 *   1. node migrate-collections.js               # DRY RUN — counts only
 *   2. firebase deploy --only firestore:rules --project smartsenior-kiosk
 *        (rules already allow BOTH old + new names, so nothing breaks)
 *   3. node migrate-collections.js --commit       # copy old → new
 *   4. Redeploy the kiosk (Cloudflare) + refresh the admin so they read the
 *      new names, and verify everything loads.
 *   5. node migrate-collections.js --delete-old --commit   # remove old collections
 *   6. Ask Claude to strip the "TRANSITIONAL" blocks from firestore.rules,
 *      then deploy rules once more.
 */

const path = require("path");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const MAP = [
  { from: "deceased_persons", to: "deceased_individuals", subcollections: ["media"] },
  { from: "families",         to: "deceased_families",    subcollections: [] },
  { from: "users",            to: "admins",               subcollections: [] },
];
const SERVICE_ACCOUNT = path.resolve(__dirname, "serviceAccountKey.json");
// ─────────────────────────────────────────────────────────────────────────────

const COMMIT     = process.argv.includes("--commit");
const DELETE_OLD = process.argv.includes("--delete-old");

let serviceAccount;
try {
  serviceAccount = require(SERVICE_ACCOUNT);
} catch {
  console.error(`\n❌ Could not load ${SERVICE_ACCOUNT}\n   Firebase console → Project settings → Service accounts → "Generate new private key",\n   save it as scripts/serviceAccountKey.json, then re-run.\n`);
  process.exit(1);
}

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

// Commit a list of {op, ref, data} in ≤400-write batches.
async function flush(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = db.batch();
    for (const o of ops.slice(i, i + 400)) {
      if (o.op === "set") batch.set(o.ref, o.data);
      else batch.delete(o.ref);
    }
    await batch.commit();
  }
}

async function copyAll() {
  const ops = [];
  for (const { from, to, subcollections } of MAP) {
    const snap = await db.collection(from).get();
    let subCount = 0;
    for (const doc of snap.docs) {
      ops.push({ op: "set", ref: db.collection(to).doc(doc.id), data: doc.data() });
      for (const sub of subcollections) {
        const subSnap = await doc.ref.collection(sub).get();
        subSnap.forEach((s) => {
          ops.push({ op: "set", ref: db.collection(to).doc(doc.id).collection(sub).doc(s.id), data: s.data() });
          subCount++;
        });
      }
    }
    console.log(`• ${from} → ${to}:  ${snap.size} docs${subcollections.length ? `  (+${subCount} ${subcollections.join("/")} docs)` : ""}`);
  }
  console.log(`\nTotal writes: ${ops.length}`);
  if (COMMIT) { await flush(ops); console.log("✅ copied."); }
}

async function deleteOld() {
  const ops = [];
  for (const { from, subcollections } of MAP) {
    const snap = await db.collection(from).get();
    for (const doc of snap.docs) {
      for (const sub of subcollections) {
        const subSnap = await doc.ref.collection(sub).get();
        subSnap.forEach((s) => ops.push({ op: "delete", ref: s.ref }));
      }
      ops.push({ op: "delete", ref: doc.ref });
    }
    console.log(`• delete ${from}:  ${snap.size} docs (+ subcollections)`);
  }
  console.log(`\nTotal deletes: ${ops.length}`);
  if (COMMIT) { await flush(ops); console.log("🗑️  deleted."); }
}

async function main() {
  const mode = DELETE_OLD ? "DELETE OLD" : "COPY";
  console.log(`\n${COMMIT ? "⚙️  COMMIT" : "🔎 DRY RUN"} — ${mode}\n`);
  if (DELETE_OLD) await deleteOld();
  else await copyAll();
  if (!COMMIT) console.log(`\nDry run only — nothing written. Add --commit to apply.\n`);
}

main().catch((e) => { console.error("\n❌ migration failed:", e); process.exit(1); });

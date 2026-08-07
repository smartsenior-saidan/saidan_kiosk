#!/usr/bin/env node
'use strict';

/**
 * nest-under-tenants.js — move the flat top-level memorial collections into
 * per-tenant subcollections.
 *
 *   deceased_individuals/{id}              ->  tenants/{tenant_id}/individuals/{id}
 *   deceased_individuals/{id}/media/{mid}  ->  tenants/{tenant_id}/individuals/{id}/media/{mid}
 *   deceased_families/{id}                 ->  tenants/{tenant_id}/families/{id}
 *
 * `admins/{uid}` is NOT touched: its document ID is the Firebase Auth UID, and
 * firestore.rules reads it by request.auth.uid before it knows which tenant the
 * caller belongs to — so it cannot live behind a tenant.
 *
 * THIS SCRIPT ONLY COPIES. It never deletes or modifies anything in the source
 * collections, so until you delete them by hand every record still exists in its
 * original location and rolling back is a one-line revert in the app code.
 *
 * Two invariants worth knowing before you read the code:
 *
 *   1. DOCUMENT IDS ARE PRESERVED, ALWAYS. admin.js builds QR codes as
 *      `kiosk.saidans.org/profile.html?person={id}&site={tenant}` and those are
 *      printed and physically placed at the memorial sites. A person ID that
 *      changes is a QR code on a wall that 404s and cannot be recalled. The same
 *      IDs also appear inside families' `member_ids` and individuals'
 *      `related_persons`, so preserving them keeps every reference intact with
 *      no rewriting.
 *
 *   2. `tenant_id` IS KEPT on every copied document even though the path now
 *      makes it redundant. It costs ~30 bytes, it keeps the columbarium's
 *      config.json a one-line change (collection path only, its tenantField
 *      mapping still resolves), and it leaves any future collectionGroup query
 *      filterable.
 *
 * Usage:
 *
 *   node nest-under-tenants.js --backup            # dump every collection to scripts/backups/*.json
 *   node nest-under-tenants.js                     # dry run — reads, reports, writes NOTHING
 *   node nest-under-tenants.js --tenant=tokyo_reien  # dry run, one tenant only
 *   node nest-under-tenants.js --commit            # actually write the copies
 *   node nest-under-tenants.js --verify            # compare source vs destination counts
 *
 * Re-running with --commit is safe. Writes use set() without merge, so a run
 * that died halfway simply converges on a second pass. The corollary: while both
 * copies exist the SOURCE is authoritative — if you have already flipped the app
 * to the new paths and edited something there, re-running will overwrite that
 * edit with the old value.
 *
 * Requires scripts/serviceAccountKey.json (gitignored). Client SDK rules do not
 * apply to the Admin SDK, which is why this runs server-side rather than in the
 * admin panel.
 */

const path = require('path');
const fs = require('fs');
// firebase-admin v14 removed the legacy `admin.credential.*` namespace from the
// root export; the modular subpaths below are the supported surface.
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

// ── Collection names ────────────────────────────────────────────────────────
// Sources are the current top-level collections; destinations are the
// subcollection names under tenants/{id}. The destination names intentionally
// drop the "deceased_" prefix — it was only ever there to disambiguate at the
// root, and under a tenant it reads as noise.
const SRC_INDIVIDUALS = 'deceased_individuals';
const SRC_FAMILIES = 'deceased_families';
const DST_INDIVIDUALS = 'individuals';
const DST_FAMILIES = 'families';
const TENANTS = 'tenants';
const MEDIA = 'media';

// ── Arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const VERIFY = argv.includes('--verify');
const BACKUP = argv.includes('--backup');
const ONLY_TENANT =
  (argv.find((a) => a.startsWith('--tenant=')) || '').split('=')[1] || null;

// ── Init ────────────────────────────────────────────────────────────────────
const KEY_PATH = path.resolve(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error(`\n  Missing ${KEY_PATH}`);
  console.error('  Firebase console -> Project settings -> Service accounts -> Generate new private key.');
  console.error('  Save it as scripts/serviceAccountKey.json (already gitignored).\n');
  process.exit(1);
}
const SERVICE_ACCOUNT = require(KEY_PATH);
initializeApp({ credential: cert(SERVICE_ACCOUNT) });
const db = getFirestore();

// ── Reporting helpers ───────────────────────────────────────────────────────
const bold = (s) => `[1m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;
const red = (s) => `[31m${s}[0m`;
const yellow = (s) => `[33m${s}[0m`;
const green = (s) => `[32m${s}[0m`;

function rule(char = '─') {
  console.log(dim(char.repeat(64)));
}

/**
 * Read a source collection and bucket every document by its tenant_id.
 *
 * Documents with a missing or blank tenant_id are collected separately rather
 * than being dropped or guessed at — there is no safe default, since putting a
 * record under the wrong memorial site is worse than leaving it behind.
 */
async function scanCollection(name) {
  const snap = await db.collection(name).get();
  const byTenant = new Map();
  const orphans = [];

  for (const doc of snap.docs) {
    const tenantId = doc.get('tenant_id');
    if (typeof tenantId !== 'string' || tenantId.trim() === '') {
      orphans.push(doc);
      continue;
    }
    if (ONLY_TENANT && tenantId !== ONLY_TENANT) continue;
    if (!byTenant.has(tenantId)) byTenant.set(tenantId, []);
    byTenant.get(tenantId).push(doc);
  }
  return { byTenant, orphans, total: snap.size };
}

/**
 * Media lives in a subcollection under each individual, so counting it costs one
 * read per person. At a few thousand records that is a few seconds and a few
 * thousand reads — worth it, because a migration that silently skipped every
 * portrait would not be visible in a document count.
 */
async function readMedia(personDoc) {
  const snap = await personDoc.ref.collection(MEDIA).get();
  return snap.docs;
}

/** Which tenants/{id} documents actually exist. */
async function existingTenantIds() {
  const snap = await db.collection(TENANTS).get();
  return new Set(snap.docs.map((d) => d.id));
}

// ── Backup mode ─────────────────────────────────────────────────────────────
// A managed `gcloud firestore export` is the textbook backup, but it needs an
// authenticated gcloud, a GCS bucket and billing on that bucket. At this
// database's size that is more setup than the data warrants, and a plain JSON
// dump is just as restorable. Covers every collection, not only the two being
// migrated, so it stands as a general snapshot.
//
// Timestamps are tagged rather than stringified so a restore can reconstruct
// them exactly. Other Firestore-native types (GeoPoint, DocumentReference) are
// not used anywhere in this schema; if that changes, this needs extending.
function serialize(value) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toDate === 'function') {
    return { __type: 'timestamp', seconds: value.seconds, nanoseconds: value.nanoseconds };
  }
  if (Array.isArray(value)) return value.map(serialize);
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = serialize(v);
  return out;
}

async function dumpCollection(ref) {
  const snap = await ref.get();
  const docs = {};
  for (const d of snap.docs) {
    docs[d.id] = { data: serialize(d.data()) };
    // Only individuals carry a subcollection today, but walking whatever is
    // there costs one read per document and means the dump is never quietly
    // missing something that got added later.
    for (const sub of await d.ref.listCollections()) {
      docs[d.id].subcollections ??= {};
      docs[d.id].subcollections[sub.id] = await dumpCollection(sub);
    }
  }
  return docs;
}

async function backup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = path.resolve(__dirname, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `firestore-${stamp}.json`);

  console.log(`\n${bold('Backing up every collection')}`);
  console.log(dim(`  project: ${SERVICE_ACCOUNT.project_id}\n`));

  const out = { project: SERVICE_ACCOUNT.project_id, taken_at: new Date().toISOString(), collections: {} };
  for (const ref of await db.listCollections()) {
    out.collections[ref.id] = await dumpCollection(ref);
    const n = Object.keys(out.collections[ref.id]).length;
    console.log(`  ${ref.id.padEnd(24)}${String(n).padStart(5)} document(s)`);
  }

  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  const kb = (fs.statSync(file).size / 1024).toFixed(1);
  console.log(green(bold(`\n  Written: ${path.relative(process.cwd(), file)}  (${kb} KB)\n`)));
  console.log(dim('  Keep this outside the repo if it leaves your machine — it contains every record.\n'));
}

// ── Verify mode ─────────────────────────────────────────────────────────────
// Compares source and destination counts per tenant. Run this after --commit;
// every row should read "same". Counts are the cheap check, not a deep one —
// they catch a partial or interrupted copy, which is the realistic failure.
async function verify() {
  const tenants = await existingTenantIds();
  const targets = ONLY_TENANT ? [ONLY_TENANT] : [...tenants].sort();

  console.log(`\n${bold('Verifying source vs destination')}\n`);
  rule();
  console.log(
    `${'tenant'.padEnd(22)}${'collection'.padEnd(14)}${'source'.padStart(8)}${'nested'.padStart(9)}   result`
  );
  rule();

  let allMatch = true;
  const row = (tenantId, label, a, b) => {
    const match = a === b;
    if (!match) allMatch = false;
    console.log(
      tenantId.padEnd(22) +
        label.padEnd(14) +
        String(a).padStart(8) +
        String(b).padStart(9) +
        '   ' +
        (match ? green('same') : red(`DIFFERS by ${Math.abs(a - b)}`))
    );
  };

  for (const tenantId of targets) {
    for (const [src, dst] of [
      [SRC_INDIVIDUALS, DST_INDIVIDUALS],
      [SRC_FAMILIES, DST_FAMILIES],
    ]) {
      const srcSnap = await db.collection(src).where('tenant_id', '==', tenantId).get();
      const dstSnap = await db.collection(TENANTS).doc(tenantId).collection(dst).get();
      row(tenantId, dst, srcSnap.size, dstSnap.size);

      // Media hides in a subcollection, so a copy that dropped every portrait
      // would still show matching individual counts. Count it explicitly.
      if (dst !== DST_INDIVIDUALS) continue;
      let srcMedia = 0;
      let dstMedia = 0;
      for (const d of srcSnap.docs) srcMedia += (await d.ref.collection(MEDIA).get()).size;
      for (const d of dstSnap.docs) dstMedia += (await d.ref.collection(MEDIA).get()).size;
      row(tenantId, '  └ media', srcMedia, dstMedia);
    }
  }
  rule();
  console.log(
    allMatch
      ? green('\n  Every count matches. Safe to proceed to flipping the app.\n')
      : red('\n  Counts differ. Re-run with --commit (it is idempotent) before flipping.\n')
  );
}

// ── Plan + copy ─────────────────────────────────────────────────────────────
async function run() {
  const tenantsThatExist = await existingTenantIds();

  console.log(`\n${bold(COMMIT ? 'COPYING' : 'DRY RUN — nothing will be written')}`);
  if (ONLY_TENANT) console.log(dim(`  limited to tenant: ${ONLY_TENANT}`));
  console.log(dim(`  project: ${SERVICE_ACCOUNT.project_id}`));

  const individuals = await scanCollection(SRC_INDIVIDUALS);
  const families = await scanCollection(SRC_FAMILIES);

  // Media counts, gathered up front so the dry-run report is complete.
  const mediaByPerson = new Map();
  let mediaTotal = 0;
  for (const docs of individuals.byTenant.values()) {
    for (const d of docs) {
      const m = await readMedia(d);
      if (m.length) {
        mediaByPerson.set(d.id, m);
        mediaTotal += m.length;
      }
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const allTenants = new Set([...individuals.byTenant.keys(), ...families.byTenant.keys()]);

  console.log(`\n${bold('Plan')}\n`);
  rule();
  console.log(
    `${'tenant'.padEnd(22)}${'individuals'.padStart(12)}${'media'.padStart(8)}${'families'.padStart(10)}`
  );
  rule();
  for (const tenantId of [...allTenants].sort()) {
    const people = individuals.byTenant.get(tenantId) || [];
    const media = people.reduce((n, p) => n + (mediaByPerson.get(p.id)?.length || 0), 0);
    const fams = families.byTenant.get(tenantId) || [];
    const missing = tenantsThatExist.has(tenantId) ? '' : yellow('  <- no tenants/ doc');
    console.log(
      tenantId.padEnd(22) +
        String(people.length).padStart(12) +
        String(media).padStart(8) +
        String(fams.length).padStart(10) +
        missing
    );
  }
  rule();
  console.log(
    'total'.padEnd(22) +
      String([...individuals.byTenant.values()].reduce((n, a) => n + a.length, 0)).padStart(12) +
      String(mediaTotal).padStart(8) +
      String([...families.byTenant.values()].reduce((n, a) => n + a.length, 0)).padStart(10)
  );

  // ── Blockers ──────────────────────────────────────────────────────────────
  // A document with no tenant_id has no correct destination. Guessing one would
  // put a stranger's record under someone else's memorial site, so these are
  // reported and skipped, and --commit refuses to run until they are resolved.
  const orphans = [
    ...individuals.orphans.map((d) => [SRC_INDIVIDUALS, d]),
    ...families.orphans.map((d) => [SRC_FAMILIES, d]),
  ];

  if (orphans.length) {
    console.log(`\n${red(bold(`${orphans.length} document(s) have no tenant_id and cannot be placed:`))}\n`);
    for (const [coll, d] of orphans.slice(0, 20)) {
      const label = d.get('name') || `${d.get('last_name') || ''}${d.get('first_name') || ''}` || dim('(unnamed)');
      console.log(`  ${coll}/${d.id}  ${label}`);
    }
    if (orphans.length > 20) console.log(dim(`  … and ${orphans.length - 20} more`));
    console.log(
      '\n  Fix these in the console by setting tenant_id, or delete them if they are junk.\n' +
        '  They are skipped either way — nothing is guessed.\n'
    );
  }

  // A subcollection can be written under a tenants/{id} document that does not
  // exist; Firestore shows the parent greyed out in the console. It works, but
  // it usually means a typo'd tenant_id, so it is worth stopping for.
  const ghostTenants = [...allTenants].filter((t) => !tenantsThatExist.has(t));
  if (ghostTenants.length) {
    console.log(
      `${yellow(bold('Records reference tenants with no tenants/ document:'))} ${ghostTenants.join(', ')}\n` +
        '  Their data would nest under a parent that shows greyed out in the console.\n' +
        '  Usually a typo in tenant_id. Create the tenant doc or fix the records first.\n'
    );
  }

  if (!COMMIT) {
    console.log(dim('\nDry run complete. Nothing was written.'));
    console.log(`Re-run with ${bold('--commit')} to copy.\n`);
    return;
  }

  if (orphans.length || ghostTenants.length) {
    console.log(red(bold('\nRefusing to copy while the problems above are unresolved.\n')));
    process.exit(1);
  }

  // ── Copy ──────────────────────────────────────────────────────────────────
  // BulkWriter handles batching, throttling and retry-on-contention itself,
  // which matters more than raw speed here: a retried write is what keeps a
  // flaky connection from producing a half-copied tenant.
  console.log(`\n${bold('Writing…')}\n`);
  const writer = db.bulkWriter();
  let failures = 0;
  writer.onWriteError((err) => {
    if (err.failedAttempts < 5) return true;
    failures++;
    console.error(red(`  failed: ${err.documentRef.path} — ${err.message}`));
    return false;
  });

  let wrotePeople = 0;
  let wroteMedia = 0;
  let wroteFamilies = 0;

  for (const [tenantId, docs] of individuals.byTenant) {
    const base = db.collection(TENANTS).doc(tenantId).collection(DST_INDIVIDUALS);
    for (const d of docs) {
      // Same ID, same data. See invariant 1 in the header.
      writer.set(base.doc(d.id), d.data());
      wrotePeople++;
      for (const m of mediaByPerson.get(d.id) || []) {
        writer.set(base.doc(d.id).collection(MEDIA).doc(m.id), m.data());
        wroteMedia++;
      }
    }
  }

  for (const [tenantId, docs] of families.byTenant) {
    const base = db.collection(TENANTS).doc(tenantId).collection(DST_FAMILIES);
    for (const d of docs) {
      writer.set(base.doc(d.id), d.data());
      wroteFamilies++;
    }
  }

  await writer.close();

  console.log(`  individuals  ${wrotePeople}`);
  console.log(`  media        ${wroteMedia}`);
  console.log(`  families     ${wroteFamilies}`);

  if (failures) {
    console.log(red(bold(`\n  ${failures} write(s) failed. Re-run — this script is idempotent.\n`)));
    process.exit(1);
  }

  console.log(green(bold('\n  Copy complete. Source collections untouched.\n')));
  console.log('  Next: node nest-under-tenants.js --verify\n');
}

const mode = BACKUP ? backup : VERIFY ? verify : run;
mode().catch((err) => {
  console.error(red(`\n${err.stack || err}\n`));
  process.exit(1);
});

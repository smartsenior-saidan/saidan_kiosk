#!/usr/bin/env node
'use strict';

/**
 * split-admins.js — turn the flat admins collection into membership documents.
 *
 *   admins/{uid} role=="super"  ->  super_admins/{uid}
 *   admins/{uid} otherwise      ->  admins/{tenant_id}/staff/{uid}
 *
 * The point of the shape: EXISTENCE IS THE GRANT. A document under
 * admins/{tid}/staff means access to that tenant, a document under
 * super_admins means access to all of them. Both are fully-specified paths, so
 * firestore.rules can check them with exists() instead of reading a document and
 * comparing a field — cheaper per write, and it can no longer disagree with
 * itself the way `role` and `tenant_id` on one record could.
 *
 * That is also why the copied documents keep only `display_name`: `tenant_id` is
 * now the path and `role` is now which collection you are in. Carrying either
 * forward would recreate the ambiguity this is meant to remove.
 *
 * Access control lives in its own top-level tree rather than mixing into the
 * memorial content under /tenants: /admins groups staff by site, /super_admins
 * sits beside it.
 *
 * One exception. A super admin gets `default_tenant`, carried over from their old
 * tenant_id. It is NOT a permission — a super admin can write to every tenant
 * regardless. It only decides which site the admin panel opens on, which today
 * comes from the tenant_id on their record. Keeping it preserves that landing
 * behaviour without pretending they belong to one site.
 *
 * COPY ONLY. `admins/{uid}` is never modified or deleted. Deployed rules accept
 * both the old field-based grant and the new membership documents during the
 * switchover, so this script changes nobody's access on its own — it only makes
 * the new grants exist.
 *
 * Usage:
 *   node split-admins.js              # dry run — reads, reports, writes NOTHING
 *   node split-admins.js --commit     # write the membership documents
 *   node split-admins.js --verify     # confirm every admin has a new-style grant
 *
 * Requires scripts/serviceAccountKey.json (gitignored).
 */

const path = require('path');
const fs = require('fs');
const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

const SRC_ADMINS = 'admins';
const SUPER_ADMINS = "super_admins";
const STAFF = "staff";
const TENANTS = 'tenants';


const argv = process.argv.slice(2);
const COMMIT = argv.includes('--commit');
const VERIFY = argv.includes('--verify');

const KEY_PATH = path.resolve(__dirname, 'serviceAccountKey.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error(`\n  Missing ${KEY_PATH}\n`);
  process.exit(1);
}
const SERVICE_ACCOUNT = require(KEY_PATH);
initializeApp({ credential: cert(SERVICE_ACCOUNT) });
const db = getFirestore();

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

/**
 * Classify every admin record into where it will live.
 *
 * A record that is neither super nor carries a resolvable tenant_id is a blocker,
 * not something to place by default: an account that silently lands nowhere is
 * locked out, and one that silently lands somewhere is a privilege grant nobody
 * asked for.
 */
async function plan() {
  const tenantIds = new Set((await db.collection(TENANTS).get()).docs.map((d) => d.id));
  const snap = await db.collection(SRC_ADMINS).get();

  const supers = [];
  const members = new Map(); // tenantId -> [{uid, data}]
  const blocked = [];

  for (const doc of snap.docs) {
    // A document in /admins whose ID is a tenant ID is a CONTAINER for that
    // tenant's staff, not a person. Without this guard a re-run would read
    // admins/kodaira_memorial, see its tenant_id field, and cheerfully file it
    // as staff of itself.
    if (tenantIds.has(doc.id)) continue;

    const d = doc.data();
    const name = d.display_name || dim('(no display_name)');
    if (d.role === 'super') {
      supers.push({ uid: doc.id, name, defaultTenant: d.tenant_id || null });
      continue;
    }
    if (!d.tenant_id) {
      blocked.push({ uid: doc.id, name, why: 'no tenant_id and not super' });
      continue;
    }
    if (!tenantIds.has(d.tenant_id)) {
      blocked.push({ uid: doc.id, name, why: `tenant "${d.tenant_id}" has no tenants/ document` });
      continue;
    }
    if (!members.has(d.tenant_id)) members.set(d.tenant_id, []);
    members.get(d.tenant_id).push({ uid: doc.id, name });
  }
  return { supers, members, blocked, total: snap.size };
}

async function run() {
  const { supers, members, blocked, total } = await plan();

  console.log(`\n${bold(COMMIT ? 'WRITING membership documents' : 'DRY RUN — nothing will be written')}`);
  console.log(dim(`  project: ${SERVICE_ACCOUNT.project_id}\n`));

  console.log(bold(`${SUPER_ADMINS}/`));
  for (const s of supers) {
    console.log(`  ${s.uid}  ${s.name}${s.defaultTenant ? dim(`  (lands on ${s.defaultTenant})`) : ''}`);
  }
  if (!supers.length) console.log(dim('  (none)'));

  for (const [tenantId, list] of [...members].sort()) {
    console.log(`\n${bold(`${SRC_ADMINS}/${tenantId}/${STAFF}/`)}`);
    for (const m of list) console.log(`  ${m.uid}  ${m.name}`);
  }

  console.log(
    `\n  ${total} admin record(s) -> ${supers.length} super, ` +
      `${[...members.values()].reduce((n, a) => n + a.length, 0)} tenant member(s)`
  );

  if (blocked.length) {
    console.log(red(bold(`\n  ${blocked.length} record(s) cannot be placed:\n`)));
    for (const b of blocked) console.log(`    ${b.uid}  ${b.name}  — ${b.why}`);
    console.log('\n  Fix these in the console first. Placing them by guess would either\n' +
                '  lock someone out or grant access nobody asked for.\n');
  }

  if (!COMMIT) {
    console.log(dim('\n  Dry run. Nothing was written. `admins` is untouched either way.'));
    console.log(`  Re-run with ${bold('--commit')} to write.\n`);
    return;
  }
  if (blocked.length) {
    console.log(red(bold('  Refusing to write while records above are unresolved.\n')));
    process.exit(1);
  }

  const writer = db.bulkWriter();
  for (const s of supers) {
    const doc = { display_name: s.name };
    if (s.defaultTenant) doc.default_tenant = s.defaultTenant;
    writer.set(db.collection(SUPER_ADMINS).doc(s.uid), doc);
  }
  for (const [tenantId, list] of members) {
    // Give the container an actual field. A subcollection can hang off a
    // document that was never written, but Firestore then calls that document
    // "missing" and the console greys the ID out — which reads as breakage
    // rather than as intent to whoever inherits this.
    writer.set(db.collection(SRC_ADMINS).doc(tenantId), { tenant_id: tenantId });

    for (const m of list) {
      writer.set(
        db.collection(SRC_ADMINS).doc(tenantId).collection(STAFF).doc(m.uid),
        { display_name: m.name }
      );
    }
  }
  await writer.close();

  console.log(green(bold('\n  Written. `admins` is unchanged — nobody has lost or gained access yet.\n')));
  console.log('  Next: node split-admins.js --verify\n');
}

/**
 * Confirm every existing admin has an equivalent new-style grant.
 *
 * This is the check that has to pass before the old rules branch is removed:
 * a record missed here is an account that still works today and stops working
 * the moment the old grant goes away.
 */
async function verify() {
  const snap = await db.collection(SRC_ADMINS).get();
  console.log(`\n${bold('Verifying every admin has a new-style grant')}\n`);

  const tenantIds = new Set((await db.collection(TENANTS).get()).docs.map((t) => t.id));
  let missing = 0;
  for (const doc of snap.docs) {
    if (tenantIds.has(doc.id)) continue;   // container, not a person
    const d = doc.data();
    const label = `${doc.id}  ${(d.display_name || '').padEnd(12)}`;
    let ok;
    let where;
    if (d.role === 'super') {
      ok = (await db.collection(SUPER_ADMINS).doc(doc.id).get()).exists;
      where = `${SUPER_ADMINS}/`;
    } else {
      ok = (await db.collection(SRC_ADMINS).doc(d.tenant_id).collection(STAFF).doc(doc.id).get()).exists;
      where = `${SRC_ADMINS}/${d.tenant_id}/${STAFF}/`;
    }
    if (!ok) missing++;
    console.log(`  ${ok ? green('OK  ') : red('GONE')}  ${label}  ${where}`);
  }

  console.log(
    missing === 0
      ? green(bold('\n  Every admin has a membership document. Safe to drop the old rules branch.\n'))
      : red(bold(`\n  ${missing} admin(s) have no new grant. Do NOT remove the old branch.\n`))
  );
}

(VERIFY ? verify() : run()).catch((err) => {
  console.error(red(`\n${err.stack || err}\n`));
  process.exit(1);
});

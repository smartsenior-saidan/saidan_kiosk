// firestore.rules — who may read and write what.
//
// The kiosk is unauthenticated, so `unauthenticatedContext()` stands for both
// the kiosk and any stranger on the internet: today the rules cannot tell them
// apart. That is the point of the access-restriction work, and the cases marked
// STAGE below are the ones it will flip.
//
// The QR / profile cases are the ones that must never break: QR codes printed on
// gravestones open profile.html on visitors' phones, and a reprint is not an
// option. Every rules change has to keep them green.

import { describe, test, before, after } from "node:test";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, collection, setDoc, serverTimestamp,
} from "firebase/firestore";
import { createEnv, seed, UID } from "./setup.mjs";

let env;
before(async () => {
  env = await createEnv();
  await env.clearFirestore();
  await seed(env);
});
after(() => env.cleanup());

const anon = () => env.unauthenticatedContext().firestore();
const as   = (uid) => env.authenticatedContext(uid).firestore();
const get  = (db, path) => getDoc(doc(db, path));
const list = (db, path) => getDocs(collection(db, path));
const put  = (db, path, data) => setDoc(doc(db, path), data);

const KODAIRA = "tenants/kodaira_memorial";
const TOKYO   = "tenants/tokyo_reien";

describe("kiosk / anonymous — what the visitor pages need", () => {
  test("profile: get one individual by id (QR / NFC)", () =>
    assertSucceeds(get(anon(), `${KODAIRA}/individuals/p1`)));

  test("profile + slideshow: list one individual's media", () =>
    assertSucceeds(list(anon(), `${KODAIRA}/individuals/p1/media`)));

  test("tenant look: get the tenant document", () =>
    assertSucceeds(get(anon(), KODAIRA)));

  test("demo: list individuals (public demo, Pingdom check)", () =>
    assertSucceeds(list(anon(), "tenants/demo/individuals")));

  // STAGE 3 flips this to denied for anyone but an approved kiosk.
  test("search: list a live tenant's individuals — currently open", () =>
    assertSucceeds(list(anon(), `${KODAIRA}/individuals`)));
});

describe("kiosk / anonymous — families", () => {
  test("get one family by id", () =>
    assertSucceeds(get(anon(), `${KODAIRA}/families/f1`)));

  // STAGE 1. The kiosk never reads families; an open list would hand out every
  // member_id, which defeats any restriction on listing individuals.
  test("list a tenant's families is denied", () =>
    assertFails(list(anon(), `${KODAIRA}/families`)));

  test("family contact (施主) stays private", () =>
    assertFails(get(anon(), `${KODAIRA}/families/f1/private/contact`)));
});

describe("kiosk / anonymous — never allowed", () => {
  test("write an individual", () =>
    assertFails(put(anon(), `${KODAIRA}/individuals/p9`, { last_name: "x" })));

  test("read the access log", () =>
    assertFails(list(anon(), `${KODAIRA}/access_logs`)));

  test("read a staff membership", () =>
    assertFails(get(anon(), `admins/kodaira_memorial/staff/${UID.staff}`)));
});

describe("access log — the kiosk's one open write", () => {
  const entry = () => ({
    person_id: "p1", name: "山田 太郎", page: "profile", entry: "link",
    visit: "v1", dev: "d1", ts: serverTimestamp(),
    at: "2026-10-20T10:00:00+09:00", date: "2026-10-20", ym: "2026-10", h: 10, w: 1,
  });

  test("a well-formed entry is accepted", () =>
    assertSucceeds(put(anon(), `${KODAIRA}/access_logs/new1`, entry())));

  test("an extra field is rejected", () =>
    assertFails(put(anon(), `${KODAIRA}/access_logs/new2`, { ...entry(), extra: "x" })));

  test("an unknown page value is rejected", () =>
    assertFails(put(anon(), `${KODAIRA}/access_logs/new3`, { ...entry(), page: "admin" })));
});

describe("site staff (kodaira)", () => {
  test("list own individuals", () =>
    assertSucceeds(list(as(UID.staff), `${KODAIRA}/individuals`)));

  test("write own individual", () =>
    assertSucceeds(put(as(UID.staff), `${KODAIRA}/individuals/p3`, { last_name: "x" })));

  test("cannot write another tenant's individual", () =>
    assertFails(put(as(UID.staff), `${TOKYO}/individuals/p4`, { last_name: "x" })));

  test("list own families (admin family page)", () =>
    assertSucceeds(list(as(UID.staff), `${KODAIRA}/families`)));

  test("cannot list another tenant's families", () =>
    assertFails(list(as(UID.staff), `${TOKYO}/families`)));

  test("read own family contact", () =>
    assertSucceeds(get(as(UID.staff), `${KODAIRA}/families/f1/private/contact`)));

  test("read own access log", () =>
    assertSucceeds(list(as(UID.staff), `${KODAIRA}/access_logs`)));

  test("cannot read another tenant's access log", () =>
    assertFails(list(as(UID.staff), `${TOKYO}/access_logs`)));

  test("cannot grant access to anyone", () =>
    assertFails(put(as(UID.staff), `admins/kodaira_memorial/staff/someone`, { display_name: "x" })));
});

describe("legacy admin record (migration)", () => {
  test("list own families", () =>
    assertSucceeds(list(as(UID.legacy), `${KODAIRA}/families`)));

  test("cannot list another tenant's families", () =>
    assertFails(list(as(UID.legacy), `${TOKYO}/families`)));

  test("write own individual", () =>
    assertSucceeds(put(as(UID.legacy), `${KODAIRA}/individuals/p5`, { last_name: "x" })));

  test("cannot write another tenant's individual", () =>
    assertFails(put(as(UID.legacy), `${TOKYO}/individuals/p6`, { last_name: "x" })));
});

describe("super admin", () => {
  test("list any tenant's families", () =>
    assertSucceeds(list(as(UID.super), `${TOKYO}/families`)));

  test("write any tenant's individual", () =>
    assertSucceeds(put(as(UID.super), `${TOKYO}/individuals/p7`, { last_name: "x" })));

  test("read any tenant's access log", () =>
    assertSucceeds(list(as(UID.super), `${TOKYO}/access_logs`)));
});

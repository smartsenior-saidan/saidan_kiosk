// storage.rules — backgrounds and memorial media.
//
// Everything the kiosk and the admin fetch from Storage goes through
// getDownloadURL(), which is a `get` on one known path; nothing in either app
// lists a folder. The `get` cases are the ones that must stay green.
//
// storage.rules reads Firestore (staff / super admin membership), so these run
// against both emulators together and rely on setup.mjs seeding the
// membership documents.

import { describe, test, before, after } from "node:test";
import { assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { ref, getMetadata, list, uploadString } from "firebase/storage";
import { createEnv, seed, UID } from "./setup.mjs";

let env;
before(async () => {
  env = await createEnv();
  await env.clearFirestore();
  await env.clearStorage();
  await seed(env);
});
after(() => env.cleanup());

const anon   = () => env.unauthenticatedContext().storage();
const as     = (uid) => env.authenticatedContext(uid).storage();
const meta   = (st, path) => getMetadata(ref(st, path));
const ls     = (st, path) => list(ref(st, path));
const upload = (st, path) => uploadString(ref(st, path), "x");

describe("kiosk / anonymous — what the visitor pages need", () => {
  test("site background", () =>
    assertSucceeds(meta(anon(), "kodaira_memorial/background.png")));

  test("memorial background preset", () =>
    assertSucceeds(meta(anon(), "kodaira_memorial/backgrounds/background1.png")));

  test("shared fallback preset", () =>
    assertSucceeds(meta(anon(), "individuals_backgrounds/background1.png")));

  test("one memorial photo by path", () =>
    assertSucceeds(meta(anon(), "kodaira_memorial/p1/photo.jpg")));
});

describe("kiosk / anonymous — folder listing", () => {
  // STAGE 1. Listing a tenant folder returns its sub-folders, and those are
  // named by person id — the same enumeration the families list allowed,
  // through a different door.
  test("list a tenant folder is denied", () =>
    assertFails(ls(anon(), "kodaira_memorial")));

  test("list one person's folder is denied", () =>
    assertFails(ls(anon(), "kodaira_memorial/p1")));

  test("list a tenant's background presets is denied", () =>
    assertFails(ls(anon(), "kodaira_memorial/backgrounds")));

  test("list the shared presets", () =>
    assertSucceeds(ls(anon(), "individuals_backgrounds")));
});

describe("kiosk / anonymous — never allowed", () => {
  test("upload memorial media", () =>
    assertFails(upload(anon(), "kodaira_memorial/p1/new.jpg")));

  test("replace the site background", () =>
    assertFails(upload(anon(), "kodaira_memorial/background.png")));
});

describe("site staff (kodaira)", () => {
  test("upload media to own tenant", () =>
    assertSucceeds(upload(as(UID.staff), "kodaira_memorial/p1/new.jpg")));

  test("cannot upload to another tenant", () =>
    assertFails(upload(as(UID.staff), "tokyo_reien/p2/new.jpg")));

  test("cannot replace the site background (super admin only)", () =>
    assertFails(upload(as(UID.staff), "kodaira_memorial/background.png")));

  test("cannot replace a background preset (super admin only)", () =>
    assertFails(upload(as(UID.staff), "kodaira_memorial/backgrounds/background1.png")));

  test("list own tenant folder", () =>
    assertSucceeds(ls(as(UID.staff), "kodaira_memorial")));

  test("cannot list another tenant's folder", () =>
    assertFails(ls(as(UID.staff), "tokyo_reien")));
});

describe("super admin", () => {
  test("replace any tenant's site background", () =>
    assertSucceeds(upload(as(UID.super), "tokyo_reien/background.png")));

  test("cannot write the console-managed shared presets", () =>
    assertFails(upload(as(UID.super), "individuals_backgrounds/background9.png")));

  test("list any tenant folder", () =>
    assertSucceeds(ls(as(UID.super), "tokyo_reien")));
});

// Shared emulator setup for the security-rules tests.
//
// Both rule files are loaded straight from the repo root, so these tests always
// exercise exactly what deploy-rules.yml would ship. The emulator hosts come
// from the environment `firebase emulators:exec` sets — nothing here points at
// the real smartsenior-kiosk project, and the `demo-` project id guarantees the
// emulator never reaches out to production even if misconfigured.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { ref, uploadString } from "firebase/storage";

const root = fileURLToPath(new URL("../../", import.meta.url));

// One of each kind of signed-in caller the rules distinguish.
export const UID = {
  staff:  "staff-kodaira",    // admins/kodaira_memorial/staff/{uid}
  legacy: "legacy-kodaira",   // pre-split admins/{uid} with tenant_id (migration)
  super:  "super-smartsenior" // super_admins/{uid}
};

export function createEnv() {
  return initializeTestEnvironment({
    projectId: "demo-saidan",
    firestore: { rules: readFileSync(root + "firestore.rules", "utf8") },
    storage:   { rules: readFileSync(root + "storage.rules",   "utf8") },
  });
}

// Two real-shaped tenants plus `demo`, with the records each test touches.
// kodaira_memorial is the live site; tokyo_reien stands in for "another
// company's data", which is what every cross-tenant assertion is about.
export async function seed(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    const put = (path, data) => setDoc(doc(db, path), data);

    await put(`super_admins/${UID.super}`, { display_name: "Super" });
    await put(`admins/kodaira_memorial/staff/${UID.staff}`, { display_name: "Staff" });
    await put(`admins/${UID.legacy}`, { tenant_id: "kodaira_memorial", display_name: "Legacy" });

    for (const t of ["kodaira_memorial", "tokyo_reien", "demo"]) {
      await put(`tenants/${t}`, { name: t });
    }

    await put("tenants/kodaira_memorial/individuals/p1", { last_name: "山田", first_name: "太郎" });
    await put("tenants/kodaira_memorial/individuals/p1/media/m1", { file_type: "photo" });
    await put("tenants/kodaira_memorial/families/f1", { name: "山田家", member_ids: ["p1"] });
    await put("tenants/kodaira_memorial/families/f1/private/contact", { phone: "000-0000-0000" });
    await put("tenants/kodaira_memorial/access_logs/l1", { person_id: "p1" });

    await put("tenants/tokyo_reien/individuals/p2", { last_name: "佐藤", first_name: "花子" });
    await put("tenants/tokyo_reien/families/f2", { name: "佐藤家", member_ids: ["p2"] });
    await put("tenants/tokyo_reien/access_logs/l2", { person_id: "p2" });

    await put("tenants/demo/individuals/d1", { last_name: "見本", first_name: "一郎" });

    const st = ctx.storage();
    for (const path of [
      "kodaira_memorial/background.png",
      "kodaira_memorial/backgrounds/background1.png",
      "kodaira_memorial/p1/photo.jpg",
      "tokyo_reien/p2/photo.jpg",
      "individuals_backgrounds/background1.png",
    ]) {
      await uploadString(ref(st, path), "x");
    }
  });
}

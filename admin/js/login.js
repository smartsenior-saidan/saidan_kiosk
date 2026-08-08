import {
  auth,
  db,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  doc,
  getDoc,
  getDocs,
  collection,
  GoogleAuthProvider,
  signInWithPopup,
} from "./firebase.js?v=9";

const form      = document.getElementById("loginForm");
const emailEl   = document.getElementById("email");
const passEl    = document.getElementById("password");
const signInBtn = document.getElementById("signInBtn");
const googleBtn = document.getElementById("googleBtn");
const forgotBtn = document.getElementById("forgotBtn");
const statusEl  = document.getElementById("loginStatus");

function showStatus(msg, kind = "error") {
  statusEl.className = `login-status ${kind}`;
  statusEl.textContent = msg;
  statusEl.classList.remove("hidden");
}

function clearStatus() {
  statusEl.classList.add("hidden");
}

function friendlyError(code) {
  switch (code) {
    case "auth/invalid-email":         return "メールアドレスの形式が正しくありません。";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":    return "メールアドレスまたはパスワードが違います。";
    case "auth/too-many-requests":     return "試行回数が上限に達しました。しばらく待ってからお試しください。";
    case "auth/user-disabled":         return "このアカウントは無効化されています。SmartSenior にご連絡ください。";
    // Google sign-in: the user closed the popup or clicked twice — not an error
    // worth alarming them about, so the caller treats these as a silent cancel.
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request": return "";
    case "auth/popup-blocked":         return "ポップアップがブロックされました。ブラウザの設定で許可してください。";
    case "auth/account-exists-with-different-credential":
      return "このメールアドレスは別のログイン方法で登録されています。メールアドレスとパスワードでログインしてください。";
    case "auth/operation-not-allowed":
      return "Google ログインが有効になっていません。SmartSenior にご連絡ください。";
    default:                           return "ログインに失敗しました。もう一度お試しください。";
  }
}

/**
 * Find which memorial site this account may administer.
 *
 * Access is a document, not a field: super_admins/{uid} grants every site,
 * tenants/{tid}/admins/{uid} grants that one. Neither can be discovered from the
 * UID alone, so this reads the (publicly readable) tenant list and checks each
 * for a membership document. That is one read per tenant, once per sign-in —
 * it scales with the number of memorial sites, not the number of staff.
 *
 * Rules permit each of those reads because the account is only ever asking about
 * its OWN uid; it cannot enumerate who else works at a site.
 *
 * Returns { tenantId, role, displayName } or null if the account has no grant.
 */
async function resolveGrant(user) {
  // A super admin belongs to no tenant. `default_tenant` only decides which
  // site the console opens on — the picker in admin.js can switch to any other.
  const superSnap = await getDoc(doc(db, "super_admins", user.uid));
  if (superSnap.exists()) {
    const data = superSnap.data();
    const tenantsSnap = await getDocs(collection(db, "tenants"));
    const fallback = tenantsSnap.docs[0]?.id;
    const tenantId = data.default_tenant || fallback;
    if (!tenantId) return null; // no tenants exist at all — nothing to open
    return { tenantId, role: "super", displayName: data.display_name };
  }

  const tenantsSnap = await getDocs(collection(db, "tenants"));
  for (const tenantDoc of tenantsSnap.docs) {
    const memberSnap = await getDoc(
      doc(db, "tenants", tenantDoc.id, "admins", user.uid)
    );
    if (memberSnap.exists()) {
      return {
        tenantId: tenantDoc.id,
        role: "admin",
        displayName: memberSnap.data().display_name,
      };
    }
  }
  return null;
}

/** Gate the signed-in user on their membership and hand off to the console.
 *  Authentication only proves who they are — this is what decides whether they
 *  may use the portal at all, and which memorial site they see. */
async function completeSignIn(user) {
  const grant = await resolveGrant(user);

  // No membership = the account hasn't been linked to a memorial site yet.
  // Refuse rather than silently dropping into a shared "demo" tenant.
  if (!grant) {
    await signOut(auth);
    sessionStorage.clear();
    showStatus("このアカウントはまだ霊園・墓地に紐付けられていません。SmartSenior にご連絡ください。");
    return false;
  }

  sessionStorage.setItem("ss_tenant_id", grant.tenantId);
  sessionStorage.setItem("ss_role", grant.role);
  sessionStorage.setItem("ss_display_name", grant.displayName || user.email);

  // Replace (not push) so the login page never sits in browser history —
  // pressing Back from the dashboard shouldn't be able to land back here.
  window.location.replace("index.html");
  return true;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearStatus();

  const email    = emailEl.value.trim();
  const password = passEl.value;

  if (!email || !password) {
    showStatus("メールアドレスとパスワードを入力してください。");
    return;
  }

  signInBtn.disabled = true;
  signInBtn.textContent = "ログイン中…";

  try {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    const ok = await completeSignIn(user);
    if (ok) return; // navigating away — leave the button disabled
  } catch (err) {
    showStatus(friendlyError(err.code));
  }
  signInBtn.disabled = false;
  signInBtn.textContent = "ログイン";
});

googleBtn?.addEventListener("click", async () => {
  clearStatus();
  googleBtn.disabled = true;

  try {
    // prompt: "select_account" so a shared machine never silently reuses
    // whichever Google account happens to be signed in already.
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });

    const { user } = await signInWithPopup(auth, provider);
    const ok = await completeSignIn(user);
    if (ok) return;
  } catch (err) {
    const msg = friendlyError(err.code);
    if (msg) showStatus(msg); // empty = user just closed the popup
  }
  googleBtn.disabled = false;
});

forgotBtn.addEventListener("click", async () => {
  const email = emailEl.value.trim();
  if (!email) {
    showStatus("上のメールアドレス欄に入力してから、こちらを押してください。", "info");
    emailEl.focus();
    return;
  }

  forgotBtn.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    showStatus("パスワード再設定のメールを送信しました。受信箱をご確認ください。", "success");
  } catch {
    showStatus("再設定メールを送信できませんでした。メールアドレスをご確認ください。");
  } finally {
    forgotBtn.disabled = false;
  }
});

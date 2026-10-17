// firebase.js — Firebase v9+ modular SDK initialization + shared helpers.
//
// The Firebase SDK is loaded from the CDN inside each HTML file as an ES module,
// so this file is itself an ES module and re-exports everything the other
// modules need. Because static pages can't read a .env file, configuration is
// read from `window.__ENV__` if a host injects it, otherwise from the inline
// fallback below. Copy your .env values into FALLBACK_CONFIG for local dev.

import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  arrayRemove,
  arrayUnion,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// --- Configuration ---------------------------------------------------------

// Inline fallback. Replace with your project's values for local development.
// In production prefer injecting window.__ENV__.
const FALLBACK_CONFIG = {
  apiKey: "AIzaSyA-SQmJrGINcd1i2BfnY64urhsYMjBBQts",
  authDomain: "smartsenior-kiosk.firebaseapp.com",
  projectId: "smartsenior-kiosk",
  storageBucket: "smartsenior-kiosk.firebasestorage.app",
  messagingSenderId: "1020345537805",
  appId: "1:1020345537805:web:72132a7eff1c9e67cacc44",
  measurementId: "G-GCQV80RTVW",
};

const ENV = (typeof window !== "undefined" && window.__ENV__) || {};

const firebaseConfig = {
  apiKey: ENV.FIREBASE_API_KEY || FALLBACK_CONFIG.apiKey,
  authDomain: ENV.FIREBASE_AUTH_DOMAIN || FALLBACK_CONFIG.authDomain,
  projectId: ENV.FIREBASE_PROJECT_ID || FALLBACK_CONFIG.projectId,
  storageBucket: ENV.FIREBASE_STORAGE_BUCKET || FALLBACK_CONFIG.storageBucket,
  messagingSenderId:
    ENV.FIREBASE_MESSAGING_SENDER_ID || FALLBACK_CONFIG.messagingSenderId,
  appId: ENV.FIREBASE_APP_ID || FALLBACK_CONFIG.appId,
  measurementId: ENV.FIREBASE_MEASUREMENT_ID || FALLBACK_CONFIG.measurementId,
};

// Active tenant — set from the logged-in user's Firestore record (stored in localStorage by login.js).
// localStorage (not sessionStorage) so a second tab shares the same signed-in
// tenant instead of finding nothing and falling back to "demo-tenant".
export const TENANT_ID =
  localStorage.getItem("ss_tenant_id") ||
  ENV.TENANT_ID ||
  "demo-tenant";

export const ROLE = localStorage.getItem("ss_role") || "admin";
export const DISPLAY_NAME = localStorage.getItem("ss_display_name") || "";
export const DEVICE_ID = ENV.DEVICE_ID || "admin-001";

// --- Initialize ------------------------------------------------------------

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

// Every email Firebase Auth sends on our behalf (password reset / setup, and
// the hosted page its link opens) is localised from this. Without it the
// default is English, which is what staff were getting.
auth.languageCode = "ja";

// Local persistence: signing in stays valid across tabs and browser restarts,
// on the assumption that admin devices are personal staff machines rather than
// shared/public terminals. Explicit sign-out (admin.js) is what ends a session.
setPersistence(auth, browserLocalPersistence).catch((err) =>
  console.warn("[admin] failed to set auth persistence:", err)
);

export {
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  onAuthStateChanged,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
};

/**
 * Create a Firebase Auth user WITHOUT touching the signed-in session.
 *
 * createUserWithEmailAndPassword signs the new user in on whichever Auth
 * instance it runs against, which on the main app would silently replace the
 * super admin's session with the new staff member's. So this spins up a
 * throwaway second app on the same config, creates the user there, and tears
 * it down again. Nothing is persisted for the throwaway app.
 *
 * Returns the new user's uid. Throws the Firebase error unchanged
 * (e.g. auth/email-already-in-use) so callers can explain it.
 */
export async function createAuthUserDetached(email, password) {
  const sideApp = initializeApp(firebaseConfig, `staff-create-${Date.now()}`);
  const sideAuth = getAuth(sideApp);
  try {
    await setPersistence(sideAuth, inMemoryPersistence);
    const { user } = await createUserWithEmailAndPassword(sideAuth, email, password);
    const uid = user.uid;
    await signOut(sideAuth);
    return uid;
  } finally {
    deleteApp(sideApp).catch(() => {});
  }
}

// Collection name constants (single source of truth).
//
// Memorial content lives UNDER the tenant document:
//   tenants/{TENANT_ID}/individuals/{personId}/media/{mediaId}
//   tenants/{TENANT_ID}/families/{familyId}
//
// The path is what scopes a write to one memorial site now. firestore.rules
// grants the write from that path segment rather than from the document body,
// so a mis-stamped tenant_id can no longer file a record at the wrong site.
// Always reach for the helpers below rather than assembling a path by hand.
export const COLLECTIONS = {
  tenants: "tenants",
  devices: "kiosk_devices",
  individuals: "individuals",
  families: "families",
  admins: "admins",
  staff: "staff",
  superAdmins: "super_admins",
};

/** admins/{tenantId}/staff — the membership documents for one memorial site. */
export function staffCollection(tenantId) {
  return collection(db, COLLECTIONS.admins, tenantId, COLLECTIONS.staff);
}

/** admins/{tenantId}/staff/{uid} */
export function staffDoc(tenantId, uid) {
  return doc(staffCollection(tenantId), uid);
}

/** super_admins — accounts that administer every site. */
export function superAdminsCollection() {
  return collection(db, COLLECTIONS.superAdmins);
}

/** super_admins/{uid} */
export function superAdminDoc(uid) {
  return doc(superAdminsCollection(), uid);
}

/** The active tenant's document — the parent of all memorial content. */
export function tenantDoc() {
  return doc(db, COLLECTIONS.tenants, TENANT_ID);
}

/** tenants/{TENANT_ID}/individuals */
export function personsCollection() {
  return collection(tenantDoc(), COLLECTIONS.individuals);
}

/** tenants/{TENANT_ID}/individuals/{personId} */
export function personDoc(personId) {
  return doc(personsCollection(), personId);
}

/** tenants/{TENANT_ID}/families */
export function familiesCollection() {
  return collection(tenantDoc(), COLLECTIONS.families);
}

/** tenants/{TENANT_ID}/families/{familyId} */
export function familyDoc(familyId) {
  return doc(familiesCollection(), familyId);
}

/** Reference to the media subcollection for a specific person. */
export function personMediaCollection(personId) {
  return collection(personDoc(personId), "media");
}

/** Reference to a specific media doc in the subcollection. */
export function personMediaDoc(personId, mediaId) {
  return doc(personMediaCollection(personId), mediaId);
}

// Re-export Firestore + Storage helpers so other modules import from one place.
export {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  serverTimestamp,
  arrayRemove,
  arrayUnion,
  storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject,
};

// --- Tenant-scoped query helpers -------------------------------------------

// `tenantQuery()` is gone: scoping moved from a where("tenant_id") filter into
// the collection path, so personsCollection() / familiesCollection() already
// return exactly this tenant's records. Add ...constraints with query() at the
// call site if a caller ever needs ordering or limits.

export function withTenant(data) {
  return {
    created_at: serverTimestamp(),
    ...data,
    tenant_id: TENANT_ID,
  };
}

console.info(`[SmartSenior] Firebase initialized — tenant: ${TENANT_ID}`);

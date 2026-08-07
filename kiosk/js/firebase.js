// firebase.js — Firebase v9+ modular SDK initialization + shared helpers.
//
// The Firebase SDK is loaded from the CDN inside each HTML file as an ES module,
// so this file is itself an ES module and re-exports everything the other
// modules need. Because static pages can't read a .env file, configuration is
// read from `window.__ENV__` if a host injects it, otherwise from the inline
// fallback below. Copy your .env values into FALLBACK_CONFIG for local dev.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
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
  serverTimestamp,
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

// Active tenant + device for multi-tenancy. EVERY read/write is scoped by this.
export const TENANT_ID = ENV.TENANT_ID || "demo-tenant";
export const DEVICE_ID = ENV.DEVICE_ID || "kiosk-001";

// --- Initialize ------------------------------------------------------------

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Collection name constants (single source of truth).
//
// Memorial content lives UNDER the tenant document:
//   tenants/{TENANT_ID}/individuals/{personId}/media/{mediaId}
//   tenants/{TENANT_ID}/families/{familyId}
//
// The path is what scopes a read to one memorial site now, so there is no
// tenant_id filter to remember (or forget). Always reach for the helpers below
// rather than assembling a path by hand.
export const COLLECTIONS = {
  tenants: "tenants",
  devices: "kiosk_devices",
  individuals: "individuals",
  families: "families",
};

/** This kiosk's tenant document — the parent of all memorial content. */
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
  serverTimestamp,
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

/** Read this tenant's configuration document. Returns {} if not yet created. */
export async function getTenantConfig() {
  try {
    const snap = await getDoc(doc(db, COLLECTIONS.tenants, TENANT_ID));
    return snap.exists() ? snap.data() : {};
  } catch (err) {
    console.warn("[firebase] failed to load tenant config:", err);
    return {};
  }
}

/**
 * Read a single person document.
 *
 * The tenant check this used to do after fetching is gone: the record is read
 * from tenants/{TENANT_ID}/individuals, so belonging to this tenant is a
 * property of the path rather than something to re-verify in the body.
 */
export async function getPersonById(personId) {
  const snap = await getDoc(personDoc(personId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

console.info(
  `[SmartSenior] Firebase initialized — tenant: ${TENANT_ID}, device: ${DEVICE_ID}`
);

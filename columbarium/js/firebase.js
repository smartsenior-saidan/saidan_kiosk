// firebase.js — Firebase v10 modular SDK init + READ-ONLY helpers.
//
// This kiosk reads (never writes) the same Firestore project the Digital Altar
// (saidan) product uses. Every read is scoped by the active tenant so this
// columbarium only ever sees its own records. Config is read from
// window.__ENV__ if a host injects it, otherwise from the inline fallback.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  getStorage,
  ref as storageRef,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// --- Configuration ---------------------------------------------------------
// Same project as saidan. Production credentials are injected via __ENV__ at
// deployment; this inline fallback is for local development only.
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

// Active tenant for multi-tenancy. EVERY read is scoped by this.
export const TENANT_ID = ENV.TENANT_ID || "tokyo_reien";

// --- Initialize ------------------------------------------------------------

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);

// Collection name constants (single source of truth — matches saidan).
export const COLLECTIONS = {
  tenants: "tenants",
  persons: "deceased_individuals",
};

// Re-export Firestore + Storage read helpers so other modules import from here.
export {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  storageRef,
  getDownloadURL,
};

// --- Tenant-scoped read helpers --------------------------------------------

export function tenantQuery(collectionName, ...constraints) {
  return query(
    collection(db, collectionName),
    where("tenant_id", "==", TENANT_ID),
    ...constraints
  );
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

console.info(`[Columbarium] Firebase initialized — tenant: ${TENANT_ID}`);

// ─────────────────────────────────────────────────────────────────
//  firebase.js  —  RoadAssist Pro
//  Replace the config values below with your actual Firebase project.
//  In .env:
//    VITE_FIREBASE_API_KEY=...
//    VITE_FIREBASE_AUTH_DOMAIN=...
//    VITE_FIREBASE_PROJECT_ID=...
//    VITE_FIREBASE_STORAGE_BUCKET=...
//    VITE_FIREBASE_MESSAGING_SENDER_ID=...
//    VITE_FIREBASE_APP_ID=...
// ─────────────────────────────────────────────────────────────────
import { initializeApp } from "firebase/app";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
} from "firebase/auth";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { getMessaging, getToken, onMessage } from "firebase/messaging";

// ── Config ────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const messaging = getMessaging(app);

// ── Firestore collection paths ────────────────────────────────────
export const COLS = {
  users: "users",
  vendors: "vendors",
  requests: "service_requests",
  sos: "sos_hotspots",
  reviews: "reviews",
  notifications: "notifications",
  auditLog: "audit_log",
  appConfig: "app_config",
  adminUsers: "admin_users",
};

// ── Auth helpers ──────────────────────────────────────────────────
export const adminLogin = (email, pass) =>
  signInWithEmailAndPassword(auth, email, pass);
export const adminLogout = () => fbSignOut(auth);

// ── Audit logger ─────────────────────────────────────────────────
// Convention for callers:
//   - action: snake_case verb describing what happened. Reserved suffixes:
//             *_soft_deleted, *_restored, *_hard_deleted, *_created,
//             *_updated, *_approved, *_rejected.
//   - entityType: "vendor" | "user" | "request" | "review" | "config" | etc.
//   - entityId: Firestore doc id of the entity.
//   - details: free-form object. ALWAYS include entityName when known so the
//              audit log is readable without a join — vendor businessName,
//              user email, etc.
export async function logAudit(
  action,
  entityType,
  entityId,
  details = {},
  adminUser,
) {
  await addDoc(collection(db, COLS.auditLog), {
    action,
    entityType,
    entityId,
    entityName: details?.entityName || null,
    details,
    adminUid: adminUser?.uid || "unknown",
    adminName: adminUser?.email || "Admin",
    timestamp: serverTimestamp(),
  });
}

// ── Vendor CRUD ───────────────────────────────────────────────────
export const getVendors = (cb) =>
  onSnapshot(
    query(collection(db, COLS.vendors), orderBy("createdAt", "desc")),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const addVendor = (data) =>
  addDoc(collection(db, COLS.vendors), {
    // Defaults — applied only when caller didn't specify.
    status: "pending",
    kyc: "pending",
    isVerified: false,
    isOpen: false,
    rating: 0,
    reviewCount: 0,
    deletedAt: null,
    ...data,
    // Always-server-controlled.
    createdAt: serverTimestamp(),
  });

export const updateVendor = (id, data) =>
  updateDoc(doc(db, COLS.vendors, id), data);

// Soft delete — preserves the record + R2 docs so it can be restored.
// The Firestore document stays; queries filter by deletedAt client-side.
export const deleteVendor = (id, adminUser) =>
  updateDoc(doc(db, COLS.vendors, id), {
    deletedAt: serverTimestamp(),
    deletedBy: adminUser?.uid || "unknown",
    deletedByEmail: adminUser?.email || null,
  });

// Restore from soft delete.
export const restoreVendor = (id) =>
  updateDoc(doc(db, COLS.vendors, id), {
    deletedAt: null,
    deletedBy: null,
    deletedByEmail: null,
  });

// Hard delete — permanent. Wipes Firestore record AND R2 docs folder.
// Use only from a trash/deleted view after confirmation.
export const permanentlyDeleteVendor = async (id) => {
  try {
    const snap = await getDoc(doc(db, COLS.vendors, id));
    const applicationId = snap.data()?.applicationId;
    if (applicationId) {
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        await fetch("/api/vendor-docs/delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ applicationId }),
        });
      }
    }
  } catch (e) {
    console.warn("R2 cleanup failed (non-fatal):", e);
  }
  return deleteDoc(doc(db, COLS.vendors, id));
};

export const approveKYC = async (id, adminUser, entityName) => {
  await updateDoc(doc(db, COLS.vendors, id), {
    kyc: "approved",
    status: "verified",
    verifiedAt: serverTimestamp(),
  });
  await logAudit(
    "vendor_kyc_approved",
    "vendor",
    id,
    { entityName: entityName || null },
    adminUser,
  );
};

export const rejectKYC = async (id, reason, adminUser, entityName) => {
  await updateDoc(doc(db, COLS.vendors, id), {
    kyc: "rejected",
    kycRejectedReason: reason,
  });
  await logAudit(
    "vendor_kyc_rejected",
    "vendor",
    id,
    { entityName: entityName || null, reason },
    adminUser,
  );
};

// ── User CRUD ─────────────────────────────────────────────────────
export const getUsers = (cb) =>
  onSnapshot(
    query(collection(db, COLS.users), orderBy("createdAt", "desc")),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const addUser = (data) =>
  addDoc(collection(db, COLS.users), {
    status: "active",
    deletedAt: null,
    totalJobs: 0,
    ...data,
    createdAt: serverTimestamp(),
  });

export const updateUser = (id, data) =>
  updateDoc(doc(db, COLS.users, id), data);

// Soft delete — preserves the record + history.
export const deleteUser = (id, adminUser) =>
  updateDoc(doc(db, COLS.users, id), {
    deletedAt: serverTimestamp(),
    deletedBy: adminUser?.uid || "unknown",
    deletedByEmail: adminUser?.email || null,
  });

export const restoreUser = (id) =>
  updateDoc(doc(db, COLS.users, id), {
    deletedAt: null,
    deletedBy: null,
    deletedByEmail: null,
  });

// Hard delete — permanent. Use only from a trash/deleted view.
export const permanentlyDeleteUser = (id) =>
  deleteDoc(doc(db, COLS.users, id));

export const blockUser = async (id, reason, adminUser, entityName) => {
  await updateDoc(doc(db, COLS.users, id), {
    status: "blocked",
    blockedReason: reason,
    blockedAt: serverTimestamp(),
  });
  await logAudit(
    "user_blocked",
    "user",
    id,
    { entityName: entityName || null, reason },
    adminUser,
  );
};

export const unbanUser = async (id, adminUser, entityName) => {
  await updateDoc(doc(db, COLS.users, id), {
    status: "active",
    blockedReason: null,
  });
  await logAudit(
    "user_unbanned",
    "user",
    id,
    { entityName: entityName || null },
    adminUser,
  );
};

// ── Service requests ──────────────────────────────────────────────
export const getRequests = (cb) =>
  onSnapshot(
    query(
      collection(db, COLS.requests),
      orderBy("createdAt", "desc"),
      limit(50),
    ),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const updateRequestStatus = (id, status) =>
  updateDoc(doc(db, COLS.requests, id), {
    status,
    updatedAt: serverTimestamp(),
  });

// ── SOS ───────────────────────────────────────────────────────────
export const getSOS = (cb) =>
  onSnapshot(
    query(collection(db, COLS.sos), orderBy("createdAt", "desc"), limit(20)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const resolveSOS = (id) =>
  updateDoc(doc(db, COLS.sos, id), {
    resolved: true,
    resolvedAt: serverTimestamp(),
  });

// ── Reviews ───────────────────────────────────────────────────────
export const getReviews = (cb) =>
  onSnapshot(
    query(collection(db, COLS.reviews), orderBy("createdAt", "desc")),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

// Moderation: flag = "this is bad, hide from public"; unflag = "fine, show again".
// These are NOT delete/restore — see soft delete below.
export const flagReview = (id) =>
  updateDoc(doc(db, COLS.reviews, id), { status: "flagged" });
export const unflagReview = (id) =>
  updateDoc(doc(db, COLS.reviews, id), { status: "visible" });
// Back-compat alias for older call sites.
export const restoreReview = unflagReview;

// Soft delete (preserves the record).
export const removeReview = (id, adminUser) =>
  updateDoc(doc(db, COLS.reviews, id), {
    deletedAt: serverTimestamp(),
    deletedBy: adminUser?.uid || "unknown",
    deletedByEmail: adminUser?.email || null,
  });

// Restore from soft delete.
export const restoreDeletedReview = (id) =>
  updateDoc(doc(db, COLS.reviews, id), {
    deletedAt: null,
    deletedBy: null,
    deletedByEmail: null,
  });

// Hard delete — final.
export const permanentlyDeleteReview = (id) =>
  deleteDoc(doc(db, COLS.reviews, id));

// ── Notifications (stored in Firestore + sent via Cloud Function) ──
export const getNotifications = (cb) =>
  onSnapshot(
    query(
      collection(db, COLS.notifications),
      orderBy("sentAt", "desc"),
      limit(30),
    ),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

// Send a notification: persists a record in Firestore AND triggers an
// actual FCM push via /api/fcm/send (Firebase Admin SDK on Vercel).
// Returns { saved, deliveryStatus, deliveryError? }.
//
// Pass `topic` (default "all") to broadcast to a topic, or `token` to
// target a single device. `token` lookup is the caller's responsibility.
export const sendNotification = async ({
  title,
  body,
  topic = "all",
  token,
  sentBy,
}) => {
  // 1. Save record to Firestore so admins see history immediately.
  await addDoc(collection(db, COLS.notifications), {
    title,
    body,
    topic: token ? "single_device" : topic,
    targetToken: token || null,
    sentBy,
    sentAt: serverTimestamp(),
    status: "sent",
  });

  // 2. Trigger actual FCM delivery via the admin-only Vercel function.
  //    Falls back to legacy VITE_FCM_FUNCTION_URL if the new endpoint
  //    isn't reachable (e.g. local dev without functions running).
  let deliveryStatus = "queued";
  let deliveryError;
  try {
    const idToken = await auth.currentUser?.getIdToken();
    if (!idToken) throw new Error("not_signed_in");
    const res = await fetch("/api/fcm/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ title, body, topic, token }),
    });
    if (res.ok) {
      deliveryStatus = "delivered";
    } else {
      const j = await res.json().catch(() => ({}));
      deliveryStatus = "failed";
      deliveryError = j.error || `HTTP ${res.status}`;
    }
  } catch (e) {
    // Last-ditch fallback: legacy cloud function URL if configured.
    const fnUrl = import.meta.env.VITE_FCM_FUNCTION_URL;
    if (fnUrl) {
      try {
        await fetch(fnUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, body, topic }),
        });
        deliveryStatus = "delivered_legacy";
      } catch (e2) {
        deliveryStatus = "failed";
        deliveryError = e2.message || String(e);
      }
    } else {
      deliveryStatus = "failed";
      deliveryError = e.message || String(e);
    }
  }

  return { saved: true, deliveryStatus, deliveryError };
};

// ── Audit log (read) ──────────────────────────────────────────────
export const getAuditLog = (cb) =>
  onSnapshot(
    query(
      collection(db, COLS.auditLog),
      orderBy("timestamp", "desc"),
      limit(50),
    ),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

// ── Admin users ───────────────────────────────────────────────────
// Roles: "superadmin" (locked, the original bootstrap admin),
//        "manager" (can invite/edit/disable other non-superadmin admins),
//        "support" (content-only access),
//        "viewer"  (read-only).
export const getAdminUsers = (cb) =>
  onSnapshot(collection(db, COLS.adminUsers), (snap) =>
    cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const updateAdminUser = (uid, data) =>
  updateDoc(doc(db, COLS.adminUsers, uid), data);

export const removeAdminUser = (uid) =>
  deleteDoc(doc(db, COLS.adminUsers, uid));

// ── Service zones ─────────────────────────────────────────────────
const ZONES_COL = "service_zones";
export const getZones = (cb) =>
  onSnapshot(
    query(collection(db, ZONES_COL), orderBy("createdAt", "desc")),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const addZone = (data) =>
  addDoc(collection(db, ZONES_COL), {
    name: "",
    coverage: "high",
    avgResponseMins: 0,
    vendorCount: 0,
    ...data,
    createdAt: serverTimestamp(),
  });

export const updateZone = (id, data) =>
  updateDoc(doc(db, ZONES_COL, id), data);

export const deleteZone = (id) => deleteDoc(doc(db, ZONES_COL, id));

// ── App config ────────────────────────────────────────────────────
export const getAppConfig = (cb) =>
  onSnapshot(doc(db, COLS.appConfig, "main"), (snap) => cb(snap.data() || {}));

export const saveAppConfig = (data) =>
  setDoc(
    doc(db, COLS.appConfig, "main"),
    { ...data, updatedAt: serverTimestamp() },
    { merge: true },
  );

// ── File upload helper (Cloudflare R2 via presigned PUT) ──────────
// Uploads `file` to R2 under `<applicationId>/<key>.<ext>`.
// Returns the storage path (NOT a URL — use viewVendorDoc(path) to get
// a signed URL for display). Stored path goes into the vendor doc so
// admins can later view/delete via the API routes.
export const uploadFile = (file, applicationId, key, onProgress) =>
  new Promise(async (resolve, reject) => {
    try {
      const presignRes = await fetch("/api/vendor-docs/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          applicationId,
          key,
          contentType: file.type,
          size: file.size,
        }),
      });
      if (!presignRes.ok) {
        const j = await presignRes.json().catch(() => ({}));
        throw new Error(j.error || `presign_failed (${presignRes.status})`);
      }
      const { uploadUrl, path } = await presignRes.json();

      // Use XMLHttpRequest for upload progress.
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(path);
        else reject(new Error(`upload_failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error("network_error"));
      xhr.send(file);
    } catch (e) {
      reject(e);
    }
  });

// Get a 1-hour signed URL for an admin to view a vendor doc.
export async function viewVendorDoc(path) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("not_signed_in");
  const res = await fetch("/api/vendor-docs/view-url", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `view_url_failed (${res.status})`);
  }
  const { viewUrl } = await res.json();
  return viewUrl;
}

// Admin: delete a single vendor doc object from R2.
export async function deleteVendorDoc(path) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("not_signed_in");
  const res = await fetch("/api/vendor-docs/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `delete_failed (${res.status})`);
  }
}

// ── FCM foreground listener ───────────────────────────────────────
export const onFCMMessage = (cb) => onMessage(messaging, cb);

export const requestFCMToken = () =>
  getToken(messaging, { vapidKey: import.meta.env.VITE_FCM_VAPID_KEY });

// ── Vendor public registration (no auth needed) ───────────────────
export const submitVendorApplication = (data) =>
  addDoc(collection(db, COLS.vendors), {
    ...data,
    status: "pending",
    kyc: "pending",
    isVerified: false,
    isOpen: false,
    rating: 0,
    reviewCount: 0,
    createdAt: serverTimestamp(),
    source: "self_registration",
  });

export { serverTimestamp, Timestamp };

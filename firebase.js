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
    ...data,
    createdAt: serverTimestamp(),
    status: "pending",
    kyc: "pending",
  });

export const updateVendor = (id, data) =>
  updateDoc(doc(db, COLS.vendors, id), data);

export const deleteVendor = async (id) => {
  // Best-effort: also delete this applicant's R2 docs folder.
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

export const approveKYC = async (id, adminUser) => {
  await updateDoc(doc(db, COLS.vendors, id), {
    kyc: "approved",
    status: "verified",
    verifiedAt: serverTimestamp(),
  });
  await logAudit("vendor_kyc_approved", "vendor", id, {}, adminUser);
};

export const rejectKYC = async (id, reason, adminUser) => {
  await updateDoc(doc(db, COLS.vendors, id), {
    kyc: "rejected",
    kycRejectedReason: reason,
  });
  await logAudit("vendor_kyc_rejected", "vendor", id, { reason }, adminUser);
};

// ── User CRUD ─────────────────────────────────────────────────────
export const getUsers = (cb) =>
  onSnapshot(
    query(collection(db, COLS.users), orderBy("createdAt", "desc")),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

export const blockUser = async (id, reason, adminUser) => {
  await updateDoc(doc(db, COLS.users, id), {
    status: "blocked",
    blockedReason: reason,
    blockedAt: serverTimestamp(),
  });
  await logAudit("user_blocked", "user", id, { reason }, adminUser);
};

export const unbanUser = async (id, adminUser) => {
  await updateDoc(doc(db, COLS.users, id), {
    status: "active",
    blockedReason: null,
  });
  await logAudit("user_unbanned", "user", id, {}, adminUser);
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

export const flagReview = (id) =>
  updateDoc(doc(db, COLS.reviews, id), { status: "flagged" });
export const removeReview = (id) => deleteDoc(doc(db, COLS.reviews, id));
export const restoreReview = (id) =>
  updateDoc(doc(db, COLS.reviews, id), { status: "visible" });

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

// To actually SEND FCM push, call your Cloud Function:
// POST https://us-central1-YOUR_PROJECT.cloudfunctions.net/sendNotification
// Body: { title, body, topic: "all" | uid }
export const sendNotification = async ({ title, body, topic, sentBy }) => {
  // 1. Save record to Firestore
  await addDoc(collection(db, COLS.notifications), {
    title,
    body,
    topic,
    sentBy,
    sentAt: serverTimestamp(),
    status: "sent",
  });
  // 2. Call Cloud Function (URL configured via VITE_FCM_FUNCTION_URL)
  const fnUrl = import.meta.env.VITE_FCM_FUNCTION_URL;
  if (!fnUrl) {
    console.warn("VITE_FCM_FUNCTION_URL not set – notification saved to Firestore only.");
    return;
  }
  try {
    await fetch(fnUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, topic }),
    });
  } catch (e) {
    console.warn("FCM call failed – notification saved to Firestore only.", e);
  }
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

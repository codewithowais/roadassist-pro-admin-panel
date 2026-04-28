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
// Recursively strip `undefined` from arbitrary plain objects/arrays.
// Firestore rejects undefined fields with "Unsupported field value:
// undefined" — turning them into null (or dropping them) keeps the
// audit log resilient to callers who optionally pass count fields
// from a sometimes-missing response (e.g. sendNotification() returns
// no successCount, while sendNotificationToAudience() does).
function stripUndefined(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (typeof value === "object" && value.constructor === Object) {
    const out = {};
    for (const k of Object.keys(value)) {
      const v = stripUndefined(value[k]);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  return value;
}

export async function logAudit(
  action,
  entityType,
  entityId,
  details = {},
  adminUser,
) {
  const cleanDetails = stripUndefined(details) || {};
  // Best-effort browser device info — null on SSR or older browsers.
  const ua =
    typeof navigator !== "undefined" && navigator.userAgent
      ? navigator.userAgent
      : null;
  await addDoc(collection(db, COLS.auditLog), {
    action,
    // Unified actor model — admin actions get actorType:"admin"; mobile
    // (customer/vendor) writes set their own. Read filters in
    // AuditLog_Page rely on this field having a value on every doc.
    actorType: "admin",
    actorUid: adminUser?.uid || "unknown",
    actorName: adminUser?.email || "Admin",
    actorEmail: adminUser?.email || null,
    // Legacy fields kept for backwards compatibility with existing
    // AuditLog_Page code paths that read adminUid/adminName directly.
    adminUid: adminUser?.uid || "unknown",
    adminName: adminUser?.email || "Admin",
    entityType,
    entityId,
    entityName: cleanDetails?.entityName || null,
    details: cleanDetails,
    device: { platform: "web", userAgent: ua },
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
  // CRITICAL: must set isVerified:true — the mobile app filters vendors by
  // `where('isVerified','==',true)`. Without this, an approved vendor never
  // appears in the customer-facing list. See SCHEMA.md.
  await updateDoc(doc(db, COLS.vendors, id), {
    kyc: "approved",
    status: "verified",
    isVerified: true,
    verifiedAt: serverTimestamp(),
  });
  await logAudit(
    "vendor_kyc_approved",
    "vendor",
    id,
    { entityName: entityName || null },
    adminUser,
  );
  // Best-effort: write an in-app notification to the vendor's user doc
  // so they see the approval the next time they open the app. Falls back
  // silently — the audit log + vendor profile state are the source of
  // truth, this is just a UX nicety.
  try {
    const vendorSnap = await getDoc(doc(db, COLS.vendors, id));
    const authUid = vendorSnap.data()?.authUid;
    if (authUid) {
      await addDoc(collection(db, COLS.notifications), {
        userId: authUid,
        type: "systemInfo",
        title: "You’re approved ✨",
        body: "KYC complete — you can now accept jobs in the RoadAssist Pro app.",
        isRead: false,
        createdAt: serverTimestamp(),
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[approveKYC] notify failed:", e);
  }
};

export const rejectKYC = async (id, reason, adminUser, entityName) => {
  await updateDoc(doc(db, COLS.vendors, id), {
    kyc: "rejected",
    status: "rejected",
    isVerified: false,
    kycRejectedReason: reason,
  });
  await logAudit(
    "vendor_kyc_rejected",
    "vendor",
    id,
    { entityName: entityName || null, reason },
    adminUser,
  );
  try {
    const vendorSnap = await getDoc(doc(db, COLS.vendors, id));
    const authUid = vendorSnap.data()?.authUid;
    if (authUid) {
      await addDoc(collection(db, COLS.notifications), {
        userId: authUid,
        type: "systemInfo",
        title: "KYC needs another look",
        body: reason
          ? `Your application was rejected: ${reason}`
          : "Your application was rejected. Please contact support for details.",
        isRead: false,
        createdAt: serverTimestamp(),
      });
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn("[rejectKYC] notify failed:", e);
  }
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

// ── Emergency contacts (per-user subcollection) ──────────────────
// Stored at users/{uid}/emergencyContacts/{contactId} by the mobile app.
// Admins can read & write any user's contacts (e.g. to clean up bad
// data or pre-seed a contact for a relative).
export const getEmergencyContacts = (uid, cb) => {
  if (!uid) {
    cb([]);
    return () => {};
  }
  return onSnapshot(
    query(
      collection(db, "users", uid, "emergencyContacts"),
      orderBy("createdAt", "asc"),
    ),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    () => cb([]),
  );
};

// Admin lookup: find a user by phone (used to flag a contact as
// app-linked when admin is adding/editing on someone else's behalf).
export const lookupUserByPhone = async (phone) => {
  if (!phone) return null;
  const snap = await getDocs(
    query(collection(db, COLS.users), where("phone", "==", phone), limit(1)),
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { uid: d.id, ...d.data() };
};

export const addEmergencyContact = async (uid, contact) => {
  if (!uid) throw new Error("uid required");
  const payload = {
    name: contact.name || "",
    phone: contact.phone || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  if (contact.linkedUid) {
    payload.linkedUid = contact.linkedUid;
    payload.linkedAt = serverTimestamp();
  }
  return addDoc(collection(db, "users", uid, "emergencyContacts"), payload);
};

export const updateEmergencyContact = async (uid, contactId, contact) => {
  if (!uid || !contactId) throw new Error("uid and contactId required");
  const payload = {
    name: contact.name || "",
    phone: contact.phone || "",
    updatedAt: serverTimestamp(),
  };
  if (contact.linkedUid !== undefined) {
    payload.linkedUid = contact.linkedUid || null;
    if (contact.linkedUid) payload.linkedAt = serverTimestamp();
  }
  return updateDoc(
    doc(db, "users", uid, "emergencyContacts", contactId),
    payload,
  );
};

export const deleteEmergencyContact = (uid, contactId) =>
  deleteDoc(doc(db, "users", uid, "emergencyContacts", contactId));

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
    // Pull more history so the SOS-page History view can show resolved
    // alerts going back further than the active-only feed needed.
    query(collection(db, COLS.sos), orderBy("createdAt", "desc"), limit(200)),
    (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
  );

// Resolves an SOS alert. Stamps the resolving admin onto the doc and
// emits an `audit_log` row so the unified Activity History (and the
// SOS-page history view) can show who closed each alert.
export const resolveSOS = async (id, adminUser, entityName) => {
  await updateDoc(doc(db, COLS.sos, id), {
    resolved: true,
    resolvedAt: serverTimestamp(),
    resolvedBy: adminUser?.email || adminUser?.uid || "admin",
  });
  await logAudit(
    "sos_resolved",
    "sos",
    id,
    { entityName: entityName || null },
    adminUser,
  );
};

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
    // Force-refresh the ID token. Without this, a long-lived admin
    // session can ship a cached token that's already expired by the
    // time it reaches Firebase Admin's verifyIdToken — surfaces as a
    // 401 "invalid_token: id-token-expired".
    const idToken = await auth.currentUser?.getIdToken(true);
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
      // eslint-disable-next-line no-console
      console.error("[fcm/send] failed:", res.status, j);
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

// Per-token broadcast — fallback for devices that haven't subscribed to the
// FCM topic yet (e.g. older APK builds). Walks the relevant Firestore
// collection, gathers `fcmToken` values, and posts them to /api/fcm/send in
// 500-token chunks (FCM's multicast limit).
//
// audience: "users" | "vendors" — picks which top-level collection to walk.
// Returns { saved, deliveryStatus, sentTokens, successCount, failureCount,
//          failedTokens, deliveryError? }.
export const sendNotificationToAudience = async ({
  title,
  body,
  audience = "users",
  sentBy,
}) => {
  if (audience !== "users" && audience !== "vendors") {
    throw new Error(`Unknown audience: ${audience}`);
  }

  // 1. Persist a record so admins see the broadcast in history.
  await addDoc(collection(db, COLS.notifications), {
    title,
    body,
    topic: `tokens:${audience}`,
    targetToken: null,
    sentBy,
    sentAt: serverTimestamp(),
    status: "sent",
  });

  // 2. Pull tokens from Firestore. FCM tokens live on `users/{uid}` for
  //    BOTH customers and vendors — vendor docs don't carry fcmToken.
  //    So we always walk users/, filtered by role for vendor audiences.
  //    Stale tokens (orphaned on previous owners after a sign-out before
  //    we added the cleanup path) are deduped via a Set so the same
  //    physical device receives at most one notification.
  const usersSnap = audience === "vendors"
    ? await getDocs(
        query(collection(db, COLS.users), where("role", "==", "vendor")),
      )
    : await getDocs(collection(db, COLS.users));
  const tokenSet = new Set();
  usersSnap.forEach((d) => {
    const t = d.data()?.fcmToken;
    if (typeof t === "string" && t.length > 0) tokenSet.add(t);
  });
  const tokens = Array.from(tokenSet);

  if (tokens.length === 0) {
    return {
      saved: true,
      deliveryStatus: "no_tokens",
      sentTokens: 0,
      successCount: 0,
      failureCount: 0,
      failedTokens: [],
    };
  }

  // 3. Send in 500-token chunks (FCM multicast hard limit).
  // Force-refresh — see sendNotification() above for the rationale.
  const idToken = await auth.currentUser?.getIdToken(true);
  if (!idToken) {
    return {
      saved: true,
      deliveryStatus: "failed",
      sentTokens: tokens.length,
      successCount: 0,
      failureCount: tokens.length,
      failedTokens: [],
      deliveryError: "not_signed_in",
    };
  }

  const CHUNK = 500;
  let successCount = 0;
  let failureCount = 0;
  const failedTokens = [];
  let deliveryError;

  for (let i = 0; i < tokens.length; i += CHUNK) {
    const chunk = tokens.slice(i, i + CHUNK);
    try {
      const res = await fetch("/api/fcm/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ title, body, tokens: chunk }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        successCount += j.successCount || 0;
        failureCount += j.failureCount || 0;
        if (Array.isArray(j.failedTokens)) {
          failedTokens.push(...j.failedTokens);
        }
      } else {
        failureCount += chunk.length;
        deliveryError = j.error || `HTTP ${res.status}`;
      }
    } catch (e) {
      failureCount += chunk.length;
      deliveryError = e.message || String(e);
    }
  }

  return {
    saved: true,
    deliveryStatus: failureCount === 0 ? "delivered" : "partial",
    sentTokens: tokens.length,
    successCount,
    failureCount,
    failedTokens,
    deliveryError,
  };
};

// Send a notification to a hand-picked set of users by uid. For each
// uid we (a) write a notifications/{id} doc targeted at that user so
// it appears in their in-app inbox, then (b) collect their fcmToken
// and post a multicast push via /api/fcm/send.
//
// uids: string[]  — the user ids selected by the admin
// Returns: { saved, recipients, sentTokens, successCount, failureCount,
//            failedTokens, deliveryStatus, deliveryError? }
export const sendNotificationToUsers = async ({
  title,
  body,
  uids,
  sentBy,
}) => {
  if (!Array.isArray(uids) || uids.length === 0) {
    throw new Error("At least one recipient uid is required.");
  }

  // 1. Write a per-user inbox notification + a single audit-style
  //    aggregate row so the broadcast history page shows it.
  const writes = uids.map((uid) =>
    addDoc(collection(db, COLS.notifications), {
      userId: uid,
      type: "targeted",
      title,
      body,
      isRead: false,
      createdAt: serverTimestamp(),
    }),
  );
  await Promise.allSettled(writes);
  await addDoc(collection(db, COLS.notifications), {
    title,
    body,
    topic: `selected_users:${uids.length}`,
    targetToken: null,
    sentBy,
    sentAt: serverTimestamp(),
    status: "sent",
  });

  // 2. Collect FCM tokens for the selected uids. We dedupe via Set so a
  //    single physical device that's signed in as multiple of these
  //    users (rare but possible) still only gets one push.
  const tokenSet = new Set();
  // Firestore allows up to 30 ids per `in` query (Firebase v10+). Chunk.
  const ID_CHUNK = 30;
  for (let i = 0; i < uids.length; i += ID_CHUNK) {
    const chunk = uids.slice(i, i + ID_CHUNK);
    try {
      const snap = await getDocs(
        query(collection(db, COLS.users), where("uid", "in", chunk)),
      );
      snap.forEach((d) => {
        const t = d.data()?.fcmToken;
        if (typeof t === "string" && t.length > 0) tokenSet.add(t);
      });
    } catch (e) {
      // Fallback: some user docs may not have a `uid` field stored
      // (older accounts). Hit each by doc-id one-by-one.
      // eslint-disable-next-line no-console
      console.warn("[sendToUsers] in-query failed, fallback:", e);
      for (const uid of chunk) {
        try {
          const d = await getDoc(doc(db, COLS.users, uid));
          const t = d.data()?.fcmToken;
          if (typeof t === "string" && t.length > 0) tokenSet.add(t);
        } catch {}
      }
    }
  }
  const tokens = Array.from(tokenSet);

  if (tokens.length === 0) {
    return {
      saved: true,
      recipients: uids.length,
      deliveryStatus: "no_tokens",
      sentTokens: 0,
      successCount: 0,
      failureCount: 0,
      failedTokens: [],
    };
  }

  // 3. Push via /api/fcm/send in 500-token chunks.
  // Force-refresh — see sendNotification() above for the rationale.
  const idToken = await auth.currentUser?.getIdToken(true);
  if (!idToken) {
    return {
      saved: true,
      recipients: uids.length,
      deliveryStatus: "failed",
      sentTokens: tokens.length,
      successCount: 0,
      failureCount: tokens.length,
      failedTokens: [],
      deliveryError: "not_signed_in",
    };
  }
  const CHUNK = 500;
  let successCount = 0;
  let failureCount = 0;
  const failedTokens = [];
  let deliveryError;
  for (let i = 0; i < tokens.length; i += CHUNK) {
    const chunk = tokens.slice(i, i + CHUNK);
    try {
      const res = await fetch("/api/fcm/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ title, body, tokens: chunk }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok) {
        successCount += j.successCount || 0;
        failureCount += j.failureCount || 0;
        if (Array.isArray(j.failedTokens)) failedTokens.push(...j.failedTokens);
      } else {
        failureCount += chunk.length;
        deliveryError = j.error || `HTTP ${res.status}`;
        // eslint-disable-next-line no-console
        console.error("[fcm/send users] failed:", res.status, j);
      }
    } catch (e) {
      failureCount += chunk.length;
      deliveryError = e.message || String(e);
    }
  }
  return {
    saved: true,
    recipients: uids.length,
    deliveryStatus: failureCount === 0 ? "delivered" : "partial",
    sentTokens: tokens.length,
    successCount,
    failureCount,
    failedTokens,
    deliveryError,
  };
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

// ── Feature flags ────────────────────────────────────────────────
// Stored at `app_config/flags`. The mobile app and admin both stream this
// doc so a flag flip propagates without an app rebuild. Defaults live on
// the consumer side (FeatureFlagsService in Flutter / DEFAULT_FLAGS here)
// so the app keeps working if the doc doesn't exist yet.
export const DEFAULT_FLAGS = {
  vendorSelfRegistration: true,
  vendorAppEnabled: true,
  kycStrict: true,
  liveLocationTracking: true,
  simulatedTrackingFallback: false,
  autoNotifyVendorOnRequest: true,
  fcmPushEnabled: true,
  smsNotifications: false,
  whatsappNotifications: false,
  sosEnabled: true,
  reviewsEnabled: true,
  paymentCollection: false,
  aiAssistantEnabled: true,
  autoCompleteOnArrived: true,
  maxActiveJobsPerVendor: 1,
  appUnderMaintenance: false,
  maintenanceMessage: "",
};

export const getFeatureFlags = (cb) =>
  onSnapshot(doc(db, COLS.appConfig, "flags"), (snap) =>
    cb({ ...DEFAULT_FLAGS, ...(snap.data() || {}) }),
  );

export const saveFeatureFlags = (flags) =>
  setDoc(
    doc(db, COLS.appConfig, "flags"),
    { ...flags, updatedAt: serverTimestamp() },
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

// ── Admin: create a Firebase Auth account for a new user/vendor ─────
// Wraps the admin-only `/api/users/create` endpoint. Pass role:'vendor'
// when adding a vendor from the AddVendorModal so the mobile app's role
// gate routes the new account to the vendor surface on first login.
//
// Returns { uid, email, role } on success.
export async function adminCreateAuthAccount({
  email,
  password,
  name,
  phone,
  role = "customer",
}) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("not_signed_in");
  const res = await fetch("/api/users/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ email, password, name, phone, role }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = j.error || `http_${res.status}`;
    const err = new Error(code);
    err.code = code;
    throw err;
  }
  return j;
}

export { serverTimestamp, Timestamp };

// ─────────────────────────────────────────────────────────────────────────────
//  supabase.js  —  RoadAssist Pro Admin Panel
//  Replaces firebase.js. Exports the same function surface so call sites
//  need no changes. Firestore onSnapshot → Supabase Realtime + one-shot fetch.
// ─────────────────────────────────────────────────────────────────────────────
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

// ── Table name map (mirrors COLS from firebase.js) ────────────────────────────
// Exported so existing call sites that use COLS.xxx still work.
export const COLS = {
  users: "profiles",
  vendors: "vendors",
  requests: "service_requests",
  sos: "sos_hotspots",
  reviews: "reviews",
  notifications: "notifications",
  auditLog: "audit_log",
  appConfig: "app_config",
  adminUsers: "profiles",  // folded into profiles.role
};

export const TBL = COLS; // alias

// ── Key conversion: Postgres snake_case → React camelCase ─────────────────────
// Keeps all React UI components untouched after migration.
const toCamel = (s) => s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

function camelize(val) {
  if (Array.isArray(val)) return val.map(camelize);
  if (val && typeof val === "object" && val.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(val)) out[toCamel(k)] = camelize(v);
    return out;
  }
  return val;
}

// ── Auth helpers ──────────────────────────────────────────────────────────────
export const adminLogin = (email, pass) =>
  supabase.auth.signInWithPassword({ email, password: pass });

export const adminLogout = () => supabase.auth.signOut();

// Compatibility shim — use getAuthToken() for all new code.
// supabase-js v2 removed the synchronous session() method.
// We return a minimal object from the cached JWT claims if available.
export const auth = {
  get currentUser() {
    // v2 does not expose a synchronous currentUser; all callers should use getAuthToken()
    // This shim is kept for legacy call sites but returns null in most contexts.
    // Safe: all critical paths (Add User, Invite) now use getAuthToken() directly.
    return null;
  },
};

// Async version (preferred — use this in new code)
export async function getAuthToken(forceRefresh = false) {
  if (forceRefresh) await supabase.auth.refreshSession();
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token ?? null;
}

// ── Audit logger ──────────────────────────────────────────────────────────────
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

export async function logAudit(action, entityType, entityId, details = {}, adminUser) {
  const cleanDetails = stripUndefined(details) || {};
  const ua =
    typeof navigator !== "undefined" && navigator.userAgent
      ? navigator.userAgent
      : null;
  await supabase.from(COLS.auditLog).insert({
    action,
    actor_type: "admin",
    actor_uid: adminUser?.uid || "unknown",
    actor_name: adminUser?.email || "Admin",
    actor_email: adminUser?.email || null,
    admin_uid: adminUser?.uid || "unknown",
    admin_name: adminUser?.email || "Admin",
    entity_type: entityType,
    entity_id: entityId,
    entity_name: cleanDetails?.entityName || null,
    details: cleanDetails,
    device: { platform: "web", user_agent: ua },
  });
}

// ── Realtime helper ───────────────────────────────────────────────────────────
// Returns an unsubscribe function matching the Firestore onSnapshot contract.
function liveQuery({ table, filter, order, limit: lim, cb }) {
  const fetchAll = async () => {
    let q = supabase.from(table).select("*");
    if (filter) q = filter(q);
    if (order) q = q.order(order.col, { ascending: order.asc ?? false });
    if (lim) q = q.limit(lim);
    const { data } = await q;
    cb((data || []).map(camelize));
  };
  fetchAll();
  const channel = supabase
    .channel(`${table}:admin:${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table },
      fetchAll,
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ── Vendor CRUD ───────────────────────────────────────────────────────────────
export const getVendors = (cb) =>
  liveQuery({ table: COLS.vendors, order: { col: "created_at" }, limit: 100, cb });

export const addVendor = (data) =>
  supabase.from(COLS.vendors).insert({
    status: "pending",
    kyc: "pending",
    is_verified: false,
    is_open: false,
    rating: 0,
    review_count: 0,
    deleted_at: null,
    name: data.name || "",
    business_name: data.businessName || data.business_name || "",
    owner_name: data.ownerName || data.owner_name || "",
    category: data.category || "",
    city: data.city || "",
    area: data.area || null,
    lat: data.lat || 0,
    lng: data.lng || 0,
    phone: data.phone || "",
    whatsapp: data.whatsapp || null,
    email: data.email || null,
    cost_range: data.costRange || data.cost_range || null,
    description: data.description || null,
    operating_hours: data.operatingHours || data.operating_hours || null,
    application_id: data.applicationId || data.application_id || null,
    seed_id: data.seedId || data.seed_id || null,
    auth_uid: data.authUid || data.auth_uid || null,   // links vendor to their Supabase Auth account
    source: data.source || "seed",
    agreed_to_terms: data.agreedToTerms ?? data.agreed_to_terms ?? null,
    cnic_number: data.cnicNumber || data.cnic_number || null,
    vehicle_reg: data.vehicleReg || data.vehicle_reg || null,
    documents: data.documents || null,
  });

export const updateVendor = (id, data) =>
  supabase.from(COLS.vendors).update(toSnakeKeys(data)).eq("id", id);

export const deleteVendor = (id, adminUser) =>
  supabase.from(COLS.vendors).update({
    deleted_at: new Date().toISOString(),
    deleted_by: adminUser?.uid || "unknown",
    deleted_by_email: adminUser?.email || null,
  }).eq("id", id);

export const restoreVendor = (id) =>
  supabase.from(COLS.vendors).update({
    deleted_at: null,
    deleted_by: null,
    deleted_by_email: null,
  }).eq("id", id);

export const permanentlyDeleteVendor = async (id) => {
  try {
    const { data } = await supabase
      .from(COLS.vendors)
      .select("application_id")
      .eq("id", id)
      .single();
    const applicationId = data?.application_id;
    if (applicationId) {
      const token = await getAuthToken();
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
  return supabase.from(COLS.vendors).delete().eq("id", id);
};

export const approveKYC = async (id, adminUser, entityName) => {
  // The enforce_kyc_state_machine trigger forces is_verified=true when kyc='approved'.
  await supabase.from(COLS.vendors).update({ kyc: "approved" }).eq("id", id);
  await logAudit("vendor_kyc_approved", "vendor", id, { entityName: entityName || null }, adminUser);
  try {
    const { data: vendor } = await supabase
      .from(COLS.vendors)
      .select("auth_uid")
      .eq("id", id)
      .single();
    if (vendor?.auth_uid) {
      await supabase.from(COLS.notifications).insert({
        user_id: vendor.auth_uid,
        type: "systemInfo",
        title: "You're approved",
        body: "KYC complete — you can now accept jobs in the RoadAssist Pro app.",
        is_read: false,
      });
    }
  } catch (e) {
    console.warn("[approveKYC] notify failed:", e);
  }
};

export const rejectKYC = async (id, reason, adminUser, entityName) => {
  await supabase.from(COLS.vendors).update({
    kyc: "rejected",
    status: "rejected",
    is_verified: false,
    kyc_rejected_reason: reason,
  }).eq("id", id);
  await logAudit("vendor_kyc_rejected", "vendor", id, { entityName: entityName || null, reason }, adminUser);
  try {
    const { data: vendor } = await supabase
      .from(COLS.vendors)
      .select("auth_uid")
      .eq("id", id)
      .single();
    if (vendor?.auth_uid) {
      await supabase.from(COLS.notifications).insert({
        user_id: vendor.auth_uid,
        type: "systemInfo",
        title: "KYC needs another look",
        body: reason
          ? `Your application was rejected: ${reason}`
          : "Your application was rejected. Please contact support.",
        is_read: false,
      });
    }
  } catch (e) {
    console.warn("[rejectKYC] notify failed:", e);
  }
};

// ── User CRUD ─────────────────────────────────────────────────────────────────
export const getUsers = (cb) =>
  liveQuery({ table: COLS.users, order: { col: "created_at" }, limit: 100, cb });

export const addUser = (data) =>
  supabase.from(COLS.users).insert({
    status: "active",
    deleted_at: null,
    total_jobs: 0,
    name: data.name || "",
    email: data.email || "",
    phone: data.phone || "",
    role: data.role || "customer",
    photo_url: data.photoUrl || data.photo_url || "",
  });

export const updateUser = (id, data) =>
  supabase.from(COLS.users).update(toSnakeKeys(data)).eq("id", id);

export const deleteUser = (id, adminUser) =>
  supabase.from(COLS.users).update({
    deleted_at: new Date().toISOString(),
    deleted_by: adminUser?.uid || "unknown",
    deleted_by_email: adminUser?.email || null,
  }).eq("id", id);

export const restoreUser = (id) =>
  supabase.from(COLS.users).update({
    deleted_at: null,
    deleted_by: null,
    deleted_by_email: null,
  }).eq("id", id);

export const permanentlyDeleteUser = (id) =>
  supabase.from(COLS.users).delete().eq("id", id);

export const blockUser = async (id, reason, adminUser, entityName) => {
  await supabase.from(COLS.users).update({
    status: "blocked",
    blocked_reason: reason,
    blocked_at: new Date().toISOString(),
  }).eq("id", id);
  await logAudit("user_blocked", "user", id, { entityName: entityName || null, reason }, adminUser);
};

export const unbanUser = async (id, adminUser, entityName) => {
  await supabase.from(COLS.users).update({
    status: "active",
    blocked_reason: null,
  }).eq("id", id);
  await logAudit("user_unbanned", "user", id, { entityName: entityName || null }, adminUser);
};

// ── Emergency contacts ────────────────────────────────────────────────────────
export const getEmergencyContacts = (uid, cb) => {
  if (!uid) {
    cb([]);
    return () => {};
  }
  const fetchAll = async () => {
    const { data } = await supabase
      .from("emergency_contacts")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: true });
    cb((data || []).map(camelize));
  };
  fetchAll();
  const channel = supabase
    .channel(`emergency_contacts:${uid}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "emergency_contacts", filter: `user_id=eq.${uid}` },
      fetchAll,
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};

export const lookupUserByPhone = async (phone) => {
  if (!phone) return null;
  const { data } = await supabase
    .from(COLS.users)
    .select("*")
    .eq("phone", phone)
    .limit(1);
  if (!data?.length) return null;
  return camelize({ uid: data[0].id, ...data[0] });
};

export const addEmergencyContact = async (uid, contact) => {
  if (!uid) throw new Error("uid required");
  const payload = {
    user_id: uid,
    name: contact.name || "",
    phone: contact.phone || "",
  };
  if (contact.linkedUid) {
    payload.linked_uid = contact.linkedUid;
    payload.linked_at = new Date().toISOString();
  }
  return supabase.from("emergency_contacts").insert(payload);
};

export const updateEmergencyContact = async (uid, contactId, contact) => {
  if (!uid || !contactId) throw new Error("uid and contactId required");
  const payload = {
    name: contact.name || "",
    phone: contact.phone || "",
  };
  if (contact.linkedUid !== undefined) {
    payload.linked_uid = contact.linkedUid || null;
    if (contact.linkedUid) payload.linked_at = new Date().toISOString();
  }
  return supabase.from("emergency_contacts").update(payload).eq("id", contactId).eq("user_id", uid);
};

export const deleteEmergencyContact = (uid, contactId) =>
  supabase.from("emergency_contacts").delete().eq("id", contactId).eq("user_id", uid);

// ── Service requests ──────────────────────────────────────────────────────────
export const getRequests = (cb) =>
  liveQuery({ table: COLS.requests, order: { col: "requested_at" }, limit: 50, cb });

export const updateRequestStatus = (id, status) =>
  supabase.from(COLS.requests).update({ status }).eq("id", id);

// ── SOS ───────────────────────────────────────────────────────────────────────
export const getSOS = (cb) =>
  liveQuery({ table: COLS.sos, order: { col: "created_at" }, limit: 200, cb });

export const resolveSOS = async (id, adminUser, entityName) => {
  await supabase.from(COLS.sos).update({
    resolved: true,
    resolved_at: new Date().toISOString(),
    resolved_by: adminUser?.email || adminUser?.uid || "admin",
  }).eq("id", id);
  await logAudit("sos_resolved", "sos", id, { entityName: entityName || null }, adminUser);
};

// ── Reviews ───────────────────────────────────────────────────────────────────
export const getReviews = (cb) =>
  liveQuery({ table: COLS.reviews, order: { col: "created_at" }, limit: 100, cb });

export const flagReview = (id) =>
  supabase.from(COLS.reviews).update({ status: "flagged" }).eq("id", id);
export const unflagReview = (id) =>
  supabase.from(COLS.reviews).update({ status: "visible" }).eq("id", id);
export const restoreReview = unflagReview;

export const removeReview = (id, adminUser) =>
  supabase.from(COLS.reviews).update({
    status: "deleted",
    deleted_at: new Date().toISOString(),
    deleted_by: adminUser?.uid || "unknown",
    deleted_by_email: adminUser?.email || null,
  }).eq("id", id);

export const restoreDeletedReview = (id) =>
  supabase.from(COLS.reviews).update({
    status: "visible",
    deleted_at: null,
    deleted_by: null,
    deleted_by_email: null,
  }).eq("id", id);

export const permanentlyDeleteReview = (id) =>
  supabase.from(COLS.reviews).delete().eq("id", id);

// ── Notifications ─────────────────────────────────────────────────────────────
export const getNotifications = (cb) => {
  const fetchAll = async () => {
    const { data } = await supabase
      .from(COLS.notifications)
      .select("*")
      .not("sent_at", "is", null)  // broadcast history only (has sentAt)
      .order("sent_at", { ascending: false })
      .limit(30);
    cb((data || []).map(camelize));
  };
  fetchAll();
  const channel = supabase
    .channel("notifications:admin")
    .on("postgres_changes", { event: "*", schema: "public", table: COLS.notifications }, fetchAll)
    .subscribe();
  return () => supabase.removeChannel(channel);
};

export const sendNotification = async ({ title, body, topic = "all", token, sentBy }) => {
  await supabase.from(COLS.notifications).insert({
    user_id: "",
    type: "broadcast",
    title,
    body,
    topic: token ? "single_device" : topic,
    target_token: token || null,
    sent_by: sentBy,
    sent_at: new Date().toISOString(),
    status_label: "sent",
    is_read: false,
  });

  let deliveryStatus = "queued";
  let deliveryError;
  try {
    const idToken = await getAuthToken(true);
    if (!idToken) throw new Error("not_signed_in");
    const res = await fetch("/api/fcm/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
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
    deliveryStatus = "failed";
    deliveryError = e.message || String(e);
  }
  return { saved: true, deliveryStatus, deliveryError };
};

export const sendNotificationToAudience = async ({ title, body, audience = "users", sentBy }) => {
  if (audience !== "users" && audience !== "vendors") {
    throw new Error(`Unknown audience: ${audience}`);
  }
  await supabase.from(COLS.notifications).insert({
    user_id: "",
    type: "broadcast",
    title,
    body,
    topic: `tokens:${audience}`,
    target_token: null,
    sent_by: sentBy,
    sent_at: new Date().toISOString(),
    status_label: "sent",
    is_read: false,
  });

  // Fetch FCM tokens filtered by role — vendors get vendor broadcasts, customers get customer broadcasts
  let q = supabase.from(COLS.users).select("fcm_token").eq("status", "active");
  if (audience === "vendors") q = q.eq("role", "vendor");
  else q = q.eq("role", "customer"); // "users" audience = customers only, not vendors/admins
  const { data: users } = await q;
  const tokenSet = new Set();
  (users || []).forEach((u) => {
    if (typeof u.fcm_token === "string" && u.fcm_token.length > 0) tokenSet.add(u.fcm_token);
  });
  const tokens = Array.from(tokenSet);
  if (tokens.length === 0) {
    return { saved: true, deliveryStatus: "no_tokens", sentTokens: 0, successCount: 0, failureCount: 0, failedTokens: [] };
  }

  const idToken = await getAuthToken(true);
  if (!idToken) {
    return { saved: true, deliveryStatus: "failed", sentTokens: tokens.length, successCount: 0, failureCount: tokens.length, failedTokens: [], deliveryError: "not_signed_in" };
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
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
      }
    } catch (e) {
      failureCount += chunk.length;
      deliveryError = e.message || String(e);
    }
  }
  return { saved: true, deliveryStatus: failureCount === 0 ? "delivered" : "partial", sentTokens: tokens.length, successCount, failureCount, failedTokens, deliveryError };
};

export const sendNotificationToUsers = async ({ title, body, uids, sentBy }) => {
  if (!Array.isArray(uids) || uids.length === 0) throw new Error("At least one recipient uid is required.");

  const perUserInserts = uids.map((uid) => ({
    user_id: uid,
    type: "targeted",
    title,
    body,
    is_read: false,
  }));
  await supabase.from(COLS.notifications).insert(perUserInserts);
  await supabase.from(COLS.notifications).insert({
    user_id: "",
    type: "broadcast",
    title,
    body,
    topic: `selected_users:${uids.length}`,
    target_token: null,
    sent_by: sentBy,
    sent_at: new Date().toISOString(),
    status_label: "sent",
    is_read: false,
  });

  // Collect FCM tokens in chunks of 30 (Supabase `in` limit)
  const tokenSet = new Set();
  const ID_CHUNK = 30;
  for (let i = 0; i < uids.length; i += ID_CHUNK) {
    const chunk = uids.slice(i, i + ID_CHUNK);
    const { data } = await supabase
      .from(COLS.users)
      .select("fcm_token")
      .in("id", chunk);
    (data || []).forEach((u) => {
      if (typeof u.fcm_token === "string" && u.fcm_token.length > 0) tokenSet.add(u.fcm_token);
    });
  }
  const tokens = Array.from(tokenSet);
  if (tokens.length === 0) {
    return { saved: true, recipients: uids.length, deliveryStatus: "no_tokens", sentTokens: 0, successCount: 0, failureCount: 0, failedTokens: [] };
  }

  const idToken = await getAuthToken(true);
  if (!idToken) {
    return { saved: true, recipients: uids.length, deliveryStatus: "failed", sentTokens: tokens.length, successCount: 0, failureCount: tokens.length, failedTokens: [], deliveryError: "not_signed_in" };
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
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
      }
    } catch (e) {
      failureCount += chunk.length;
      deliveryError = e.message || String(e);
    }
  }
  return { saved: true, recipients: uids.length, deliveryStatus: failureCount === 0 ? "delivered" : "partial", sentTokens: tokens.length, successCount, failureCount, failedTokens, deliveryError };
};

// ── Audit log ─────────────────────────────────────────────────────────────────
export const getAuditLog = (cb) => {
  const fetchAll = async () => {
    const { data } = await supabase
      .from(COLS.auditLog)
      .select("*")
      .order("timestamp", { ascending: false })
      .limit(50);
    cb((data || []).map(camelize));
  };
  fetchAll();
  const channel = supabase
    .channel("audit_log:admin")
    .on("postgres_changes", { event: "*", schema: "public", table: COLS.auditLog }, fetchAll)
    .subscribe();
  return () => supabase.removeChannel(channel);
};

// ── Admin users ───────────────────────────────────────────────────────────────
export const getAdminUsers = (cb) => {
  const fetchAll = async () => {
    const { data } = await supabase
      .from(COLS.users)
      .select("*")
      .in("role", ["admin", "superadmin", "manager", "support", "viewer"]);
    cb((data || []).map((row) => camelize({ id: row.id, uid: row.id, ...row })));
  };
  fetchAll();
  const channel = supabase
    .channel("admin_users:admin")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: COLS.users },
      fetchAll,
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};

export const updateAdminUser = (uid, data) =>
  supabase.from(COLS.users).update(toSnakeKeys(data)).eq("id", uid);

export const removeAdminUser = (uid) =>
  supabase.from(COLS.users).delete().eq("id", uid);

// ── Service zones ─────────────────────────────────────────────────────────────
export const getZones = (cb) =>
  liveQuery({ table: "service_zones", order: { col: "created_at" }, cb });

export const addZone = (data) =>
  supabase.from("service_zones").insert({
    name: data.name || "",
    coverage: data.coverage || "high",
    avg_response_mins: data.avgResponseMins || 0,
    vendor_count: data.vendorCount || 0,
  });

export const updateZone = (id, data) =>
  supabase.from("service_zones").update(toSnakeKeys(data)).eq("id", id);

export const deleteZone = (id) =>
  supabase.from("service_zones").delete().eq("id", id);

// ── App config ────────────────────────────────────────────────────────────────
export const getAppConfig = (cb) => {
  const fetchOne = async () => {
    const { data } = await supabase
      .from(COLS.appConfig)
      .select("data")
      .eq("id", "main")
      .single();
    cb(camelize(data?.data || {}));
  };
  fetchOne();
  const channel = supabase
    .channel("app_config:main")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: COLS.appConfig, filter: "id=eq.main" },
      fetchOne,
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};

export const saveAppConfig = async (data) => {
  const { data: existing } = await supabase
    .from(COLS.appConfig)
    .select("data")
    .eq("id", "main")
    .single();
  const merged = { ...(existing?.data || {}), ...toSnakeKeys(data) };
  return supabase.from(COLS.appConfig).upsert({
    id: "main",
    data: merged,
    updated_at: new Date().toISOString(),
  });
};

// ── Feature flags ─────────────────────────────────────────────────────────────
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

export const getFeatureFlags = (cb) => {
  const fetchFlags = async () => {
    const { data } = await supabase
      .from(COLS.appConfig)
      .select("data")
      .eq("id", "flags")
      .single();
    cb({ ...DEFAULT_FLAGS, ...(camelize(data?.data || {})) });
  };
  fetchFlags();
  const channel = supabase
    .channel("app_config:flags")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: COLS.appConfig, filter: "id=eq.flags" },
      fetchFlags,
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
};

export const saveFeatureFlags = async (flags) => {
  const { data: existing } = await supabase
    .from(COLS.appConfig)
    .select("data")
    .eq("id", "flags")
    .single();
  const merged = { ...(existing?.data || {}), ...flags };
  return supabase.from(COLS.appConfig).upsert({
    id: "flags",
    data: merged,
    updated_at: new Date().toISOString(),
  });
};

// ── File helpers (Cloudflare R2 via presigned PUT) ────────────────────────────
// These are unchanged — they hit /api/vendor-docs/* which is backend-agnostic.
// Only the ID token source changes (Supabase session vs Firebase ID token).
export const uploadFile = (file, applicationId, key, onProgress) =>
  new Promise(async (resolve, reject) => {
    try {
      const presignRes = await fetch("/api/vendor-docs/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId, key, contentType: file.type, size: file.size }),
      });
      if (!presignRes.ok) {
        const j = await presignRes.json().catch(() => ({}));
        throw new Error(j.error || `presign_failed (${presignRes.status})`);
      }
      const { uploadUrl, path } = await presignRes.json();
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadUrl);
      xhr.setRequestHeader("Content-Type", file.type);
      xhr.upload.onprogress = (e) => {
        if (onProgress && e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
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

export async function viewVendorDoc(path) {
  const token = await getAuthToken();
  if (!token) throw new Error("not_signed_in");
  const res = await fetch("/api/vendor-docs/view-url", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `view_url_failed (${res.status})`);
  }
  return (await res.json()).viewUrl;
}

export async function deleteVendorDoc(path) {
  const token = await getAuthToken();
  if (!token) throw new Error("not_signed_in");
  const res = await fetch("/api/vendor-docs/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `delete_failed (${res.status})`);
  }
}

// ── Firebase Messaging stubs (admin panel no longer needs them) ───────────────
// The admin panel sends pushes but doesn't receive them. These are no-ops.
export const onFCMMessage = () => () => {};
export const requestFCMToken = async () => null;
export const messaging = null;

// ── Vendor public registration ────────────────────────────────────────────────
// Self-registration now goes through a server-side endpoint (service-role key)
// because RLS does not allow unauthenticated direct inserts.
export const submitVendorApplication = async (data) => {
  const res = await fetch("/api/vendors/self-register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `registration_failed (${res.status})`);
  }
  return res.json();
};

// ── Admin: create a Supabase Auth account ────────────────────────────────────
export async function adminCreateAuthAccount({ email, password, name, phone, role = "customer" }) {
  const token = await getAuthToken();
  if (!token) throw new Error("not_signed_in");
  const res = await fetch("/api/users/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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

// ── Compatibility shims ───────────────────────────────────────────────────────
// serverTimestamp is used by older call sites that haven't been updated.
// Return an ISO string — close enough for display purposes.
export const serverTimestamp = () => new Date().toISOString();
export const Timestamp = {
  fromDate: (d) => ({ toDate: () => d }),
  now: () => ({ toDate: () => new Date() }),
};

// ── Internal: snake_case keys for writes ─────────────────────────────────────
function toSnake(s) {
  return s.replace(/([A-Z])/g, (c) => `_${c.toLowerCase()}`);
}
function toSnakeKeys(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return obj;
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[toSnake(k)] = v;
  return out;
}

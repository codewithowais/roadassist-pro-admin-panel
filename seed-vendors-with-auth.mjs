// Seeds verified vendors WITH login accounts so they can sign into the
// mobile app immediately. For each picked vendor it creates:
//   1. A Firebase Auth account (email + password)
//   2. A users/{uid} doc with role:'vendor' so the role gate routes
//      them to the vendor surface on first login
//   3. A vendors/{id} doc with authUid linked, status:'verified',
//      isVerified:true (so they appear in the customer-facing list
//      from minute one)
//
// Picks a sample (default 5 per category = 30 vendors) from the Dart
// source so we don't try to spin up 1,264 auth accounts. Tweak
// `PER_CATEGORY` to seed more / fewer.
//
// Run:
//   cd admin-panel
//   node --env-file=.env seed-vendors-with-auth.mjs
//
// Idempotent: re-running skips vendors whose vendors/{id} doc already
// exists. Pass --overwrite to refresh credentials. Failed auth creates
// (e.g. email-already-in-use) are reported but don't abort the run.

import fs from "node:fs";
import admin from "firebase-admin";

const DART_FILE =
  "/Users/codewithowais/Downloads/izma-alee/roadassist_pro/lib/features/vendors/data/verified_vendors_data.dart";

const OVERWRITE = process.argv.includes("--overwrite");
const PER_CATEGORY = 5;
const DEFAULT_PASSWORD = "Vendor@123";

function emailFor(category, city, slug) {
  const c = (city || "karachi").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const s = slug.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 28);
  return category.toLowerCase() + "-" + c + "-" + s + "@roadassist.test";
}

const SECTION_TO_CATEGORY = {
  towing: "Towing",
  fuel: "Fuel",
  tyre: "Tyre",
  mechanic: "Mechanic",
  battery: "Battery",
  accident: "Accident",
};

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing.");
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

function getString(line, key) {
  const re = new RegExp("['\"]" + key + "['\"]:\\s*(['\"])([\\s\\S]*?)\\1\\s*[,}]");
  const m = line.match(re);
  return m ? m[2] : null;
}
function getNumber(line, key) {
  const re = new RegExp("['\"]" + key + "['\"]:\\s*(-?[0-9]+(?:\\.[0-9]+)?)\\s*[,}]");
  const m = line.match(re);
  return m ? Number(m[1]) : null;
}
function parseEntries(body) {
  const entries = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    const id = getString(line, "id");
    const name = getString(line, "name");
    const lat = getNumber(line, "lat");
    const lng = getNumber(line, "lng");
    if (!id || !name || lat == null || lng == null) continue;
    entries.push({
      id, name, lat, lng,
      rating: getNumber(line, "rating") || 0,
      reviewCount: getNumber(line, "reviewCount") || 0,
      phone: getString(line, "phone") || "",
      whatsapp: getString(line, "whatsapp") || "",
      costRange: getString(line, "costRange") || "",
    });
  }
  return entries;
}
function extractSections(text) {
  const sections = {};
  const re = /static const List<Map<String, dynamic>> _(\w+) = \[([\s\S]*?)\];/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = m[1];
    if (!SECTION_TO_CATEGORY[key]) continue;
    sections[key] = parseEntries(m[2]);
  }
  return sections;
}

async function ensureAuthAccount(email, password, displayName) {
  try {
    const u = await admin.auth().getUserByEmail(email);
    return { uid: u.uid, created: false };
  } catch (e) {
    if (e.code !== "auth/user-not-found") throw e;
  }
  const u = await admin.auth().createUser({
    email,
    emailVerified: true,
    password,
    displayName,
    disabled: false,
  });
  return { uid: u.uid, created: true };
}

async function seedOne({ vendor, category, applicationId }) {
  const email = emailFor(category, "karachi", vendor.id);
  const businessName = vendor.name;
  const { uid, created } = await ensureAuthAccount(email, DEFAULT_PASSWORD, businessName);

  await admin.firestore().doc("users/" + uid).set({
    uid, email,
    phone: vendor.phone || "",
    name: businessName,
    role: "vendor",
    status: "active",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await admin.firestore().doc("vendors/" + vendor.id).set({
    applicationId,
    authUid: uid,
    businessName,
    ownerName: businessName,
    category,
    phone: vendor.phone || "",
    whatsapp: vendor.whatsapp || "",
    email,
    city: "Karachi",
    address: "",
    lat: vendor.lat,
    lng: vendor.lng,
    rating: vendor.rating || 0,
    reviewCount: vendor.reviewCount || 0,
    costRange: vendor.costRange || "",
    operatingHours: "9am – 9pm",
    kyc: "approved",
    status: "verified",
    isVerified: true,
    isOpen: true,
    verifiedAt: admin.firestore.FieldValue.serverTimestamp(),
    source: "seed",
    documents: { cnicPath: null, licensePath: null, photoPath: null },
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return { email, password: DEFAULT_PASSWORD, uid, created, businessName };
}

async function main() {
  initAdmin();
  const text = fs.readFileSync(DART_FILE, "utf8");
  const sections = extractSections(text);

  const credentials = [];
  const summary = { created: 0, alreadyExisted: 0, failed: 0 };

  for (const [sectionKey, category] of Object.entries(SECTION_TO_CATEGORY)) {
    const list = (sections[sectionKey] || []).slice(0, PER_CATEGORY);
    if (list.length === 0) continue;
    console.log("\n── " + category + " (" + list.length + " vendors) ──");
    for (const v of list) {
      const existing = await admin.firestore().doc("vendors/" + v.id).get();
      if (existing.exists && !OVERWRITE) {
        const data = existing.data() || {};
        console.log("  ↷  " + v.id + " already exists, skipping");
        if (data.email) {
          credentials.push({
            id: v.id, name: data.businessName || v.name, category,
            email: data.email, password: "(unchanged)", authUid: data.authUid || "",
          });
        }
        summary.alreadyExisted++;
        continue;
      }
      try {
        const r = await seedOne({ vendor: v, category, applicationId: "seed-" + v.id });
        credentials.push({
          id: v.id, name: r.businessName, category,
          email: r.email, password: r.password, authUid: r.uid,
        });
        const tag = r.created ? "✅" : "↷ ";
        console.log("  " + tag + " " + r.email + "  (uid: " + r.uid.slice(0, 8) + "…)  " + r.businessName);
        if (r.created) summary.created++; else summary.alreadyExisted++;
      } catch (e) {
        console.error("  ❌ " + v.id + " failed: " + (e.code || e.message));
        summary.failed++;
      }
    }
  }

  const csvLines = ["vendor_id,business_name,category,email,password,auth_uid"];
  for (const c of credentials) {
    const row = [c.id, c.name, c.category, c.email, c.password, c.authUid]
      .map((s) => '"' + (s || "").toString().replace(/"/g, '""') + '"')
      .join(",");
    csvLines.push(row);
  }
  const csvPath = "./seed-vendors-credentials.csv";
  fs.writeFileSync(csvPath, csvLines.join("\n"));

  console.log("\n" + "─".repeat(56));
  console.log("Created:         " + summary.created);
  console.log("Already existed: " + summary.alreadyExisted);
  console.log("Failed:          " + summary.failed);
  console.log("Credentials CSV: " + csvPath);
  console.log("Default password (rotate after first login): " + DEFAULT_PASSWORD);
  process.exit(0);
}

main().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});

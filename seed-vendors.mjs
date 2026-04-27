// One-time seeder: imports the verified vendor list from the Flutter
// project's Dart source into Firestore using the Firebase Admin SDK.
//
// Run:
//   cd admin-panel
//   node --env-file=.env seed-vendors.mjs
//
// Idempotent: skips any vendor whose doc already exists in Firestore.
// The Firestore doc id matches the Dart 'id' field (e.g. mock_tow_001) so
// re-running will not duplicate. To force re-import, pass --overwrite.

import fs from "node:fs";
import admin from "firebase-admin";

const DART_FILE =
  "/Users/codewithowais/Downloads/izma-alee/roadassist_pro/lib/features/vendors/data/verified_vendors_data.dart";

const OVERWRITE = process.argv.includes("--overwrite");
const DRY_RUN = process.argv.includes("--dry-run");

const SECTION_TO_CATEGORY = {
  towing: "Tow Truck",
  fuel: "Fuel Delivery",
  tyre: "Tyre Repair",
  mechanic: "Mechanic",
  battery: "Battery",
  accident: "Accident Recovery",
};

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw)
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT env var missing. Run with --env-file=.env",
    );
  const sa = JSON.parse(raw);
  admin.initializeApp({ credential: admin.credential.cert(sa) });
}

// ── Parser ──────────────────────────────────────────────────────────────
// Each section in the Dart file is declared as
//   static const List<Map<String, dynamic>> _<key> = [ {...}, {...}, ];
// Every entry is on its own line and uses Dart map syntax. Names sometimes
// contain apostrophes, in which case Dart uses double quotes for the
// surrounding string. We extract each field with a regex per known key,
// using a backreference so the matching close quote is detected correctly
// regardless of which quote style was used.

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

function getString(line, key) {
  const re = new RegExp(`['"]${key}['"]:\\s*(['"])([\\s\\S]*?)\\1\\s*[,}]`);
  const m = line.match(re);
  return m ? m[2] : null;
}

function getNumber(line, key) {
  const re = new RegExp(`['"]${key}['"]:\\s*(-?[0-9]+(?:\\.[0-9]+)?)\\s*[,}]`);
  const m = line.match(re);
  return m ? Number(m[1]) : null;
}

function parseEntries(body) {
  const entries = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{") || !line.includes("}")) continue;
    const id = getString(line, "id");
    const name = getString(line, "name");
    if (!id || !name) continue;
    entries.push({
      id,
      name,
      lat: getNumber(line, "lat"),
      lng: getNumber(line, "lng"),
      rating: getNumber(line, "rating"),
      reviewCount: getNumber(line, "reviewCount"),
      phone: getString(line, "phone") || "",
      whatsapp: getString(line, "whatsapp") || "",
      costRange: getString(line, "costRange") || "",
    });
  }
  return entries;
}

function toVendorDoc({ entry, sectionKey, FieldValue }) {
  return {
    name: entry.name,
    businessName: entry.name,
    category: SECTION_TO_CATEGORY[sectionKey],
    city: "Karachi",
    phone: entry.phone || null,
    whatsapp: entry.whatsapp || "",
    lat: typeof entry.lat === "number" ? entry.lat : null,
    lng: typeof entry.lng === "number" ? entry.lng : null,
    rating: typeof entry.rating === "number" ? entry.rating : 0,
    reviewCount:
      typeof entry.reviewCount === "number" ? entry.reviewCount : 0,
    costRange: entry.costRange || null,
    status: "verified",
    kyc: "approved",
    isVerified: true,
    isOpen: true,
    source: "seed",
    seedId: entry.id,
    documents: { cnicPath: null, licensePath: null, photoPath: null },
    deletedAt: null,
    createdAt: FieldValue.serverTimestamp(),
    verifiedAt: FieldValue.serverTimestamp(),
  };
}

async function main() {
  if (!fs.existsSync(DART_FILE)) {
    console.error("Dart file not found:", DART_FILE);
    process.exit(1);
  }
  initAdmin();
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  const text = fs.readFileSync(DART_FILE, "utf8");
  const sections = extractSections(text);

  let totalParsed = 0;
  for (const [k, arr] of Object.entries(sections)) {
    console.log(`  parsed ${String(arr.length).padStart(4)}  ${k}`);
    totalParsed += arr.length;
  }
  console.log(`Total parsed: ${totalParsed} vendors`);

  if (DRY_RUN) {
    console.log("\nDry run — no writes.");
    return;
  }

  let created = 0;
  let overwritten = 0;
  let skipped = 0;
  let failed = 0;

  for (const [sectionKey, entries] of Object.entries(sections)) {
    console.log(`\nWriting ${entries.length} ${sectionKey} vendors`);
    const CHUNK = 400;
    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const batch = db.batch();
      let pending = 0;
      for (const entry of chunk) {
        const ref = db.collection("vendors").doc(entry.id);
        if (!OVERWRITE) {
          const snap = await ref.get();
          if (snap.exists) {
            skipped++;
            continue;
          }
        }
        batch.set(ref, toVendorDoc({ entry, sectionKey, FieldValue }), {
          merge: false,
        });
        pending++;
      }
      if (pending > 0) {
        try {
          await batch.commit();
          if (OVERWRITE) overwritten += pending;
          else created += pending;
          process.stdout.write(`  committed ${pending} (offset ${i})\n`);
        } catch (e) {
          console.error(`  batch commit failed at offset ${i}:`, e.message);
          failed += pending;
        }
      }
    }
  }

  console.log("\n────────── Done ──────────");
  console.log(`  Created:     ${created}`);
  console.log(`  Overwritten: ${overwritten}`);
  console.log(`  Skipped:     ${skipped} (already existed; pass --overwrite to update)`);
  console.log(`  Failed:      ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nSeed failed:", e);
    process.exit(1);
  });

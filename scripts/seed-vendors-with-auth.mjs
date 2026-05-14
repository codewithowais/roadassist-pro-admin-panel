// Seeds verified vendors WITH Supabase Auth login accounts.
//
// Email format  : {category}-karachi-{seed_id}@roadassist.test
//                 e.g. fuel-karachi-mock_fuel_002@roadassist.test
// Password      : Vendor@123  (matches VENDOR_MASTER_PASSWORD in adminpanel.jsx)
//
// Usage:
//   node --env-file=.env scripts/seed-vendors-with-auth.mjs           # all vendors
//   node --env-file=.env scripts/seed-vendors-with-auth.mjs --limit=5 # 5 per category
//   node --env-file=.env scripts/seed-vendors-with-auth.mjs --overwrite
//   node --env-file=.env scripts/seed-vendors-with-auth.mjs --dry-run

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DART_FILE =
  "/Users/codewithowais/Downloads/izma-alee/roadassist_pro/lib/features/vendors/data/verified_vendors_data.dart";

const OVERWRITE   = process.argv.includes("--overwrite");
const DRY_RUN     = process.argv.includes("--dry-run");
const LIMIT_ARG   = process.argv.find((a) => a.startsWith("--limit="));
const PER_CATEGORY = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1]) : 99999;

// Must match VENDOR_MASTER_PASSWORD in adminpanel.jsx so the panel can show
// the correct credentials to the admin.
const SEED_PASSWORD = "Vendor@123";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SECTION_TO_CATEGORY = {
  towing:   "Towing",
  fuel:     "Fuel",
  tyre:     "Tyre",
  mechanic: "Mechanic",
  battery:  "Battery",
  accident: "Accident",
};

// ── Email generation — must match getSeedCredentials() in adminpanel.jsx ──────
// Format: {category.toLowerCase()}-karachi-{seed_id}@roadassist.test
function emailFor(sectionKey, seedId) {
  return `${sectionKey}-karachi-${seedId}@roadassist.test`;
}

// ── Dart parser ────────────────────────────────────────────────────────────────
function getString(line, key) {
  const re = new RegExp(`['"]${key}['"]:\\s*(['"])([\\s\\S]*?)\\1\\s*[,}]`);
  const m  = line.match(re);
  return m ? m[2] : null;
}
function getNumber(line, key) {
  const re = new RegExp(`['"]${key}['"]:\\s*(-?[0-9]+(?:\\.[0-9]+)?)\\s*[,}]`);
  const m  = line.match(re);
  return m ? Number(m[1]) : null;
}
function parseEntries(body) {
  const entries = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("{") || !line.includes("}")) continue;
    const id   = getString(line, "id");
    const name = getString(line, "name");
    if (!id || !name) continue;
    entries.push({
      id,
      name,
      lat:          getNumber(line, "lat"),
      lng:          getNumber(line, "lng"),
      rating:       getNumber(line, "rating"),
      review_count: getNumber(line, "reviewCount"),
      phone:        getString(line, "phone") || "",
    });
  }
  return entries;
}
function extractSections(text) {
  const sections = {};
  const pattern = /static const List<Map<String, dynamic>> _(\w+) = \[([\s\S]*?)\];/g;
  for (const m of text.matchAll(pattern)) {
    const key = m[1];
    if (SECTION_TO_CATEGORY[key]) sections[key] = parseEntries(m[2]);
  }
  return sections;
}

// ── Auth helpers ───────────────────────────────────────────────────────────────
// Returns existing user ID or creates a new one.  No expensive listUsers().
async function upsertAuthUser(email, name, phone) {
  // Try creating first (fast path for new vendors).
  const { data: created, error: createErr } =
    await supabase.auth.admin.createUser({
      email,
      password:       SEED_PASSWORD,
      email_confirm:  true,
      user_metadata:  { name, phone },
    });

  if (!createErr) return { uid: created.user.id, isNew: true };

  // Email already registered — fetch the existing user via the admin API.
  if (createErr.message?.includes("already been registered") ||
      createErr.message?.includes("already exists") ||
      createErr.code === "email_exists") {
    const { data: list } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    const existing = list?.users?.find((u) => u.email === email);
    if (existing) {
      if (OVERWRITE) {
        await supabase.auth.admin.updateUserById(existing.id, {
          password: SEED_PASSWORD,
          user_metadata: { name, phone },
        });
      }
      return { uid: existing.id, isNew: false };
    }
  }

  throw new Error(createErr.message);
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  if (!fs.existsSync(DART_FILE)) {
    console.error("Dart source not found:", DART_FILE);
    process.exit(1);
  }

  const sections = extractSections(fs.readFileSync(DART_FILE, "utf8"));
  let created = 0, existed = 0, failed = 0;

  for (const [sectionKey, allEntries] of Object.entries(sections)) {
    const category = SECTION_TO_CATEGORY[sectionKey];
    const entries  = allEntries.slice(0, PER_CATEGORY);
    console.log(`\n── ${category} (${entries.length} vendors) ──`);

    for (const entry of entries) {
      const email = emailFor(sectionKey, entry.id);

      if (DRY_RUN) {
        console.log(`  [dry] ${email}`);
        continue;
      }

      try {
        const { uid, isNew } = await upsertAuthUser(email, entry.name, entry.phone);

        // Upsert profile row.
        await supabase.from("profiles").upsert(
          {
            id:     uid,
            email,
            name:   entry.name,
            phone:  entry.phone || "",
            role:   "vendor",
            status: "active",
          },
          { onConflict: "id" }
        );

        // Upsert vendor row — onConflict on seed_id so re-runs are idempotent.
        const { error: vendorErr } = await supabase.from("vendors").upsert(
          {
            auth_uid:     uid,
            name:         entry.name,
            business_name: entry.name,
            category,
            city:         "Karachi",
            phone:        entry.phone || "",
            lat:          typeof entry.lat         === "number" ? entry.lat         : 0,
            lng:          typeof entry.lng         === "number" ? entry.lng         : 0,
            rating:       typeof entry.rating      === "number" ? entry.rating      : 0,
            review_count: typeof entry.review_count=== "number" ? entry.review_count: 0,
            status:       "verified",
            kyc:          "approved",
            is_verified:  true,
            is_open:      true,
            source:       "seed",
            seed_id:      entry.id,
            verified_at:  new Date().toISOString(),
          },
          { onConflict: "seed_id" }
        );

        if (vendorErr) throw new Error("vendor upsert: " + vendorErr.message);

        const tag = isNew ? "✅ created" : (OVERWRITE ? "♻  updated" : "↷  existed");
        console.log(`  ${tag}  ${email}`);
        if (isNew) created++; else existed++;
      } catch (e) {
        console.error(`  ❌ ${entry.id}: ${e.message}`);
        failed++;
      }
    }
  }

  console.log("\n" + "─".repeat(60));
  console.log(`Created:  ${created}`);
  console.log(`Existed:  ${existed}`);
  console.log(`Failed:   ${failed}`);
  console.log(`\nVendor login password: ${SEED_PASSWORD}`);
  console.log("Email format: {category}-karachi-{seed_id}@roadassist.test");
}

main()
  .then(() => process.exit(0))
  .catch((e) => { console.error("\nFatal:", e); process.exit(1); });

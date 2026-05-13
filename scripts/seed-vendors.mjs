// One-time seeder: imports the verified vendor list from the Flutter
// project's Dart source into Supabase Postgres.
//
// Run:
//   cd admin-panel
//   node --env-file=.env scripts/seed-vendors.mjs
//   node --env-file=.env scripts/seed-vendors.mjs --overwrite   # re-import
//   node --env-file=.env scripts/seed-vendors.mjs --dry-run     # preview only
//
// Idempotent: uses seed_id as the upsert key so re-running won't duplicate.

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DART_FILE =
  "/Users/codewithowais/Downloads/izma-alee/roadassist_pro/lib/features/vendors/data/verified_vendors_data.dart";

const OVERWRITE = process.argv.includes("--overwrite");
const DRY_RUN = process.argv.includes("--dry-run");

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SECTION_TO_CATEGORY = {
  towing: "Towing",
  fuel: "Fuel",
  tyre: "Tyre",
  mechanic: "Mechanic",
  battery: "Battery",
  accident: "Accident",
};

// ── Dart source parser ────────────────────────────────────────────────────────

function extractSections(text) {
  const sections = {};
  // Match: static const List<Map<String, dynamic>> _<key> = [ ... ];
  const pattern =
    /static const List<Map<String, dynamic>> _(\w+) = \[([\s\S]*?)\];/g;
  const allMatches = [...text.matchAll(pattern)];
  for (const m of allMatches) {
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
  const re = new RegExp(
    `['"]${key}['"]:\\s*(-?[0-9]+(?:\\.[0-9]+)?)\\s*[,}]`,
  );
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
      review_count: getNumber(line, "reviewCount"),
      phone: getString(line, "phone") || "",
      whatsapp: getString(line, "whatsapp") || "",
      cost_range: getString(line, "costRange") || "",
    });
  }
  return entries;
}

function toVendorRow(entry, sectionKey) {
  return {
    name: entry.name,
    business_name: entry.name,
    category: SECTION_TO_CATEGORY[sectionKey],
    city: "Karachi",
    phone: entry.phone || "",
    whatsapp: entry.whatsapp || "",
    lat: typeof entry.lat === "number" ? entry.lat : 0,
    lng: typeof entry.lng === "number" ? entry.lng : 0,
    rating: typeof entry.rating === "number" ? entry.rating : 0,
    review_count:
      typeof entry.review_count === "number" ? entry.review_count : 0,
    cost_range: entry.cost_range || null,
    status: "verified",
    kyc: "approved",
    is_verified: true,
    is_open: true,
    source: "seed",
    seed_id: entry.id,
    documents: { cnic_path: null, license_path: null, photo_path: null },
    deleted_at: null,
    verified_at: new Date().toISOString(),
  };
}

async function main() {
  if (!fs.existsSync(DART_FILE)) {
    console.error("Dart file not found:", DART_FILE);
    process.exit(1);
  }

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
    console.log(`\nWriting ${entries.length} ${sectionKey} vendors...`);
    const CHUNK = 200;

    for (let i = 0; i < entries.length; i += CHUNK) {
      const chunk = entries.slice(i, i + CHUNK);
      const rows = chunk.map((e) => toVendorRow(e, sectionKey));

      if (OVERWRITE) {
        const { error } = await supabase
          .from("vendors")
          .upsert(rows, { onConflict: "seed_id", ignoreDuplicates: false });
        if (error) {
          console.error(`  upsert failed at offset ${i}:`, error.message);
          failed += chunk.length;
        } else {
          overwritten += chunk.length;
          process.stdout.write(`  upserted ${chunk.length} (offset ${i})\n`);
        }
      } else {
        const seedIds = chunk.map((e) => e.id);
        const { data: existing } = await supabase
          .from("vendors")
          .select("seed_id")
          .in("seed_id", seedIds);
        const existingIds = new Set((existing || []).map((r) => r.seed_id));
        const newRows = rows.filter((r) => !existingIds.has(r.seed_id));
        skipped += rows.length - newRows.length;

        if (newRows.length > 0) {
          const { error } = await supabase.from("vendors").insert(newRows);
          if (error) {
            console.error(`  insert failed at offset ${i}:`, error.message);
            failed += newRows.length;
          } else {
            created += newRows.length;
            process.stdout.write(
              `  inserted ${newRows.length} (offset ${i})\n`,
            );
          }
        }
      }
    }
  }

  console.log("\n-- Done --");
  console.log(`  Created:     ${created}`);
  console.log(`  Overwritten: ${overwritten}`);
  console.log(
    `  Skipped:     ${skipped} (already existed; pass --overwrite to update)`,
  );
  console.log(`  Failed:      ${failed}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nSeed failed:", e);
    process.exit(1);
  });

// Seeds VERIFIED vendors WITH login accounts (Supabase Auth + profiles + vendors rows).
// Per-category sampling (default 5, override with --limit=N).
//   node --env-file=.env scripts/seed-vendors-with-auth.mjs
//   node --env-file=.env scripts/seed-vendors-with-auth.mjs --limit=10 --overwrite

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DART_FILE =
  "/Users/codewithowais/Downloads/izma-alee/roadassist_pro/lib/features/vendors/data/verified_vendors_data.dart";

const OVERWRITE = process.argv.includes("--overwrite");
const DRY_RUN = process.argv.includes("--dry-run");
const LIMIT_ARG = process.argv.find((a) => a.startsWith("--limit="));
const PER_CATEGORY_LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split("=")[1]) : 5;

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const SEED_PASSWORD = process.env.SEED_VENDOR_PASSWORD || "Vendor@12345!";

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

function extractSections(text) {
  const sections = {};
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
    });
  }
  return entries;
}

function toEmail(sectionKey, name) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 30);
  return `${sectionKey}-karachi-${slug}@roadassist.test`;
}

async function main() {
  if (!fs.existsSync(DART_FILE)) {
    console.error("Dart file not found:", DART_FILE);
    process.exit(1);
  }

  const text = fs.readFileSync(DART_FILE, "utf8");
  const sections = extractSections(text);
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const [sectionKey, allEntries] of Object.entries(sections)) {
    const entries = allEntries.slice(0, PER_CATEGORY_LIMIT);
    console.log(`\n${SECTION_TO_CATEGORY[sectionKey]}: ${entries.length} vendors`);

    for (const entry of entries) {
      const email = toEmail(sectionKey, entry.name);

      if (DRY_RUN) {
        console.log(`  [dry] ${email}`);
        continue;
      }

      const { data: listData } = await supabase.auth.admin.listUsers();
      const existing = listData?.users?.find((u) => u.email === email);

      let authUid;
      if (existing && !OVERWRITE) {
        console.log(`  skip  ${email}`);
        skipped++;
        continue;
      }

      if (existing && OVERWRITE) {
        authUid = existing.id;
        await supabase.auth.admin.updateUserById(authUid, {
          password: SEED_PASSWORD,
          user_metadata: { name: entry.name, phone: entry.phone },
        });
      } else {
        const { data, error } = await supabase.auth.admin.createUser({
          email,
          password: SEED_PASSWORD,
          email_confirm: true,
          user_metadata: { name: entry.name, phone: entry.phone },
        });
        if (error) {
          console.error(`  auth create failed: ${error.message}`);
          failed++;
          continue;
        }
        authUid = data.user.id;
      }

      await supabase.from("profiles").upsert({
        id: authUid,
        email,
        name: entry.name,
        phone: entry.phone || "",
        role: "vendor",
        status: "active",
      });

      const { error: vendorError } = await supabase.from("vendors").upsert(
        {
          auth_uid: authUid,
          name: entry.name,
          business_name: entry.name,
          category: SECTION_TO_CATEGORY[sectionKey],
          city: "Karachi",
          phone: entry.phone || "",
          lat: typeof entry.lat === "number" ? entry.lat : 0,
          lng: typeof entry.lng === "number" ? entry.lng : 0,
          rating: typeof entry.rating === "number" ? entry.rating : 0,
          review_count:
            typeof entry.review_count === "number" ? entry.review_count : 0,
          status: "verified",
          kyc: "approved",
          is_verified: true,
          is_open: true,
          source: "seed",
          seed_id: entry.id,
          verified_at: new Date().toISOString(),
        },
        { onConflict: "seed_id" },
      );

      if (vendorError) {
        console.error(`  vendor upsert failed: ${vendorError.message}`);
        failed++;
        continue;
      }

      console.log(`  ok  ${email}`);
      created++;
    }
  }

  console.log("\n-- Done --");
  console.log(`  Created/updated: ${created}`);
  console.log(`  Skipped:         ${skipped}`);
  console.log(`  Failed:          ${failed}`);
  console.log(`\nLogin password for seeded vendors: ${SEED_PASSWORD}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nSeed failed:", e);
    process.exit(1);
  });

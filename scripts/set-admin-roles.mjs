// Stamps app_metadata.role and app_metadata.admin onto every admin user.
// Mirrors set-admin-claims.mjs but for Supabase.
// Run after adding/editing admin rows in the profiles table.
//   node --env-file=.env scripts/set-admin-roles.mjs
//
// Admins must sign out + sign back in for new JWT to include updated metadata.

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Fetch all profiles with an admin-tier role
const { data: adminProfiles, error: dbError } = await supabase
  .from("profiles")
  .select("id, email, role")
  .in("role", ["admin", "superadmin", "manager", "support", "viewer"]);

if (dbError) {
  console.error("❌ Could not fetch admin profiles:", dbError.message);
  process.exit(1);
}

if (!adminProfiles || adminProfiles.length === 0) {
  console.log("ℹ️  No admin profiles found. Nothing to do.");
  process.exit(0);
}

console.log(`Found ${adminProfiles.length} admin profile(s). Stamping metadata...`);

let success = 0;
let failed = 0;

for (const profile of adminProfiles) {
  const isAdmin = ["admin", "superadmin", "manager"].includes(profile.role);
  const { error } = await supabase.auth.admin.updateUserById(profile.id, {
    app_metadata: {
      admin: isAdmin,
      role: profile.role,
      disabled: false,
    },
  });
  if (error) {
    console.error(`  ❌ ${profile.email}: ${error.message}`);
    failed++;
  } else {
    console.log(`  ✅ ${profile.email} → admin=${isAdmin}, role=${profile.role}`);
    success++;
  }
}

console.log(`\nDone: ${success} updated, ${failed} failed.`);
if (success > 0) {
  console.log(
    "⚠️  Affected admins must sign out and sign back in for their JWT to reflect the new role.\n",
  );
}
process.exit(failed > 0 ? 1 : 0);

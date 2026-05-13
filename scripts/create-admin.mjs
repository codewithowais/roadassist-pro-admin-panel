// Bootstrap or repair the admin user. Safe to re-run.
//   cd admin-panel
//   node --env-file=.env scripts/create-admin.mjs
//
// - Creates the Supabase Auth user if missing.
// - Stamps app_metadata: { admin: true, role: 'superadmin', disabled: false }
// - profiles row is created automatically by the mirror_auth_to_profile trigger.
// - Idempotent: if the email exists, just patches app_metadata.

import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_EMAIL, ADMIN_PASSWORD } =
  process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error(
    "❌ Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run: node --env-file=.env scripts/create-admin.mjs",
  );
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("❌ Set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Check if the user already exists
const { data: listData, error: listError } =
  await supabase.auth.admin.listUsers();
if (listError) {
  console.error("❌ Could not list users:", listError.message);
  process.exit(1);
}

const existing = listData?.users?.find((u) => u.email === ADMIN_EMAIL);

if (existing) {
  console.log("ℹ️  User exists; patching app_metadata...");
  const { error } = await supabase.auth.admin.updateUserById(existing.id, {
    app_metadata: { admin: true, role: "superadmin", disabled: false },
  });
  if (error) {
    console.error("❌ Could not patch metadata:", error.message);
    process.exit(1);
  }
  console.log("✅ app_metadata patched. uid:", existing.id);

  // Patch profiles.role as well
  await supabase
    .from("profiles")
    .update({ role: "admin" })
    .eq("id", existing.id);
  console.log("✅ profiles.role = admin");
} else {
  const { data, error } = await supabase.auth.admin.createUser({
    email: ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    email_confirm: true,
    app_metadata: { admin: true, role: "superadmin", disabled: false },
    user_metadata: { name: "Super Admin" },
  });
  if (error) {
    console.error("❌ Could not create user:", error.message);
    process.exit(1);
  }
  console.log("✅ Created admin user:", data.user.email, "uid:", data.user.id);

  // Upsert profiles row (trigger should have created it, but guard anyway)
  await supabase.from("profiles").upsert({
    id: data.user.id,
    email: ADMIN_EMAIL,
    name: "Super Admin",
    role: "admin",
    status: "active",
  });
  console.log("✅ profiles row upserted");
}

console.log(
  "\nAdmin ready. Sign in at http://localhost:5173 with:",
  ADMIN_EMAIL,
);
console.log(
  "JWT will contain app_metadata.admin=true after first sign-in.\n",
);
process.exit(0);

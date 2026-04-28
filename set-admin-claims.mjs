// Stamps Firebase Auth custom claims onto every admin so that
// `verifyIdToken` and Firestore security rules can identify admins WITHOUT
// reading admin_users/{uid}. Eliminates a Firestore read per admin API call
// AND per rule evaluation — the single biggest free-tier read drain.
//
// Run once after the verifyAdmin / firestore.rules patches deploy:
//   node --env-file=.env set-admin-claims.mjs
//
// Re-run anytime an admin's role changes — claims override prior claims.
//
// Required env vars (already set for the Vercel API):
//   FIREBASE_SERVICE_ACCOUNT — full service-account JSON (one-line stringified)
//
// IMPORTANT: every existing admin must sign out and sign back in (or call
// auth.currentUser.getIdToken(true)) AFTER this script runs — otherwise
// their cached ID token still lacks the claim and they'll fall back to the
// Firestore-read path until the token expires (~1h).

import admin from "firebase-admin";

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error(
    "❌ FIREBASE_SERVICE_ACCOUNT missing. Either pull it from Vercel:\n" +
      "     vercel env pull .env\n" +
      "   then re-run with `node --env-file=.env set-admin-claims.mjs`",
  );
  process.exit(1);
}

let sa;
try {
  sa = JSON.parse(raw);
} catch (e) {
  console.error("❌ FIREBASE_SERVICE_ACCOUNT is not valid JSON:", e.message);
  process.exit(1);
}

admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const auth = admin.auth();

const snap = await db.collection("admin_users").get();
if (snap.empty) {
  console.log("ℹ️  admin_users collection is empty — nothing to do.");
  process.exit(0);
}

console.log(`Found ${snap.size} admin_users doc(s). Stamping claims...\n`);

let ok = 0;
let failed = 0;
for (const docSnap of snap.docs) {
  const uid = docSnap.id;
  const data = docSnap.data() || {};
  const role = data.role || "manager";
  const disabled = data.disabled === true;
  // `admin: true` is the cheap rule check. `role` carries fine-grained
  // permissions so we can drop the second admin_users read in invite.js.
  // `disabled: true` lets us short-circuit access for offboarded admins
  // without deleting the doc.
  const claims = { admin: !disabled, role, disabled };
  try {
    await auth.setCustomUserClaims(uid, claims);
    console.log(`  ✅ ${uid}  role=${role}${disabled ? " (disabled)" : ""}`);
    ok++;
  } catch (e) {
    console.error(`  ❌ ${uid}  ${e.code || ""} ${e.message}`);
    failed++;
  }
}

console.log(`\nDone. ${ok} succeeded, ${failed} failed.`);
console.log(
  "\n⚠️  Every admin must sign out and sign back in for the new claim to\n" +
    "   appear in their ID token. Until they do, they'll keep paying for\n" +
    "   one Firestore read per API call (graceful fallback).",
);
process.exit(failed === 0 ? 0 : 1);

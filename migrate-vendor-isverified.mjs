// One-off migration: backfill `isVerified: true` on vendors whose KYC was
// approved BEFORE the approveKYC() fix that started writing isVerified.
//
// Without isVerified, the mobile app's
//   where('category', '==', X).where('isVerified', '==', true)
// filter hides these vendors from customers — even though their kyc/status
// say they should be visible.
//
// Match rule: any vendor with kyc == "approved" AND isVerified != true.
// (Catches both `false` and missing-field cases.)
//
// Usage:
//   cd admin-panel
//   node --env-file=.env migrate-vendor-isverified.mjs           # dry run (default)
//   node --env-file=.env migrate-vendor-isverified.mjs --live    # actually write
//
// Idempotent: skips docs already at isVerified == true.

import admin from "firebase-admin";

const LIVE = process.argv.includes("--live");

function initAdmin() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw)
    throw new Error(
      "FIREBASE_SERVICE_ACCOUNT env var missing. Run with --env-file=.env",
    );
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  console.log(LIVE ? "── LIVE MODE ──" : "── DRY RUN (no writes) ──");
  console.log('Scanning vendors with kyc == "approved"…');

  // Firestore doesn't support `!=` against booleans plus another `==` filter
  // on the same query without a composite index, and missing-field semantics
  // are awkward. So: fetch all approved, filter client-side. Vendor counts
  // are small (hundreds, not millions) so this is fine.
  const snap = await db
    .collection("vendors")
    .where("kyc", "==", "approved")
    .get();

  const stale = [];
  let alreadyTrue = 0;
  snap.forEach((d) => {
    const v = d.data();
    if (v.isVerified === true) {
      alreadyTrue++;
    } else {
      stale.push({
        ref: d.ref,
        id: d.id,
        name: v.name || v.businessName || "(unnamed)",
        source: v.source || "(unknown)",
        currentValue:
          v.isVerified === undefined ? "<missing>" : JSON.stringify(v.isVerified),
        hasVerifiedAt: !!v.verifiedAt,
      });
    }
  });

  console.log(`\nApproved vendors total:            ${snap.size}`);
  console.log(`  already isVerified == true:       ${alreadyTrue}`);
  console.log(`  needs backfill (target of script): ${stale.length}`);

  if (stale.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  if (!LIVE) {
    console.log("\nSample (first 10):");
    stale.slice(0, 10).forEach((u) => {
      console.log(
        `  ${u.id.padEnd(24)} ${u.source.padEnd(20)} isVerified=${u.currentValue.padEnd(12)} ${u.name}`,
      );
    });
    console.log("\nDry run only. Re-run with --live to commit.");
    return;
  }

  console.log(`\nWriting ${stale.length} updates in batches of 400…`);
  let written = 0;
  const CHUNK = 400;
  for (let i = 0; i < stale.length; i += CHUNK) {
    const chunk = stale.slice(i, i + CHUNK);
    const batch = db.batch();
    chunk.forEach((u) => {
      // Also set status/verifiedAt where missing, so the doc is internally
      // consistent (kyc=approved, status=verified, isVerified=true).
      const update = {
        isVerified: true,
        status: "verified",
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (!u.hasVerifiedAt) update.verifiedAt = FieldValue.serverTimestamp();
      batch.update(u.ref, update);
    });
    await batch.commit();
    written += chunk.length;
    process.stdout.write(`  committed ${written}/${stale.length}\n`);
  }
  console.log(`\n✓ Backfilled isVerified on ${written} vendor docs.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nMigration failed:", e);
    process.exit(1);
  });

// One-off migration: rename stale vendor.category values to the canonical enum
// defined in SCHEMA.md. The mobile app filters vendors by exact category match,
// so any doc still using the old display labels is invisible to customers.
//
// Stale → Canonical:
//   "Fuel Delivery"     → "Fuel"
//   "Tyre Repair"       → "Tyre"
//   "Tow Truck"         → "Towing"
//   "Accident Recovery" → "Accident"
//
// Usage:
//   cd admin-panel
//   node --env-file=.env migrate-vendor-categories.mjs           # dry run (default)
//   node --env-file=.env migrate-vendor-categories.mjs --live    # actually write
//
// Idempotent: re-running on already-canonical docs is a no-op.

import admin from "firebase-admin";

const LIVE = process.argv.includes("--live");

const RENAMES = {
  "Fuel Delivery": "Fuel",
  "Tyre Repair": "Tyre",
  "Tow Truck": "Towing",
  "Accident Recovery": "Accident",
};

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
  console.log("Scanning vendors…");

  const counts = {};
  let totalAffected = 0;
  const updates = []; // { ref, from, to, name }

  for (const [stale, canonical] of Object.entries(RENAMES)) {
    const snap = await db
      .collection("vendors")
      .where("category", "==", stale)
      .get();
    counts[stale] = snap.size;
    totalAffected += snap.size;
    snap.forEach((d) => {
      updates.push({
        ref: d.ref,
        from: stale,
        to: canonical,
        name: d.data().name || d.data().businessName || "(unnamed)",
        source: d.data().source || "(unknown)",
      });
    });
  }

  console.log("\nMatched docs by stale category:");
  for (const [stale, count] of Object.entries(counts)) {
    console.log(`  ${stale.padEnd(20)} → ${RENAMES[stale].padEnd(10)} ${count}`);
  }
  console.log(`  ${"TOTAL".padEnd(20)}   ${"".padEnd(10)} ${totalAffected}`);

  if (totalAffected === 0) {
    console.log("\nNothing to do — already canonical.");
    return;
  }

  if (!LIVE) {
    console.log("\nSample (first 10):");
    updates.slice(0, 10).forEach((u) => {
      console.log(
        `  ${u.from.padEnd(20)} → ${u.to.padEnd(10)} ${u.source.padEnd(20)} ${u.name}`,
      );
    });
    console.log("\nDry run only. Re-run with --live to commit.");
    return;
  }

  console.log(`\nWriting ${totalAffected} updates in batches of 400…`);
  let written = 0;
  const CHUNK = 400;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const batch = db.batch();
    chunk.forEach((u) => {
      batch.update(u.ref, {
        category: u.to,
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    written += chunk.length;
    process.stdout.write(`  committed ${written}/${updates.length}\n`);
  }
  console.log(`\n✓ Updated ${written} vendor docs.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nMigration failed:", e);
    process.exit(1);
  });

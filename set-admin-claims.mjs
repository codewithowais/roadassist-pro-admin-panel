// Stamps Firebase Auth custom claims onto every admin so that
// `verifyIdToken` and Firestore security rules can identify admins WITHOUT
// reading admin_users/{uid}. Eliminates a Firestore read per admin API call
// AND per rule evaluation — the single biggest free-tier read drain.
//
// Run once after the verifyAdmin / firestore.rules patches deploy:
//   node set-admin-claims.mjs
//
// Re-run anytime an admin's role changes — claims override prior claims.
//
// Required env vars (already set for the Vercel API):
//   FIREBASE_SERVICE_ACCOUNT — full service-account JSON (one-line stringified)
//   ADMIN_EMAIL              — bootstrap admin email (used when Firestore is
//                               quota-blocked or admin_users is empty)
//
// Optional:
//   ADMIN_EMAILS=a@x,b@y     — comma-separated, overrides ADMIN_EMAIL
//
// The script auto-loads `./.env` if present so it works on Node 16/18/20+
// without needing `--env-file=` (Node 20+) or the `dotenv` package.
//
// Why this script avoids firebase-admin: firebase-admin v13 needs Fetch API
// globals (Node 18+), v11 needs the @google-cloud/firestore peer dep. To
// keep this script portable across whatever Node version is sitting on
// dev / CI machines, we drive Firebase Identity Toolkit + IAM REST APIs
// directly via google-auth-library (already a transitive dependency).
//
// IMPORTANT: every existing admin must sign out and sign back in (or call
// auth.currentUser.getIdToken(true)) AFTER this script runs — otherwise
// their cached ID token still lacks the claim and they'll fall back to the
// Firestore-read path until the token expires (~1h).

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { GoogleAuth } from "google-auth-library";

// ── Tiny .env loader (no dotenv dep) ────────────────────────────────
function loadDotenv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key] !== undefined) continue;
    let val = rawVal;
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}
loadDotenv(path.join(process.cwd(), ".env"));

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) {
  console.error(
    "❌ FIREBASE_SERVICE_ACCOUNT missing from .env. Pull it from Vercel:\n" +
      "     vercel env pull .env",
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

const PROJECT_ID = sa.project_id;
if (!PROJECT_ID) {
  console.error("❌ Service account JSON is missing project_id.");
  process.exit(1);
}

// ── OAuth2 token via service-account JWT ────────────────────────────
const auth = new GoogleAuth({
  credentials: sa,
  scopes: [
    "https://www.googleapis.com/auth/cloud-platform",
    "https://www.googleapis.com/auth/datastore",
    "https://www.googleapis.com/auth/firebase",
  ],
});
const client = await auth.getClient();

// ── Minimal HTTPS POST helper ───────────────────────────────────────
async function postJson(url, body) {
  const token = (await client.getAccessToken()).token;
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      {
        method: "POST",
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          let parsed = {};
          try {
            parsed = buf ? JSON.parse(buf) : {};
          } catch {
            parsed = { _raw: buf };
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const err = new Error(
              `${res.statusCode} ${parsed?.error?.message || buf}`,
            );
            err.status = res.statusCode;
            err.body = parsed;
            reject(err);
          }
        });
      },
    );
    req.on("error", reject);
    req.write(JSON.stringify(body));
    req.end();
  });
}

// Identity Toolkit base — supports projects.accounts:lookup and
// projects.accounts:update for stamping customAttributes.
const IT_BASE = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}`;

async function lookupByEmail(email) {
  const r = await postJson(`${IT_BASE}/accounts:lookup`, { email: [email] });
  return r.users?.[0] || null;
}

async function setCustomClaims(uid, claims) {
  // customAttributes is a JSON-stringified blob; max 1000 bytes.
  await postJson(`${IT_BASE}/accounts:update`, {
    localId: uid,
    customAttributes: JSON.stringify(claims),
  });
}

// ── Firestore REST: list admin_users (preferred path) ───────────────
async function listAdminUsers() {
  const token = (await client.getAccessToken()).token;
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/admin_users?pageSize=300`;
  return new Promise((resolve, reject) => {
    https
      .get(
        url,
        { headers: { Authorization: `Bearer ${token}` } },
        (res) => {
          let buf = "";
          res.on("data", (c) => (buf += c));
          res.on("end", () => {
            let parsed = {};
            try {
              parsed = buf ? JSON.parse(buf) : {};
            } catch {
              parsed = {};
            }
            if (res.statusCode >= 200 && res.statusCode < 300) {
              const docs = parsed.documents || [];
              resolve(
                docs.map((d) => {
                  const uid = d.name.split("/").pop();
                  const f = d.fields || {};
                  return {
                    uid,
                    role: f.role?.stringValue || "manager",
                    disabled: f.disabled?.booleanValue === true,
                    source: "firestore",
                  };
                }),
              );
            } else {
              const err = new Error(
                `${res.statusCode} ${parsed?.error?.message || buf}`,
              );
              err.status = res.statusCode;
              // Firestore quota error code 8 surfaces as HTTP 429 over REST,
              // sometimes 503 too — both should trigger the email fallback.
              err.quotaExhausted =
                res.statusCode === 429 ||
                /RESOURCE_EXHAUSTED|Quota/i.test(
                  parsed?.error?.status || parsed?.error?.message || "",
                );
              reject(err);
            }
          });
        },
      )
      .on("error", reject);
  });
}

async function loadFromEnvEmails() {
  const list = (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (list.length === 0) {
    throw new Error(
      "No fallback emails. Set ADMIN_EMAIL or ADMIN_EMAILS=a@x,b@y in .env",
    );
  }
  const out = [];
  for (const email of list) {
    try {
      const u = await lookupByEmail(email);
      if (u) {
        out.push({
          uid: u.localId,
          role: "superadmin",
          disabled: false,
          source: `email(${email})`,
        });
      } else {
        console.warn(`  ⚠️  no Firebase Auth user found for ${email}`);
      }
    } catch (e) {
      console.warn(`  ⚠️  could not resolve ${email}: ${e.message}`);
    }
  }
  return out;
}

// ── Main ────────────────────────────────────────────────────────────
let admins;
try {
  admins = await listAdminUsers();
  if (admins.length === 0) {
    console.log("ℹ️  admin_users collection is empty — falling back to env.");
    admins = await loadFromEnvEmails();
  }
} catch (e) {
  if (e.quotaExhausted) {
    console.warn(
      "⚠️  Firestore quota exhausted. Falling back to ADMIN_EMAIL(S) from .env.\n" +
        "   This is fine — once the claim is set, future verifyAdmin calls\n" +
        "   skip Firestore entirely, and tomorrow's quota reset solves the rest.\n",
    );
    admins = await loadFromEnvEmails();
  } else {
    console.error("❌ Firestore list failed:", e.message);
    console.error("   Falling back to ADMIN_EMAIL(S) from .env...\n");
    admins = await loadFromEnvEmails();
  }
}

if (admins.length === 0) {
  console.log("ℹ️  Nothing to do.");
  process.exit(0);
}

console.log(`Found ${admins.length} admin(s). Stamping claims...\n`);

let ok = 0;
let failed = 0;
for (const a of admins) {
  const claims = { admin: !a.disabled, role: a.role, disabled: a.disabled };
  try {
    await setCustomClaims(a.uid, claims);
    console.log(
      `  ✅ ${a.uid}  role=${a.role}${a.disabled ? " (disabled)" : ""}  [${a.source}]`,
    );
    ok++;
  } catch (e) {
    console.error(`  ❌ ${a.uid}  ${e.message}`);
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

// Bootstrap or repair the admin user. Safe to re-run.
//   node --env-file=.env create-admin.mjs
//
// - Creates the Firebase Auth user if missing.
// - Creates the admin_users/<uid> Firestore doc if missing.
// - Does nothing if both already exist for this email.
//
// NOTE: For the Firestore write to succeed, your firestore.rules either
// must not be deployed yet (default rules), or the signed-in user must
// already be an admin. To bootstrap the very first admin against
// deployed rules, create the admin_users doc via Firebase Console.

import { initializeApp } from "firebase/app";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
} from "firebase/auth";
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "firebase/firestore";

const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} = process.env;

if (!VITE_FIREBASE_API_KEY || !VITE_FIREBASE_AUTH_DOMAIN || !VITE_FIREBASE_PROJECT_ID) {
  console.error("❌ Missing Firebase env vars. Run: node --env-file=.env create-admin.mjs");
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("❌ Set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  process.exit(1);
}

const app = initializeApp({
  apiKey: VITE_FIREBASE_API_KEY,
  authDomain: VITE_FIREBASE_AUTH_DOMAIN,
  projectId: VITE_FIREBASE_PROJECT_ID,
});
const auth = getAuth(app);
const db = getFirestore(app);

let user;
try {
  const cred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
  user = cred.user;
  console.log("✅ Created auth user:", user.email, "uid:", user.uid);
} catch (e) {
  if (e.code === "auth/email-already-in-use") {
    console.log("ℹ️  Auth user exists; signing in to get uid...");
    try {
      const cred = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
      user = cred.user;
      console.log("✅ Signed in:", user.email, "uid:", user.uid);
    } catch (signinErr) {
      console.error(
        "❌ Auth user exists but the password in .env is wrong. " +
          "Either fix ADMIN_PASSWORD in .env, or reset the password in Firebase Console.",
      );
      process.exit(1);
    }
  } else {
    console.error("❌", e.code, e.message);
    process.exit(1);
  }
}

const ref = doc(db, "admin_users", user.uid);
try {
  const snap = await getDoc(ref);
  if (snap.exists()) {
    console.log("✅ admin_users doc already exists for this uid. All good.");
  } else {
    await setDoc(ref, {
      email: ADMIN_EMAIL,
      role: "superadmin",
      createdAt: serverTimestamp(),
    });
    console.log("✅ Created admin_users doc for uid:", user.uid);
  }
  process.exit(0);
} catch (e) {
  console.error("❌ Firestore write failed:", e.code || "", e.message);
  console.error(
    "\nIf you see permission-denied: your firestore.rules require the user " +
      "to already be an admin to write admin_users. To bootstrap the very " +
      "first admin, create the doc manually in Firebase Console:\n" +
      "  Firestore -> admin_users collection -> Add document\n" +
      `  Document ID: ${user.uid}\n` +
      `  Fields: email="${ADMIN_EMAIL}" (string), role="superadmin" (string), createdAt=now (timestamp)\n`,
  );
  process.exit(1);
}

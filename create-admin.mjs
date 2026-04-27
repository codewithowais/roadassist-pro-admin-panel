// Run once to create the admin user:
//   node --env-file=.env create-admin.mjs
//
// Then delete this file — don't commit it.

import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, doc, setDoc, serverTimestamp } from "firebase/firestore";

const {
  VITE_FIREBASE_API_KEY,
  VITE_FIREBASE_AUTH_DOMAIN,
  VITE_FIREBASE_PROJECT_ID,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} = process.env;

if (!VITE_FIREBASE_API_KEY || !VITE_FIREBASE_AUTH_DOMAIN || !VITE_FIREBASE_PROJECT_ID) {
  console.error("❌ Missing Firebase env vars. Run with: node --env-file=.env create-admin.mjs");
  process.exit(1);
}
if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error("❌ Set ADMIN_EMAIL and ADMIN_PASSWORD in .env");
  process.exit(1);
}

const firebaseConfig = {
  apiKey: VITE_FIREBASE_API_KEY,
  authDomain: VITE_FIREBASE_AUTH_DOMAIN,
  projectId: VITE_FIREBASE_PROJECT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

try {
  const cred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
  // Register in admin_users so the panel allows login
  await setDoc(doc(db, "admin_users", cred.user.uid), {
    email: ADMIN_EMAIL,
    role: "superadmin",
    createdAt: serverTimestamp(),
  });
  console.log("✅ Admin created:", cred.user.email, "uid:", cred.user.uid);
  process.exit(0);
} catch (e) {
  console.error("❌", e.code, e.message);
  process.exit(1);
}

// Seeds app_config/flags with safe defaults so the mobile app reads
// real values instead of falling back to in-code defaults on first
// launch. Idempotent — re-running merges new keys onto whatever's there.
import admin from "firebase-admin";

const DEFAULT_FLAGS = {
  vendorSelfRegistration: true,
  vendorAppEnabled: true,
  kycStrict: true,
  liveLocationTracking: true,
  simulatedTrackingFallback: false,
  autoNotifyVendorOnRequest: true,
  fcmPushEnabled: true,
  smsNotifications: false,
  whatsappNotifications: false,
  sosEnabled: true,
  reviewsEnabled: true,
  paymentCollection: false,
  aiAssistantEnabled: true,
  autoCompleteOnArrived: true,
  maxActiveJobsPerVendor: 1,
  urgentThresholdMinutes: 5,
  appUnderMaintenance: false,
  maintenanceMessage: "",
};

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT missing");
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });

await admin.firestore().doc("app_config/flags").set(
  { ...DEFAULT_FLAGS, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
  { merge: true },
);
console.log("✅ app_config/flags seeded with defaults.");
process.exit(0);

// ─────────────────────────────────────────────────────────────────
//  VendorRegister.jsx  —  RoadAssist Pro
//  Public self-registration form for mechanics, tow trucks, etc.
//  Route: /register  (no auth required)
//  On submit → writes to Firestore vendors collection (status: pending)
//  Admin sees it in the KYC queue and approves/rejects.
// ─────────────────────────────────────────────────────────────────
import { useState, useRef } from "react";
import { submitVendorApplication, uploadFile } from "./firebase";
import { v as V, check } from "./validators";

// Stable per-form-instance id used as the R2 path prefix for this
// applicant's documents (vendor-docs/<applicationId>/cnic.jpg, etc.).
function makeApplicationId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  // RFC4122 v4 fallback for very old browsers.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const CATEGORIES = [
  { value: "Mechanic", label: "🔧 Mechanic", desc: "General car/bike repairs" },
  {
    value: "Fuel Delivery",
    label: "⛽ Fuel Delivery",
    desc: "Emergency fuel supply",
  },
  {
    value: "Tyre Repair",
    label: "🔄 Tyre / Puncture",
    desc: "Tyre change & repair",
  },
  {
    value: "Battery",
    label: "🔋 Battery Jump-Start",
    desc: "Dead battery assistance",
  },
  { value: "Tow Truck", label: "🚛 Tow Truck", desc: "Vehicle towing service" },
  {
    value: "Accident Recovery",
    label: "🏗 Accident Recovery",
    desc: "Crane & recovery",
  },
];

const CITIES = [
  "Karachi",
  "Lahore",
  "Islamabad",
  "Rawalpindi",
  "Faisalabad",
  "Multan",
  "Peshawar",
  "Quetta",
  "Hyderabad",
  "Sialkot",
];

const STEPS = [
  "Service Type",
  "Business Info",
  "Contact & Location",
  "Documents",
  "Review & Submit",
];

export default function VendorRegister() {
  const [applicationId] = useState(makeApplicationId);
  const [step, setStep] = useState(0);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState({});
  const [uploads, setUploads] = useState({
    cnic: null,
    license: null,
    photo: null,
  });
  const [progress, setProgress] = useState({ cnic: 0, license: 0, photo: 0 });
  const [form, setForm] = useState({
    category: "",
    businessName: "",
    ownerName: "",
    phone: "",
    whatsapp: "",
    email: "",
    city: "",
    area: "",
    address: "",
    lat: "",
    lng: "",
    operatingHours: "9am – 9pm",
    costRange: "",
    description: "",
    cnicNumber: "",
    vehicleReg: "",
    agreedToTerms: false,
  });

  const fileRefs = { cnic: useRef(), license: useRef(), photo: useRef() };

  const set = (k, v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const validate = () => {
    const e = {};
    if (step === 0 && !form.category)
      e.category = "Please select a service type";
    if (step === 1) {
      e.businessName = check(
        form.businessName,
        V.required("Business name is required"),
        V.minLength(2, "Too short — at least 2 characters"),
        V.maxLength(120, "Too long — keep it under 120 characters"),
      );
      e.ownerName = check(
        form.ownerName,
        V.required("Owner name is required"),
        V.minLength(2, "Too short — at least 2 characters"),
        V.maxLength(120, "Too long — keep it under 120 characters"),
      );
      e.costRange = V.costRange(form.costRange);
      e.description = V.maxLength(1000, "Description too long")(form.description);
    }
    if (step === 2) {
      e.phone = V.pakPhone(form.phone);
      e.whatsapp = V.pakPhoneOptional(form.whatsapp);
      e.email = V.email(form.email);
      if (!form.city) e.city = "City is required";
      e.address = check(
        form.address,
        V.required("Address is required"),
        V.minLength(10, "Address too short — be specific"),
        V.maxLength(500, "Address too long"),
      );
      e.lat = V.lat(form.lat);
      e.lng = V.lng(form.lng);
      e.cnicNumber = V.cnic(form.cnicNumber);
      e.vehicleReg = V.vehicleReg(form.vehicleReg);
    }
    if (step === 3) {
      if (!uploads.cnic) e.cnic = "CNIC image is required";
      if (!uploads.license) e.license = "License/certificate is required";
    }
    if (step === 4 && !form.agreedToTerms)
      e.agreedToTerms = "You must agree to the terms";
    // Strip null entries — only real errors count toward the validity check.
    for (const k of Object.keys(e)) if (!e[k]) delete e[k];
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleFile = async (key, file) => {
    if (!file) return;
    try {
      const path = await uploadFile(file, applicationId, key, (pct) =>
        setProgress((p) => ({ ...p, [key]: pct })),
      );
      setUploads((p) => ({ ...p, [key]: path }));
      setErrors((p) => ({ ...p, [key]: undefined }));
    } catch {
      setErrors((p) => ({ ...p, [key]: "Upload failed. Try again." }));
    }
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      await submitVendorApplication({
        ...form,
        applicationId,
        lat: parseFloat(form.lat) || 24.8607,
        lng: parseFloat(form.lng) || 67.0011,
        documents: {
          cnicPath: uploads.cnic,
          licensePath: uploads.license,
          photoPath: uploads.photo,
        },
      });
      setDone(true);
    } catch (e) {
      setErrors({ submit: "Submission failed: " + e.message });
    } finally {
      setLoading(false);
    }
  };

  // ── Style helpers
  const inputStyle = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1.5px solid #e2e6ef",
    background: "#f8faff",
    fontSize: 14,
    color: "#1e293b",
    outline: "none",
    transition: "border .15s",
  };
  const errStyle = { fontSize: 12, color: "#dc2626", marginTop: 4 };
  const labelStyle = {
    fontSize: 12,
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    marginBottom: 6,
    display: "block",
  };

  // ── Success screen
  if (done)
    return (
      <div
        style={{
          minHeight: "100vh",
          background: "linear-gradient(135deg,#fff7f0 0%,#f0f4ff 100%)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
        }}
      >
        <div
          style={{
            background: "#fff",
            borderRadius: 24,
            padding: 48,
            maxWidth: 480,
            width: "100%",
            textAlign: "center",
            boxShadow: "0 20px 60px #0001",
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              background: "#dcfce7",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              margin: "0 auto 20px",
              fontSize: 32,
            }}
          >
            ✓
          </div>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#1e293b",
              marginBottom: 8,
            }}
          >
            Application Submitted!
          </h2>
          <p
            style={{
              color: "#64748b",
              fontSize: 14,
              lineHeight: 1.7,
              marginBottom: 24,
            }}
          >
            Thank you <strong>{form.ownerName}</strong>! Your application for{" "}
            <strong>{form.businessName}</strong> has been received. Our team
            will review your documents and get back to you within{" "}
            <strong>24–48 hours</strong>.
          </p>
          <div
            style={{
              background: "#f8faff",
              borderRadius: 12,
              padding: 16,
              marginBottom: 24,
              textAlign: "left",
            }}
          >
            <div
              style={{
                fontSize: 12,
                color: "#94a3b8",
                marginBottom: 8,
                fontWeight: 600,
              }}
            >
              WHAT HAPPENS NEXT
            </div>
            {[
              "Admin reviews your KYC documents",
              "You receive an SMS/WhatsApp confirmation",
              "Your profile goes live on RoadAssist Pro",
              "Customers can find and contact you",
            ].map((s, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  gap: 10,
                  marginBottom: 8,
                  fontSize: 13,
                  color: "#475569",
                }}
              >
                <span
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: "#e8630a",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>
                {s}
              </div>
            ))}
          </div>
          <button
            onClick={() => {
              setDone(false);
              setStep(0);
              setForm({
                category: "",
                businessName: "",
                ownerName: "",
                phone: "",
                whatsapp: "",
                email: "",
                city: "",
                area: "",
                address: "",
                lat: "",
                lng: "",
                operatingHours: "9am – 9pm",
                costRange: "",
                description: "",
                cnicNumber: "",
                vehicleReg: "",
                agreedToTerms: false,
              });
              setUploads({ cnic: null, license: null, photo: null });
            }}
            style={{
              background: "#e8630a",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "12px 24px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Submit Another Application
          </button>
        </div>
      </div>
    );

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg,#fff7f0 0%,#f0f4ff 100%)",
        padding: "20px 16px",
      }}
    >
      {/* Header */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              background: "#e8630a",
              borderRadius: 10,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: 20,
              color: "#fff",
            }}
          >
            R
          </div>
          <span style={{ fontSize: 20, fontWeight: 700, color: "#1e293b" }}>
            RoadAssist Pro
          </span>
        </div>
        <h1
          style={{
            fontSize: 28,
            fontWeight: 800,
            color: "#1e293b",
            marginBottom: 6,
          }}
        >
          Provider Registration
        </h1>
        <p style={{ color: "#64748b", fontSize: 14 }}>
          Join Pakistan's fastest-growing roadside assistance network
        </p>
      </div>

      {/* Progress bar */}
      <div style={{ maxWidth: 640, margin: "0 auto 28px" }}>
        <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
          {STEPS.map((s, i) => (
            <div
              key={s}
              style={{
                flex: 1,
                height: 4,
                borderRadius: 4,
                background: i <= step ? "#e8630a" : "#e2e8f0",
                transition: "background .3s",
              }}
            />
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          {STEPS.map((s, i) => (
            <span
              key={s}
              style={{
                fontSize: 10,
                color:
                  i === step ? "#e8630a" : i < step ? "#22c55e" : "#94a3b8",
                fontWeight: i === step ? 700 : 400,
                flex: 1,
                textAlign: "center",
              }}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {/* Card */}
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 20,
          padding: 32,
          boxShadow: "0 8px 32px #0001",
        }}
      >
        {/* ── Step 0: Service Type */}
        {step === 0 && (
          <>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#1e293b",
                marginBottom: 6,
              }}
            >
              What service do you offer?
            </h2>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 24 }}>
              Select the primary type of roadside assistance you provide.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
              }}
            >
              {CATEGORIES.map((c) => (
                <div
                  key={c.value}
                  onClick={() => set("category", c.value)}
                  style={{
                    border: `2px solid ${form.category === c.value ? "#e8630a" : "#e2e8f0"}`,
                    borderRadius: 14,
                    padding: "16px 14px",
                    cursor: "pointer",
                    transition: "all .15s",
                    background: form.category === c.value ? "#fff7f0" : "#fff",
                  }}
                >
                  <div style={{ fontSize: 22, marginBottom: 6 }}>
                    {c.label.split(" ")[0]}
                  </div>
                  <div
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "#1e293b",
                      marginBottom: 3,
                    }}
                  >
                    {c.label.slice(c.label.indexOf(" ") + 1)}
                  </div>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{c.desc}</div>
                </div>
              ))}
            </div>
            {errors.category && <p style={errStyle}>{errors.category}</p>}
          </>
        )}

        {/* ── Step 1: Business Info */}
        {step === 1 && (
          <>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#1e293b",
                marginBottom: 6,
              }}
            >
              Business Information
            </h2>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 24 }}>
              Tell us about your business.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
            >
              <div style={{ gridColumn: "1/-1" }}>
                <label style={labelStyle}>Business / Shop Name *</label>
                <input
                  value={form.businessName}
                  onChange={(e) => set("businessName", e.target.value)}
                  placeholder="e.g. Ahmed Auto Workshop"
                  maxLength={120}
                  autoComplete="organization"
                  style={{
                    ...inputStyle,
                    borderColor: errors.businessName ? "#dc2626" : undefined,
                  }}
                />
                {errors.businessName && (
                  <p style={errStyle}>{errors.businessName}</p>
                )}
              </div>
              <div>
                <label style={labelStyle}>Owner / Manager Name *</label>
                <input
                  value={form.ownerName}
                  onChange={(e) => set("ownerName", e.target.value)}
                  placeholder="Full name"
                  maxLength={120}
                  autoComplete="name"
                  style={{
                    ...inputStyle,
                    borderColor: errors.ownerName ? "#dc2626" : undefined,
                  }}
                />
                {errors.ownerName && <p style={errStyle}>{errors.ownerName}</p>}
              </div>
              <div>
                <label style={labelStyle}>Cost Range *</label>
                <input
                  value={form.costRange}
                  onChange={(e) => set("costRange", e.target.value)}
                  placeholder="e.g. Rs. 500 – 2,000"
                  maxLength={60}
                  style={{
                    ...inputStyle,
                    borderColor: errors.costRange ? "#dc2626" : undefined,
                  }}
                />
                {errors.costRange && <p style={errStyle}>{errors.costRange}</p>}
              </div>
              <div>
                <label style={labelStyle}>Operating Hours</label>
                <input
                  value={form.operatingHours}
                  onChange={(e) => set("operatingHours", e.target.value)}
                  placeholder="e.g. 8am – 10pm"
                  maxLength={60}
                  style={inputStyle}
                />
              </div>
              <div>
                <label style={labelStyle}>Email (optional)</label>
                <input
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="your@email.com"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={120}
                  style={{
                    ...inputStyle,
                    borderColor: errors.email ? "#dc2626" : undefined,
                  }}
                />
                {errors.email && <p style={errStyle}>{errors.email}</p>}
              </div>
              <div style={{ gridColumn: "1/-1" }}>
                <label style={labelStyle}>Brief Description</label>
                <textarea
                  value={form.description}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Describe your services, experience, specialties..."
                  rows={3}
                  maxLength={1000}
                  style={{
                    ...inputStyle,
                    resize: "vertical",
                    borderColor: errors.description ? "#dc2626" : undefined,
                  }}
                />
                <div
                  style={{
                    fontSize: 11,
                    color: "#94a3b8",
                    marginTop: 4,
                    textAlign: "right",
                  }}
                >
                  {form.description.length}/1000
                </div>
                {errors.description && (
                  <p style={errStyle}>{errors.description}</p>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Step 2: Contact & Location */}
        {step === 2 && (
          <>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#1e293b",
                marginBottom: 6,
              }}
            >
              Contact & Location
            </h2>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 24 }}>
              Customers will use this info to reach you.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
              }}
            >
              <div>
                <label style={labelStyle}>Phone Number *</label>
                <input
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+92 300 1234567"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                  style={{
                    ...inputStyle,
                    borderColor: errors.phone ? "#dc2626" : undefined,
                  }}
                />
                {errors.phone && <p style={errStyle}>{errors.phone}</p>}
              </div>
              <div>
                <label style={labelStyle}>WhatsApp Number</label>
                <input
                  value={form.whatsapp}
                  onChange={(e) => set("whatsapp", e.target.value)}
                  placeholder="+92 300 1234567"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel-national"
                  maxLength={20}
                  style={{
                    ...inputStyle,
                    borderColor: errors.whatsapp ? "#dc2626" : undefined,
                  }}
                />
                {errors.whatsapp && <p style={errStyle}>{errors.whatsapp}</p>}
              </div>
              <div>
                <label style={labelStyle}>City *</label>
                <select
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                  style={{
                    ...inputStyle,
                    borderColor: errors.city ? "#dc2626" : undefined,
                  }}
                >
                  <option value="">Select city...</option>
                  {CITIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {errors.city && <p style={errStyle}>{errors.city}</p>}
              </div>
              <div>
                <label style={labelStyle}>Area / Neighbourhood</label>
                <input
                  value={form.area}
                  onChange={(e) => set("area", e.target.value)}
                  placeholder="e.g. DHA Phase 5"
                  maxLength={120}
                  autoComplete="address-level3"
                  style={inputStyle}
                />
              </div>
              <div style={{ gridColumn: "1/-1" }}>
                <label style={labelStyle}>Full Address *</label>
                <input
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="Shop #, Street, Area, City"
                  maxLength={500}
                  autoComplete="street-address"
                  style={{
                    ...inputStyle,
                    borderColor: errors.address ? "#dc2626" : undefined,
                  }}
                />
                {errors.address && <p style={errStyle}>{errors.address}</p>}
              </div>
              <div>
                <label style={labelStyle}>GPS Latitude (optional)</label>
                <input
                  value={form.lat}
                  onChange={(e) => set("lat", e.target.value)}
                  placeholder="24.8607"
                  inputMode="decimal"
                  pattern="-?[0-9]+(\.[0-9]+)?"
                  maxLength={12}
                  style={{
                    ...inputStyle,
                    borderColor: errors.lat ? "#dc2626" : undefined,
                  }}
                />
                {errors.lat && <p style={errStyle}>{errors.lat}</p>}
              </div>
              <div>
                <label style={labelStyle}>GPS Longitude (optional)</label>
                <input
                  value={form.lng}
                  onChange={(e) => set("lng", e.target.value)}
                  placeholder="67.0011"
                  inputMode="decimal"
                  pattern="-?[0-9]+(\.[0-9]+)?"
                  maxLength={12}
                  style={{
                    ...inputStyle,
                    borderColor: errors.lng ? "#dc2626" : undefined,
                  }}
                />
                {errors.lng && <p style={errStyle}>{errors.lng}</p>}
              </div>
              <div
                style={{
                  gridColumn: "1/-1",
                  background: "#f0fdf4",
                  border: "1px solid #bbf7d0",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 12,
                  color: "#166534",
                }}
              >
                💡 Tip: Open Google Maps, find your location, right-click and
                copy the coordinates.
              </div>
            </div>
          </>
        )}

        {/* ── Step 3: Documents */}
        {step === 3 && (
          <>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#1e293b",
                marginBottom: 6,
              }}
            >
              KYC Documents
            </h2>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 24 }}>
              Upload clear photos. Documents are reviewed within 24h and kept
              secure.
            </p>

            {[
              {
                key: "cnic",
                label: "CNIC (National ID) *",
                accept: "image/*,.pdf",
                icon: "🪪",
                hint: "Front & back photo of your CNIC",
              },
              {
                key: "license",
                label: "Business License / Certificate *",
                accept: "image/*,.pdf",
                icon: "📋",
                hint: "Trade license, mechanic cert, or any official document",
              },
              {
                key: "photo",
                label: "Shop / Vehicle Photo",
                accept: "image/*",
                icon: "📷",
                hint: "A photo of your shop or service vehicle",
              },
            ].map(({ key, label, accept, icon, hint }) => (
              <div key={key} style={{ marginBottom: 20 }}>
                <label style={labelStyle}>{label}</label>
                <div
                  onClick={() => fileRefs[key].current.click()}
                  style={{
                    border: `2px dashed ${errors[key] ? "#dc2626" : uploads[key] ? "#22c55e" : "#cbd5e1"}`,
                    borderRadius: 14,
                    padding: "20px 16px",
                    textAlign: "center",
                    cursor: "pointer",
                    background: uploads[key] ? "#f0fdf4" : "#f8faff",
                    transition: "all .15s",
                  }}
                >
                  <div style={{ fontSize: 28, marginBottom: 6 }}>
                    {uploads[key] ? "✅" : icon}
                  </div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 600,
                      color: uploads[key] ? "#16a34a" : "#475569",
                    }}
                  >
                    {uploads[key] ? "Uploaded successfully" : "Click to upload"}
                  </div>
                  <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>
                    {hint}
                  </div>
                  {progress[key] > 0 && progress[key] < 100 && (
                    <div style={{ marginTop: 10 }}>
                      <div
                        style={{
                          background: "#e2e8f0",
                          borderRadius: 4,
                          height: 4,
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            borderRadius: 4,
                            background: "#e8630a",
                            width: `${progress[key]}%`,
                            transition: "width .3s",
                          }}
                        />
                      </div>
                      <div
                        style={{ fontSize: 11, color: "#e8630a", marginTop: 3 }}
                      >
                        {progress[key]}%
                      </div>
                    </div>
                  )}
                  <input
                    ref={fileRefs[key]}
                    type="file"
                    accept={accept}
                    style={{ display: "none" }}
                    onChange={(e) => handleFile(key, e.target.files[0])}
                  />
                </div>
                {errors[key] && <p style={errStyle}>{errors[key]}</p>}
              </div>
            ))}

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 16,
                marginTop: 8,
              }}
            >
              <div>
                <label style={labelStyle}>CNIC Number</label>
                <input
                  value={form.cnicNumber}
                  onChange={(e) => set("cnicNumber", e.target.value)}
                  placeholder="35201-1234567-1"
                  inputMode="numeric"
                  maxLength={15}
                  style={{
                    ...inputStyle,
                    borderColor: errors.cnicNumber ? "#dc2626" : undefined,
                  }}
                />
                {errors.cnicNumber && (
                  <p style={errStyle}>{errors.cnicNumber}</p>
                )}
              </div>
              <div>
                <label style={labelStyle}>
                  Vehicle Registration (if applicable)
                </label>
                <input
                  value={form.vehicleReg}
                  onChange={(e) =>
                    set("vehicleReg", e.target.value.toUpperCase())
                  }
                  placeholder="ABC-123"
                  maxLength={12}
                  style={{
                    ...inputStyle,
                    textTransform: "uppercase",
                    borderColor: errors.vehicleReg ? "#dc2626" : undefined,
                  }}
                />
                {errors.vehicleReg && (
                  <p style={errStyle}>{errors.vehicleReg}</p>
                )}
              </div>
            </div>
          </>
        )}

        {/* ── Step 4: Review & Submit */}
        {step === 4 && (
          <>
            <h2
              style={{
                fontSize: 20,
                fontWeight: 700,
                color: "#1e293b",
                marginBottom: 6,
              }}
            >
              Review & Submit
            </h2>
            <p style={{ color: "#64748b", fontSize: 13, marginBottom: 20 }}>
              Please review your information before submitting.
            </p>

            {[
              { label: "Service Type", value: form.category },
              { label: "Business Name", value: form.businessName },
              { label: "Owner Name", value: form.ownerName },
              { label: "Phone", value: form.phone },
              {
                label: "City / Area",
                value: `${form.city}${form.area ? ` — ${form.area}` : ""}`,
              },
              { label: "Address", value: form.address },
              { label: "Cost Range", value: form.costRange },
              { label: "Hours", value: form.operatingHours },
              {
                label: "CNIC Uploaded",
                value: uploads.cnic ? "✅ Yes" : "❌ Missing",
              },
              {
                label: "License Uploaded",
                value: uploads.license ? "✅ Yes" : "❌ Missing",
              },
              {
                label: "Photo Uploaded",
                value: uploads.photo ? "✅ Yes" : "— Skipped",
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "8px 0",
                  borderBottom: "1px solid #f1f5f9",
                  fontSize: 13,
                }}
              >
                <span style={{ color: "#64748b", fontWeight: 500 }}>
                  {label}
                </span>
                <span
                  style={{
                    color: "#1e293b",
                    fontWeight: 600,
                    textAlign: "right",
                    maxWidth: "55%",
                  }}
                >
                  {value || "—"}
                </span>
              </div>
            ))}

            <div
              style={{
                marginTop: 20,
                background: "#f8faff",
                border: "1px solid #e2e8f0",
                borderRadius: 12,
                padding: "14px 16px",
              }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 10,
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={form.agreedToTerms}
                  onChange={(e) => set("agreedToTerms", e.target.checked)}
                  style={{
                    marginTop: 2,
                    width: 16,
                    height: 16,
                    accentColor: "#e8630a",
                  }}
                />
                <span
                  style={{ fontSize: 13, color: "#475569", lineHeight: 1.5 }}
                >
                  I confirm all information is accurate and I agree to
                  RoadAssist Pro's{" "}
                  <a href="#" style={{ color: "#e8630a" }}>
                    Terms of Service
                  </a>{" "}
                  and{" "}
                  <a href="#" style={{ color: "#e8630a" }}>
                    Privacy Policy
                  </a>
                  . I understand my application will be reviewed before
                  activation.
                </span>
              </label>
              {errors.agreedToTerms && (
                <p style={errStyle}>{errors.agreedToTerms}</p>
              )}
            </div>

            {errors.submit && (
              <div
                style={{
                  marginTop: 12,
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 10,
                  padding: "10px 14px",
                  fontSize: 13,
                  color: "#dc2626",
                }}
              >
                {errors.submit}
              </div>
            )}
          </>
        )}

        {/* Navigation buttons */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 28,
          }}
        >
          <button
            onClick={() => setStep((s) => s - 1)}
            disabled={step === 0}
            style={{
              padding: "11px 24px",
              borderRadius: 10,
              border: "1.5px solid #e2e8f0",
              background: "#fff",
              color: "#475569",
              fontSize: 14,
              fontWeight: 600,
              cursor: step === 0 ? "not-allowed" : "pointer",
              opacity: step === 0 ? 0.4 : 1,
            }}
          >
            ← Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={() => {
                if (validate()) setStep((s) => s + 1);
              }}
              style={{
                padding: "11px 28px",
                borderRadius: 10,
                border: "none",
                background: "#e8630a",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Continue →
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                padding: "11px 28px",
                borderRadius: 10,
                border: "none",
                background: loading ? "#f97316" : "#e8630a",
                color: "#fff",
                fontSize: 14,
                fontWeight: 600,
                cursor: loading ? "wait" : "pointer",
                minWidth: 140,
              }}
            >
              {loading ? "Submitting…" : "Submit Application ✓"}
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        style={{
          textAlign: "center",
          marginTop: 24,
          fontSize: 12,
          color: "#94a3b8",
        }}
      >
        Already registered?{" "}
        <a href="/admin" style={{ color: "#e8630a" }}>
          Admin Login →
        </a>
      </div>
    </div>
  );
}

// Tiny field-validator library used by the vendor register form, the
// admin Add/Edit Vendor modal, and the Settings page. Each validator
// returns null on success and an error message on failure so call sites
// can do `setErrors(prev => ({ ...prev, phone: validators.pakPhone(v) }))`.

const trim = (v) => (v == null ? "" : String(v).trim());
const digits = (v) => trim(v).replace(/\D/g, "");

export const v = {
  required: (label = "Required") => (val) =>
    trim(val).length === 0 ? label : null,

  minLength: (n, label) => (val) =>
    trim(val).length >= n
      ? null
      : label || `Must be at least ${n} characters`,

  maxLength: (n, label) => (val) =>
    trim(val).length <= n
      ? null
      : label || `Must be no more than ${n} characters`,

  // Pakistan-friendly phone: accepts +92XXXXXXXXXX, 03XXXXXXXXX,
  // landlines like 021XXXXXXX, with or without separators. Normalises
  // by stripping non-digits then checks length 10-13.
  pakPhone: (val) => {
    const d = digits(val);
    if (d.length === 0) return "Phone number is required";
    if (d.length < 10 || d.length > 13)
      return "Enter a valid phone number (10-13 digits)";
    return null;
  },

  pakPhoneOptional: (val) => {
    if (trim(val).length === 0) return null;
    return v.pakPhone(val);
  },

  email: (val) => {
    if (trim(val).length === 0) return null;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trim(val))
      ? null
      : "Enter a valid email address";
  },

  emailRequired: (val) => {
    if (trim(val).length === 0) return "Email is required";
    return v.email(val);
  },

  // Pakistan CNIC: 13 digits, commonly written 12345-1234567-1.
  cnic: (val) => {
    if (trim(val).length === 0) return null;
    return digits(val).length === 13
      ? null
      : "CNIC must be 13 digits (e.g. 12345-1234567-1)";
  },

  // Vehicle registration: letters, digits, optional dash. 3-12 chars.
  vehicleReg: (val) => {
    const t = trim(val);
    if (t.length === 0) return null;
    return /^[A-Za-z0-9 -]{3,12}$/.test(t)
      ? null
      : "Enter a valid registration (e.g. ABC-1234)";
  },

  lat: (val) => {
    if (trim(val).length === 0) return null;
    const n = Number(val);
    if (Number.isNaN(n)) return "Must be a number";
    return n >= -90 && n <= 90
      ? null
      : "Latitude must be between -90 and 90";
  },

  lng: (val) => {
    if (trim(val).length === 0) return null;
    const n = Number(val);
    if (Number.isNaN(n)) return "Must be a number";
    return n >= -180 && n <= 180
      ? null
      : "Longitude must be between -180 and 180";
  },

  // Positive integer (>= 0).
  nonNegativeInt: (val) => {
    const t = trim(val);
    if (t.length === 0) return "Required";
    if (!/^\d+$/.test(t)) return "Whole numbers only";
    return null;
  },

  // Positive integer (> 0). Optional bounds.
  positiveInt:
    (min = 1, max = Number.MAX_SAFE_INTEGER) =>
    (val) => {
      const t = trim(val);
      if (t.length === 0) return "Required";
      if (!/^\d+$/.test(t)) return "Whole numbers only";
      const n = Number(t);
      if (n < min) return `Must be at least ${min}`;
      if (n > max) return `Must be no more than ${max}`;
      return null;
    },

  // Cost-range hint: must contain at least one digit (e.g. "Rs. 500-2000").
  costRange: (val) => {
    const t = trim(val);
    if (t.length === 0) return "Cost range is required";
    if (!/\d/.test(t)) return "Include numbers (e.g. PKR 1000-3000)";
    if (t.length > 60) return "Too long";
    return null;
  },

  // Helpline / short code: digits, 3-13 chars (covers 1122, +922135xxxxx).
  helpline: (val) => {
    const d = digits(val);
    if (d.length === 0) return "Helpline number is required";
    if (d.length < 3 || d.length > 13)
      return "Enter a valid helpline (3-13 digits)";
    return null;
  },

  // URL — optional. Allows http(s) and bare domains.
  url: (val) => {
    const t = trim(val);
    if (t.length === 0) return null;
    try {
      // eslint-disable-next-line no-new
      new URL(t.includes("://") ? t : `https://${t}`);
      return null;
    } catch {
      return "Enter a valid URL";
    }
  },
};

// Run a chain of validators and return the first error.
export function check(val, ...fns) {
  for (const fn of fns) {
    const err = fn(val);
    if (err) return err;
  }
  return null;
}

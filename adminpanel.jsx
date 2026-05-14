// ─────────────────────────────────────────────────────────────────
//  AdminPanel.jsx  —  RoadAssist Pro
//  Full admin panel:  Firebase Firestore real-time listeners,
//  notification panel, light/dark mode, vendor KYC queue, etc.
//
//  Dependencies:
//    npm install recharts firebase
//
//  Usage in App.jsx:
//    import AdminPanel from './AdminPanel'
//    export default function App() { return <AdminPanel /> }
// ─────────────────────────────────────────────────────────────────
import { useState, useEffect, useMemo, useRef, createContext, useContext } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// ── Firebase imports (wired to real Firestore) ────────────────────
import {
  auth,
  db,
  adminLogin,
  adminLogout,
  getVendors,
  addVendor,
  updateVendor,
  deleteVendor,
  approveKYC,
  rejectKYC,
  restoreVendor,
  permanentlyDeleteVendor,
  addUser,
  updateUser,
  deleteUser,
  restoreUser,
  permanentlyDeleteUser,
  getAdminUsers,
  updateAdminUser,
  removeAdminUser,
  getZones,
  addZone,
  updateZone,
  deleteZone,
  getUsers,
  blockUser,
  unbanUser,
  getRequests,
  updateRequestStatus,
  getSOS,
  resolveSOS,
  getReviews,
  flagReview,
  removeReview,
  restoreReview,
  restoreDeletedReview,
  permanentlyDeleteReview,
  getNotifications,
  sendNotification,
  sendNotificationToAudience,
  sendNotificationToUsers,
  getAuditLog,
  getAppConfig,
  saveAppConfig,
  getFeatureFlags,
  saveFeatureFlags,
  DEFAULT_FLAGS,
  logAudit,
  uploadFile,
  viewVendorDoc,
  deleteVendorDoc,
  onFCMMessage,
  adminCreateAuthAccount,
  getEmergencyContacts,
  addEmergencyContact,
  updateEmergencyContact,
  deleteEmergencyContact,
  lookupUserByPhone,
} from "./src/lib/supabase";
import { supabase } from "./src/lib/supabase";
import { v as V, check } from "./validators";

// ── Date helper: works with ISO strings (Supabase) and legacy Firestore Timestamps ──
function toDate(v) {
  if (!v) return null;
  if (typeof v === "string" || typeof v === "number") return new Date(v);
  if (v?.toDate) return v.toDate(); // legacy Firestore Timestamp
  if (v instanceof Date) return v;
  return null;
}

// ─────────────────────────────────────────────────────────────────
//  THEME
// ─────────────────────────────────────────────────────────────────
const DARK = (primary = "#F97316") => ({
  mode: "dark",
  bg: "#0d0f18",
  sidebar: "#10121c",
  card: "#10121c",
  border: "#1c1f2e",
  hover: "#181a28",
  input: "#181a28",
  muted: "#3a4060",
  text2: "#6a7090",
  text1: "#c0c4d4",
  white: "#e2e4ee",
  orange: primary,
  ttBg: "#1a1d2a",
  ttBdr: "#1c1f2e",
  rowAlt: "#0d0f18",
  thColor: "#2e3450",
  scrollThumb: "#252837",
  activeNavBg: "#1a1d2e",
});
const LIGHT = (primary = "#F97316") => ({
  mode: "light",
  bg: "#F5F5F5",
  sidebar: "#FFFFFF",
  card: "#FFFFFF",
  border: "#E5E7EB",
  hover: "#F9FAFB",
  input: "#F9FAFB",
  muted: "#9CA3AF",
  text2: "#6B7280",
  text1: "#111827",
  white: "#111827",
  orange: primary,
  ttBg: "#FFFFFF",
  ttBdr: "#E5E7EB",
  rowAlt: "#F9FAFB",
  thColor: "#9CA3AF",
  scrollThumb: "#D1D5DB",
  activeNavBg: primary + "22",
});
const ThemeCtx = createContext(LIGHT());
const useTheme = () => useContext(ThemeCtx);
const AdminCtx = createContext({});
const useAdmin = () => useContext(AdminCtx);

// ─────────────────────────────────────────────────────────────────
//  STATIC DATA (fallback / charts)
// ─────────────────────────────────────────────────────────────────
const chartData = [
  { day: "Mon", requests: 42, revenue: 8400 },
  { day: "Tue", requests: 58, revenue: 11600 },
  { day: "Wed", requests: 35, revenue: 7000 },
  { day: "Thu", requests: 67, revenue: 13400 },
  { day: "Fri", requests: 89, revenue: 17800 },
  { day: "Sat", requests: 112, revenue: 22400 },
  { day: "Sun", requests: 76, revenue: 15200 },
];
const getCatData = (primary) => [
  { name: "Mechanic", value: 38, color: primary },
  { name: "Fuel", value: 22, color: "#3b82f6" },
  { name: "Tyre", value: 18, color: "#22c55e" },
  { name: "Battery", value: 12, color: "#f59e0b" },
  { name: "Tow", value: 7, color: "#a855f7" },
  { name: "Accident", value: 3, color: "#ef4444" },
];
// Color map keyed by canonical category enum (SCHEMA.md → vendors.category).
// Legacy aliases are kept so older Firestore docs still get the right color.
const getCatColors = (primary) => ({
  Mechanic: primary,
  Fuel: "#3b82f6",
  "Fuel Delivery": "#3b82f6",
  Tyre: "#22c55e",
  "Tyre Repair": "#22c55e",
  Battery: "#f59e0b",
  Towing: "#a855f7",
  "Tow Truck": "#a855f7",
  Accident: "#ef4444",
  "Accident Recovery": "#ef4444",
});
const getBadgePalette = (primary) => ({
  green: { bg: "#22c55e18", color: "#16a34a", border: "#22c55e33" },
  red: { bg: "#ef444418", color: "#dc2626", border: "#ef444433" },
  orange: { bg: primary + "18", color: primary, border: primary + "33" },
  blue: { bg: "#3b82f618", color: "#2563eb", border: "#3b82f633" },
  yellow: { bg: "#f59e0b18", color: "#d97706", border: "#f59e0b33" },
  gray: { bg: "#88888818", color: "#6b7280", border: "#88888833" },
  purple: { bg: "#a855f718", color: "#7c3aed", border: "#a855f733" },
});
const BADGE_MAP = {
  // Service request statuses (canonical Flutter enum, see
  // service_request_model.dart). `pending`/`in_progress` are LEGACY aliases
  // kept so old Firestore docs still render with the right colour. New
  // writes use the canonical names.
  completed: "green",
  arrived: "green",
  onTheWay: "orange",
  in_progress: "orange",
  accepted: "blue",
  requested: "yellow",
  pending: "yellow",
  cancelled: "red",
  verified: "green",
  unverified: "gray",
  approved: "green",
  rejected: "red",
  active: "green",
  blocked: "red",
  visible: "green",
  flagged: "red",
  paid: "green",
  superadmin: "orange",
  manager: "blue",
  support: "gray",
  broadcast: "orange",
  targeted: "blue",
  segment: "green",
  self_registration: "purple",
};
// Canonical category enum — MUST match the mobile app's filter values.
// See SCHEMA.md → vendors.category. Changing these strings will break the
// mobile vendor list (it filters vendors by exact category match).
const CATEGORIES = [
  "Mechanic",
  "Fuel",
  "Tyre",
  "Battery",
  "Accident",
  "Towing",
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
];

// ─────────────────────────────────────────────────────────────────
//  ATOMS
// ─────────────────────────────────────────────────────────────────
function Badge({ status, text }) {
  const t = useTheme();
  const bp = getBadgePalette(t.orange);
  const s = bp[BADGE_MAP[status]] || bp.gray;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 20,
        fontSize: 10,
        fontWeight: 600,
        whiteSpace: "nowrap",
        background: s.bg,
        color: s.color,
        border: `1px solid ${s.border}`,
      }}
    >
      {text || status?.replace(/_/g, " ")}
    </span>
  );
}
function Av({ initials, color, size = 26 }) {
  const t = useTheme();
  const bg = color || t.orange;
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.36,
        fontWeight: 700,
        color: "#fff",
        flexShrink: 0,
      }}
    >
      {initials}
    </div>
  );
}
function CatDot({ cat }) {
  const t = useTheme();
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", fontSize: 11 }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: getCatColors(t.orange)[cat] || "#888",
          display: "inline-block",
          marginRight: 5,
        }}
      />
      {cat}
    </span>
  );
}
function Stars({ n = 0 }) {
  const r = Math.round(n);
  return (
    <span>
      <span style={{ color: "#f59e0b", fontSize: 11 }}>
        {"★".repeat(r)}
        {"☆".repeat(5 - r)}
      </span>
      <span style={{ color: "#9ca3af", fontSize: 10 }}> {n}</span>
    </span>
  );
}
function PBar({ pct, color }) {
  const t = useTheme();
  return (
    <div
      style={{
        background: t.border,
        borderRadius: 3,
        height: 5,
        overflow: "hidden",
        marginTop: 4,
      }}
    >
      <div
        style={{
          height: "100%",
          borderRadius: 3,
          background: color || t.orange,
          width: `${pct}%`,
          transition: "width .4s",
        }}
      />
    </div>
  );
}
function Card({ children, style }) {
  const t = useTheme();
  return (
    <div
      className="ra-card"
      style={{
        background: t.card,
        border: `1px solid ${t.border}`,
        borderRadius: 10,
        padding: 14,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
function CT({ children, action }) {
  const t = useTheme();
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        color: t.text2,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        marginBottom: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      {children}
      {action && (
        <span
          style={{
            fontSize: 10,
            color: t.orange,
            cursor: "pointer",
            textTransform: "none",
            letterSpacing: 0,
            fontWeight: 500,
          }}
        >
          {action}
        </span>
      )}
    </div>
  );
}
function KCard({ label, value, delta, deltaType, accent }) {
  const t = useTheme();
  const dc =
    deltaType === "up"
      ? "#16a34a"
      : deltaType === "down"
        ? "#dc2626"
        : t.orange;
  return (
    <div
      style={{
        background: t.card,
        border: `1px solid ${accent ? accent + "44" : t.border}`,
        borderRadius: 10,
        padding: 14,
      }}
    >
      <div
        style={{
          fontSize: 9,
          color: t.muted,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          fontWeight: 600,
          marginBottom: 7,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 24,
          fontWeight: 700,
          color: accent || t.white,
          letterSpacing: -0.8,
        }}
      >
        {value}
      </div>
      {delta && (
        <div style={{ fontSize: 10, color: dc, marginTop: 3 }}>{delta}</div>
      )}
    </div>
  );
}
function SBar({ placeholder, value, onChange }) {
  const t = useTheme();
  return (
    <input
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      style={{
        background: t.input,
        border: `1px solid ${t.border}`,
        borderRadius: 7,
        padding: "7px 11px",
        color: t.text1,
        fontSize: 12,
        outline: "none",
        width: "100%",
        marginBottom: 10,
      }}
    />
  );
}
function Chip({ label, active, onClick }) {
  const t = useTheme();
  return (
    <span
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 10px",
        borderRadius: 20,
        fontSize: 11,
        color: active ? t.orange : t.text2,
        border: `1px solid ${active ? t.orange + "44" : t.border}`,
        background: active ? t.orange + "18" : t.input,
        cursor: "pointer",
        marginRight: 5,
        marginBottom: 5,
        transition: "all .1s",
      }}
    >
      {label}
    </span>
  );
}
function Btn({ children, variant = "ghost", onClick, style, disabled }) {
  const t = useTheme();
  const V = {
    primary: { background: t.orange, color: "#fff", border: "none" },
    danger: {
      background: "#ef444418",
      color: "#dc2626",
      border: "1px solid #ef444428",
    },
    success: {
      background: "#22c55e18",
      color: "#16a34a",
      border: "1px solid #22c55e28",
    },
    ghost: {
      background: "transparent",
      color: t.text2,
      border: `1px solid ${t.border}`,
    },
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 12px",
        borderRadius: 7,
        fontSize: 11,
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        opacity: disabled ? 0.5 : 1,
        ...V[variant],
        ...style,
      }}
    >
      {children}
    </button>
  );
}
function Tog({ checked, onChange }) {
  const t = useTheme();
  return (
    <label
      style={{
        position: "relative",
        display: "inline-block",
        width: 32,
        height: 18,
        cursor: "pointer",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        style={{ opacity: 0, width: 0, height: 0 }}
      />
      <span
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: checked ? t.orange + "33" : t.border,
          border: checked ? `1px solid ${t.orange}55` : "none",
          borderRadius: 18,
          transition: ".2s",
        }}
      />
      <span
        style={{
          position: "absolute",
          top: 3,
          left: checked ? 14 : 3,
          width: 12,
          height: 12,
          borderRadius: "50%",
          background: checked ? t.orange : t.muted,
          transition: ".2s",
        }}
      />
    </label>
  );
}
function Tbl({ headers, rows }) {
  const t = useTheme();
  const TH = {
    fontSize: 9,
    color: t.thColor,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontWeight: 600,
    textAlign: "left",
    padding: "7px 8px",
    borderBottom: `1px solid ${t.border}`,
    whiteSpace: "nowrap",
  };
  return (
    <div className="ra-table-scroll">
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} style={TH}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{rows}</tbody>
      </table>
    </div>
  );
}
function TD({ children, style }) {
  const t = useTheme();
  return (
    <td
      style={{
        padding: "9px 8px",
        borderBottom: `1px solid ${t.rowAlt}`,
        fontSize: 12,
        color: t.text2,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {children}
    </td>
  );
}
function FG({ label, children, error }) {
  const t = useTheme();
  return (
    <div style={{ marginBottom: 12 }}>
      <label
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: t.text2,
          display: "block",
          textTransform: "uppercase",
          letterSpacing: 0.3,
          marginBottom: 5,
        }}
      >
        {label}
      </label>
      {children}
      {error && (
        <p style={{ fontSize: 11, color: "#dc2626", marginTop: 3 }}>{error}</p>
      )}
    </div>
  );
}
function Inp({
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  pattern,
  maxLength,
  autoComplete,
  invalid,
  style,
}) {
  const t = useTheme();
  return (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      type={type}
      inputMode={inputMode}
      pattern={pattern}
      maxLength={maxLength}
      autoComplete={autoComplete}
      style={{
        background: t.input,
        border: `1px solid ${invalid ? "#dc2626" : t.border}`,
        borderRadius: 7,
        padding: "8px 10px",
        color: t.text1,
        fontSize: 12,
        outline: "none",
        width: "100%",
        ...style,
      }}
    />
  );
}
function Sel({ value, onChange, children }) {
  const t = useTheme();
  return (
    <select
      value={value}
      onChange={onChange}
      style={{
        background: t.input,
        border: `1px solid ${t.border}`,
        borderRadius: 7,
        padding: "8px 10px",
        color: t.text1,
        fontSize: 12,
        outline: "none",
        width: "100%",
      }}
    >
      {children}
    </select>
  );
}
function Spinner() {
  const t = useTheme();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 40,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          border: `3px solid ${t.orange}33`,
          borderTop: `3px solid ${t.orange}`,
          borderRadius: "50%",
          animation: "spin .7s linear infinite",
        }}
      />
    </div>
  );
}
function Empty({ icon = "📭", text = "No data found" }) {
  const t = useTheme();
  return (
    <div style={{ textAlign: "center", padding: "40px 20px", color: t.muted }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{icon}</div>
      {text}
    </div>
  );
}

// Reset to page 1 whenever the filtered list shrinks or the user changes
// filters in a way that makes the current page out of range. Use the
// `resetKey` arg (typically a stringified set of filter values) to opt in.
function usePagination(items, defaultPageSize = 25, resetKey = "") {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  useEffect(() => {
    setPage(1);
  }, [resetKey, pageSize]);
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  const slice = items.slice(start, start + pageSize);
  return {
    page: safePage,
    setPage,
    pageSize,
    setPageSize,
    total,
    totalPages,
    slice,
    rangeStart: total === 0 ? 0 : start + 1,
    rangeEnd: Math.min(start + pageSize, total),
  };
}

function Pager({
  page,
  setPage,
  pageSize,
  setPageSize,
  total,
  totalPages,
  rangeStart,
  rangeEnd,
}) {
  const t = useTheme();
  if (total === 0) return null;
  const sizes = [25, 50, 100, 200];
  const btn = (label, onClick, disabled) => (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "4px 9px",
        fontSize: 11,
        fontWeight: 600,
        background: disabled ? "transparent" : t.input,
        color: disabled ? t.muted : t.text1,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {label}
    </button>
  );
  // Compact page-window: first, current ± 2, last, with ellipses.
  const win = new Set([1, totalPages, page - 1, page, page + 1]);
  const pages = Array.from(win)
    .filter((p) => p >= 1 && p <= totalPages)
    .sort((a, b) => a - b);
  const items = [];
  for (let i = 0; i < pages.length; i++) {
    if (i > 0 && pages[i] - pages[i - 1] > 1) items.push("…");
    items.push(pages[i]);
  }
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 4px 0",
        fontSize: 11,
        color: t.muted,
        flexWrap: "wrap",
      }}
    >
      <span>
        {rangeStart}–{rangeEnd} of {total}
      </span>
      <div style={{ flex: 1 }} />
      <span>per page:</span>
      <select
        value={pageSize}
        onChange={(e) => setPageSize(Number(e.target.value))}
        style={{
          background: t.input,
          color: t.text1,
          border: `1px solid ${t.border}`,
          borderRadius: 6,
          padding: "3px 6px",
          fontSize: 11,
        }}
      >
        {sizes.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
        {btn("‹", () => setPage(page - 1), page <= 1)}
        {items.map((p, i) =>
          p === "…" ? (
            <span
              key={`gap-${i}`}
              style={{ padding: "4px 6px", color: t.muted, fontSize: 11 }}
            >
              …
            </span>
          ) : (
            <button
              key={p}
              onClick={() => setPage(p)}
              style={{
                padding: "4px 9px",
                fontSize: 11,
                fontWeight: 600,
                background: p === page ? t.orange : t.input,
                color: p === page ? "#fff" : t.text1,
                border: `1px solid ${p === page ? t.orange : t.border}`,
                borderRadius: 6,
                cursor: "pointer",
                minWidth: 28,
              }}
            >
              {p}
            </button>
          ),
        )}
        {btn("›", () => setPage(page + 1), page >= totalPages)}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  RECIPIENT PICKER — multi-select user/vendor list with search.
//  Used by both the slide-in NotificationPanel and the full-page
//  Notifications page so the "Specific people" send mode looks the
//  same everywhere. Filters by role, shows last-seen + token status,
//  and surfaces a count of how many devices the send will reach.
// ─────────────────────────────────────────────────────────────────
function RecipientPicker({ users, vendors, value, onChange, t }) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all"); // all|customer|vendor

  // Build a unified list. Vendor records that have an authUid are
  // matched to their users/{uid} doc so we don't double-count people
  // who registered through the vendor flow.
  const userList = useMemo(() => {
    const vendorByAuthUid = new Map();
    (vendors || []).forEach((v) => {
      if (v.authUid) vendorByAuthUid.set(v.authUid, v);
    });
    return (users || [])
      .filter((u) => !u.deletedAt)
      .map((u) => {
        const matchedVendor = vendorByAuthUid.get(u.uid || u.id);
        const role = matchedVendor || u.role === "vendor" ? "vendor" : "customer";
        return {
          uid: u.uid || u.id,
          name:
            matchedVendor?.businessName ||
            u.name ||
            u.email ||
            "(no name)",
          email: u.email || "",
          phone: u.phone || "",
          city: matchedVendor?.city || u.city || "",
          role,
          hasToken: typeof u.fcmToken === "string" && u.fcmToken.length > 0,
        };
      });
  }, [users, vendors]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return userList.filter((u) => {
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (!q) return true;
      return (
        u.name.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.phone.toLowerCase().includes(q) ||
        u.city.toLowerCase().includes(q)
      );
    });
  }, [userList, search, roleFilter]);

  const selectedSet = useMemo(() => new Set(value || []), [value]);
  const toggle = (uid) => {
    const next = new Set(selectedSet);
    if (next.has(uid)) next.delete(uid);
    else next.add(uid);
    onChange(Array.from(next));
  };
  const selectAll = () =>
    onChange(Array.from(new Set([...selectedSet, ...filtered.map((u) => u.uid)])));
  const clearAll = () =>
    onChange((value || []).filter((uid) => !filtered.some((u) => u.uid === uid)));

  const tokenCount = (value || []).filter((uid) =>
    userList.find((u) => u.uid === uid && u.hasToken),
  ).length;

  return (
    <div
      style={{
        border: `1px solid ${t.border}`,
        borderRadius: 10,
        background: t.input,
        padding: 10,
      }}
    >
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, email, phone, city…"
          style={{
            flex: 1,
            background: t.card,
            border: `1px solid ${t.border}`,
            borderRadius: 7,
            padding: "7px 10px",
            color: t.text1,
            fontSize: 12,
            outline: "none",
          }}
        />
        <Sel
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value)}
          style={{ width: 110 }}
        >
          <option value="all">All</option>
          <option value="customer">Customers</option>
          <option value="vendor">Vendors</option>
        </Sel>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 6,
          fontSize: 11,
        }}
      >
        <span style={{ color: t.text1, fontWeight: 600 }}>
          {(value || []).length} selected · {tokenCount} reachable
        </span>
        <span style={{ display: "flex", gap: 8 }}>
          <button
            onClick={selectAll}
            type="button"
            style={{
              background: "transparent",
              border: "none",
              color: t.orange,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              padding: 0,
            }}
          >
            Select shown
          </button>
          <button
            onClick={clearAll}
            type="button"
            style={{
              background: "transparent",
              border: "none",
              color: t.muted,
              cursor: "pointer",
              fontSize: 11,
              fontWeight: 600,
              padding: 0,
            }}
          >
            Clear shown
          </button>
        </span>
      </div>

      <div
        style={{
          maxHeight: 240,
          overflowY: "auto",
          background: t.card,
          border: `1px solid ${t.border}`,
          borderRadius: 8,
        }}
      >
        {filtered.length === 0 && (
          <div style={{ padding: 14, fontSize: 11, color: t.muted }}>
            No matches.
          </div>
        )}
        {filtered.slice(0, 200).map((u) => {
          const sel = selectedSet.has(u.uid);
          return (
            <div
              key={u.uid}
              onClick={() => toggle(u.uid)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderBottom: `1px dashed ${t.border}`,
                cursor: "pointer",
                background: sel ? t.activeNavBg : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={sel}
                onChange={() => toggle(u.uid)}
                onClick={(e) => e.stopPropagation()}
                style={{ accentColor: t.orange }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 12,
                    color: t.text1,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {u.name}
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: 0.5,
                      padding: "1px 6px",
                      borderRadius: 999,
                      background:
                        u.role === "vendor" ? "#dbeafe" : "#f3f4f6",
                      color:
                        u.role === "vendor" ? "#1e40af" : t.muted,
                    }}
                  >
                    {u.role.toUpperCase()}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: t.muted,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {[u.email, u.phone, u.city].filter(Boolean).join(" · ") || "—"}
                </div>
              </div>
              <span
                title={u.hasToken ? "Will receive push" : "No FCM token registered"}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: u.hasToken ? "#22c55e" : "#cbd5e1",
                  flexShrink: 0,
                }}
              />
            </div>
          );
        })}
        {filtered.length > 200 && (
          <div
            style={{
              padding: "8px 10px",
              fontSize: 10,
              color: t.muted,
              textAlign: "center",
            }}
          >
            Showing first 200 of {filtered.length}. Refine the search to see more.
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  NOTIFICATION PANEL (slide-in from right)
// ─────────────────────────────────────────────────────────────────
function NotificationPanel({ open, onClose }) {
  const t = useTheme();
  const { notifications, adminUser, users, vendors } = useAdmin();
  const [tab, setTab] = useState("history");
  // mode = "topic"  → FCM topic broadcast (fastest, requires devices
  //                   subscribed to the topic)
  //      | "tokens" → per-device fan-out across all users in audience
  //      | "users"  → admin picks a specific list of uids; only those
  //                   users get the notification (in-app + push)
  const [form, setForm] = useState({
    title: "",
    body: "",
    topic: "all",
    mode: "topic",
    selectedUids: [],
  });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null); // { ok: bool, msg: string }

  const handleSend = async () => {
    const title = form.title.trim();
    const body = form.body.trim();
    if (title.length < 3 || title.length > 100) {
      setResult({ ok: false, msg: "Title must be 3–100 characters." });
      return;
    }
    if (body.length < 3 || body.length > 500) {
      setResult({ ok: false, msg: "Body must be 3–500 characters." });
      return;
    }
    if (form.mode === "users" && form.selectedUids.length === 0) {
      setResult({ ok: false, msg: "Pick at least one recipient." });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      // Per-token fallback: only valid for the audience-level topics; we don't
      // support per-token for city-segment topics yet (no city field on user
      // docs). Fall back to topic delivery in that case.
      const useTokens =
        form.mode === "tokens" &&
        (form.topic === "all" ||
          form.topic === "users" ||
          form.topic === "vendors");
      const useUserPicker = form.mode === "users";

      const audience = form.topic === "vendors" ? "vendors" : "users";

      const r = useUserPicker
        ? await sendNotificationToUsers({
            title,
            body,
            uids: form.selectedUids,
            sentBy: adminUser?.email || "admin",
          })
        : useTokens
        ? await sendNotificationToAudience({
            title,
            body,
            audience,
            sentBy: adminUser?.email || "admin",
          })
        : await sendNotification({
            ...form,
            sentBy: adminUser?.email || "admin",
          });

      await logAudit(
        "broadcast_sent",
        "notification",
        form.topic || "all",
        {
          entityName: form.title,
          topic: useUserPicker
            ? `selected:${form.selectedUids.length}`
            : form.topic || "all",
          mode: useUserPicker ? "users" : useTokens ? "tokens" : "topic",
          body: form.body,
          deliveryStatus: r?.deliveryStatus,
          successCount: r?.successCount,
          failureCount: r?.failureCount,
          recipients: r?.recipients,
        },
        adminUser,
      );
      if (
        r?.deliveryStatus === "delivered" ||
        r?.deliveryStatus === "delivered_legacy"
      ) {
        setResult({
          ok: true,
          msg: useUserPicker
            ? `Saved and pushed to ${r.successCount} of ${r.recipients} recipients` +
              (r.failureCount ? ` (${r.failureCount} failed).` : ".")
            : useTokens
            ? `Saved and pushed to ${r.successCount} device(s)${
                r.failureCount ? ` (${r.failureCount} failed)` : ""
              }.`
            : r.deliveryStatus === "delivered_legacy"
            ? "Sent via legacy Cloud Function."
            : "Saved and pushed to subscribers.",
        });
      } else if (r?.deliveryStatus === "partial") {
        setResult({
          ok: true,
          msg: `Sent to ${r.successCount}/${r.sentTokens} devices. ${r.failureCount} failed.`,
        });
      } else if (r?.deliveryStatus === "no_tokens") {
        setResult({
          ok: false,
          msg: useUserPicker
            ? `Saved to ${r.recipients} inbox(es), but none of them have a registered device.`
            : "Saved, but no devices have registered an FCM token yet.",
        });
      } else {
        setResult({
          ok: false,
          msg:
            "Saved to history but push failed: " +
            (r?.deliveryError || "unknown error"),
        });
      }
      setTimeout(() => setResult(null), 6000);
      setForm({
        title: "",
        body: "",
        topic: "all",
        mode: "topic",
        selectedUids: [],
      });
    } catch (e) {
      setResult({ ok: false, msg: e.message || "Send failed." });
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "#0005",
            zIndex: 998,
          }}
        />
      )}

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: "min(360px, 100vw)",
          maxWidth: "100vw",
          height: "100vh",
          background: t.sidebar,
          borderLeft: `1px solid ${t.border}`,
          zIndex: 999,
          display: "flex",
          flexDirection: "column",
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform .25s ease",
          boxShadow: open ? "-8px 0 32px #0003" : "none",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 18px",
            borderBottom: `1px solid ${t.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>
            Notifications
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 18,
              color: t.text2,
              cursor: "pointer",
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            borderBottom: `1px solid ${t.border}`,
            flexShrink: 0,
          }}
        >
          {[
            ["history", "History"],
            ["send", "Send New"],
          ].map(([k, l]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              style={{
                flex: 1,
                padding: "10px 0",
                background: "transparent",
                border: "none",
                borderBottom: `2px solid ${tab === k ? t.orange : "transparent"}`,
                color: tab === k ? t.orange : t.text2,
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
                transition: "all .15s",
              }}
            >
              {l}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
          {/* Send tab */}
          {tab === "send" && (
            <>
              {result && (
                <div
                  style={{
                    background: result.ok ? "#dcfce7" : "#fef2f2",
                    border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`,
                    borderRadius: 8,
                    padding: "10px 12px",
                    marginBottom: 12,
                    fontSize: 12,
                    color: result.ok ? "#16a34a" : "#dc2626",
                    fontWeight: 600,
                    lineHeight: 1.4,
                  }}
                >
                  {result.ok ? "✓ " : "⚠ "}
                  {result.msg}
                </div>
              )}
              <FG label="Title (max 100)">
                <Inp
                  value={form.title}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, title: e.target.value }))
                  }
                  placeholder="e.g. Road Closure Alert"
                  maxLength={100}
                />
              </FG>
              <FG label="Body (max 500)">
                <textarea
                  value={form.body}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, body: e.target.value }))
                  }
                  placeholder="Notification message..."
                  rows={3}
                  maxLength={500}
                  style={{
                    background: t.input,
                    border: `1px solid ${t.border}`,
                    borderRadius: 7,
                    padding: "8px 10px",
                    color: t.text1,
                    fontSize: 12,
                    outline: "none",
                    width: "100%",
                    resize: "vertical",
                  }}
                />
              </FG>
              <FG label="Delivery method">
                <Sel
                  value={form.mode}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, mode: e.target.value }))
                  }
                >
                  <option value="topic">Topic broadcast — by audience (fastest)</option>
                  <option value="tokens">Per-device tokens — by audience</option>
                  <option value="users">Specific people — pick from a list</option>
                </Sel>
              </FG>
              {form.mode !== "users" && (
                <FG label="Recipients">
                  <Sel
                    value={form.topic}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, topic: e.target.value }))
                    }
                  >
                    <option value="all">All Users</option>
                    <option value="karachi">Karachi Only</option>
                    <option value="lahore">Lahore Only</option>
                    <option value="vendors">All Vendors</option>
                  </Sel>
                </FG>
              )}
              {form.mode === "users" && (
                <FG label="Pick recipients">
                  <RecipientPicker
                    users={users}
                    vendors={vendors}
                    value={form.selectedUids}
                    onChange={(next) =>
                      setForm((p) => ({ ...p, selectedUids: next }))
                    }
                    t={t}
                  />
                </FG>
              )}
              <Btn
                variant="primary"
                onClick={handleSend}
                disabled={sending || !form.title || !form.body}
                style={{
                  width: "100%",
                  justifyContent: "center",
                  marginTop: 4,
                }}
              >
                {sending ? "Sending…" : "Send Notification"}
              </Btn>
            </>
          )}

          {/* History tab */}
          {tab === "history" && (
            <>
              {notifications.length === 0 && (
                <Empty icon="🔔" text="No notifications sent yet" />
              )}
              {notifications.map((n, i) => (
                <div
                  key={n.id || i}
                  style={{
                    padding: "10px 0",
                    borderBottom: `1px solid ${t.border}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      marginBottom: 3,
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: t.text1,
                        flex: 1,
                      }}
                    >
                      {n.title}
                    </div>
                    <Badge
                      status={
                        n.topic === "all"
                          ? "broadcast"
                          : n.topic === "vendors"
                            ? "segment"
                            : "targeted"
                      }
                      text={n.topic}
                    />
                  </div>
                  <div
                    style={{ fontSize: 11, color: t.text2, marginBottom: 4 }}
                  >
                    {n.body}
                  </div>
                  <div style={{ fontSize: 10, color: t.muted }}>
                    By {n.sentBy} ·{" "}
                    {toDate(n.sentAt)?.toLocaleString() || "Just now"}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
//  ADD VENDOR MODAL
// ─────────────────────────────────────────────────────────────────
// Used for both Add and Edit. Pass `existing` (a vendor doc) to enter edit
// mode — title, button label, submit action and field prefill all switch.
function AddVendorModal({ onClose, existing }) {
  const t = useTheme();
  const { adminUser } = useAdmin();
  const editing = Boolean(existing);
  // Stable per-modal UUID — used as the R2 prefix for any docs uploaded
  // before the Firestore vendor doc is written. In edit mode we reuse the
  // vendor's existing applicationId so file replacements land in the same
  // folder.
  const [applicationId] = useState(() => {
    if (existing?.applicationId) return existing.applicationId;
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    });
  });
  const [form, setForm] = useState(() => ({
    name:
      existing?.name || existing?.businessName || existing?.ownerName || "",
    category: existing?.category || "",
    phone: existing?.phone || "",
    whatsapp: existing?.whatsapp || "",
    city: existing?.city || "",
    address: existing?.address || "",
    lat: existing?.lat != null ? String(existing.lat) : "",
    lng: existing?.lng != null ? String(existing.lng) : "",
    operatingHours: existing?.operatingHours || "9am-9pm",
    costRange: existing?.costRange || "",
    status: existing?.status || "pending",
    vehicleReg: existing?.vehicleReg || "",
    // Login credentials. Required for new vendors so they can sign into
    // the mobile app. On edit we leave them blank — the auth account
    // already exists, identified by `authUid` below.
    email: existing?.email || "",
    password: "",
    // Existing Firebase Auth UID. Auto-populated from the vendor doc so
    // admin can verify or edit the link. If empty when adding, we'll
    // create a new account from email/password.
    authUid: existing?.authUid || "",
  }));
  // R2 paths — prefilled from existing.documents in edit mode. We keep a
  // snapshot of the original paths so cancel/submit can correctly clean up
  // orphans without touching the admin's still-valid existing files.
  const initialUploads = {
    cnic: existing?.documents?.cnicPath || null,
    license: existing?.documents?.licensePath || null,
    photo: existing?.documents?.photoPath || null,
  };
  const [uploads, setUploads] = useState(initialUploads);
  const originalUploadsRef = useRef(initialUploads);
  const [progress, setProgress] = useState({ cnic: 0, license: 0, photo: 0 });
  const [uploadErrs, setUploadErrs] = useState({});
  const [fieldErrs, setFieldErrs] = useState({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const fileRefs = useRef({});
  const set = (k, val) => {
    setForm((p) => ({ ...p, [k]: val }));
    setFieldErrs((p) => ({ ...p, [k]: undefined }));
  };

  const validateForm = () => {
    const e = {};
    e.name = check(
      form.name,
      V.required("Business name is required"),
      V.minLength(2, "Too short"),
      V.maxLength(120, "Too long"),
    );
    if (!form.category) e.category = "Select a category";
    e.phone = V.pakPhone(form.phone);
    e.whatsapp = V.pakPhoneOptional(form.whatsapp);
    if (!form.city) e.city = "Select a city";
    e.address = V.maxLength(500, "Address too long")(form.address || "");
    e.lat = V.lat(form.lat);
    e.lng = V.lng(form.lng);
    e.operatingHours = V.maxLength(60, "Too long")(form.operatingHours || "");
    if (form.costRange && form.costRange.trim()) {
      e.costRange = V.costRange(form.costRange);
    }
    // Auth credentials: required when adding a new vendor unless the admin
    // is linking an existing Firebase Auth account by uid.
    if (!editing) {
      const hasAuthUid = (form.authUid || "").trim().length > 0;
      if (!hasAuthUid) {
        if (!form.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
          e.email = "Vendor login email is required";
        }
        if (!form.password || form.password.length < 6) {
          e.password = "At least 6 characters";
        }
      }
    }
    for (const k of Object.keys(e)) if (!e[k]) delete e[k];
    setFieldErrs(e);
    return Object.keys(e).length === 0;
  };

  const isR2Path = (p) => p && !/^https?:/i.test(p);

  const handleFile = async (key, file) => {
    if (!file) return;
    setUploadErrs((p) => ({ ...p, [key]: null }));
    setProgress((p) => ({ ...p, [key]: 0 }));
    try {
      const newPath = await uploadFile(file, applicationId, key, (pct) =>
        setProgress((p) => ({ ...p, [key]: pct })),
      );
      // Clean up the orphan if this slot already had an interim upload
      // (from earlier in this same modal session). The *original* upload
      // is left alone until submit confirms — otherwise cancelling would
      // lose data.
      const prev = uploads[key];
      const original = originalUploadsRef.current[key];
      if (prev && prev !== original && prev !== newPath && isR2Path(prev)) {
        try { await deleteVendorDoc(prev); } catch {}
      }
      setUploads((p) => ({ ...p, [key]: newPath }));
    } catch (e) {
      setUploadErrs((p) => ({ ...p, [key]: e.message || "upload_failed" }));
    }
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      setErr("Fix the highlighted fields and try again.");
      return;
    }
    setErr("");
    setLoading(true);
    try {
      // If admin picks "verified" in the Status field, treat the vendor as
      // KYC-approved too — they're skipping the queue.
      const isVerified = form.status === "verified";

      // Resolve the vendor's Firebase Auth uid:
      //   • Edit mode  → reuse existing.authUid
      //   • Admin pasted a uid → use that (links to an existing account)
      //   • Otherwise (new vendor + email/password) → create the account
      //     server-side via /api/users/create with role:'vendor'. The API
      //     also writes users/{uid} with role so the mobile app routes
      //     them to the vendor surface on first sign-in.
      let resolvedAuthUid = (form.authUid || "").trim();
      if (!editing && !resolvedAuthUid) {
        try {
          const created = await adminCreateAuthAccount({
            email: form.email.trim(),
            password: form.password,
            name: form.name,
            phone: form.phone,
            role: "vendor",
          });
          resolvedAuthUid = created.uid;
        } catch (authErr) {
          const code = authErr.code || authErr.message || "";
          if (code === "email_already_exists") {
            setFieldErrs((p) => ({
              ...p,
              email:
                "An account with this email already exists. Paste its UID below to link it.",
            }));
          } else if (code === "invalid_email") {
            setFieldErrs((p) => ({ ...p, email: "Invalid email address." }));
          } else if (code === "password_min_6") {
            setFieldErrs((p) => ({
              ...p,
              password: "Password must be at least 6 characters.",
            }));
          } else {
            setErr("Couldn't create the vendor's login account: " + code);
          }
          setLoading(false);
          return;
        }
      }

      // Strip credential fields from the vendor doc — they live in
      // Firebase Auth, not Firestore.
      const { password, ...formForVendorDoc } = form;
      const payload = {
        ...formForVendorDoc,
        businessName: form.name,
        ownerName: existing?.ownerName || form.name,
        applicationId,
        authUid: resolvedAuthUid,
        kyc: isVerified ? "approved" : existing?.kyc || "pending",
        isVerified,
        // Source field is required by SCHEMA.md. Self-registration sets
        // it to 'self_registration'; admin-created vendors are 'seed'.
        // Preserve existing value on edits so we don't lose the original
        // origin marker.
        source: existing?.source || "seed",
        lat: parseFloat(form.lat) || 24.8607,
        lng: parseFloat(form.lng) || 67.0011,
        documents: {
          cnicPath: uploads.cnic,
          licensePath: uploads.license,
          photoPath: uploads.photo,
        },
      };
      if (editing) {
        await updateVendor(existing.id, payload);
        await logAudit(
          "vendor_updated",
          "vendor",
          existing.id,
          { entityName: form.name, applicationId },
          adminUser,
        );
      } else {
        await addVendor(payload);
        await logAudit(
          "vendor_created",
          "vendor",
          form.name,
          { entityName: form.name, applicationId },
          adminUser,
        );
      }
      // After successful save, replaced originals are now safe to delete.
      const original = originalUploadsRef.current;
      for (const key of ["cnic", "license", "photo"]) {
        if (
          original[key] &&
          isR2Path(original[key]) &&
          original[key] !== uploads[key]
        ) {
          try { await deleteVendorDoc(original[key]); } catch {}
        }
      }
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  // If admin cancels, only delete files uploaded *this session* (i.e. paths
  // that differ from the snapshot at modal open). The originals stay intact.
  const handleCancel = async () => {
    const original = originalUploadsRef.current;
    const cleanup = [];
    for (const key of ["cnic", "license", "photo"]) {
      const cur = uploads[key];
      if (cur && cur !== original[key] && isR2Path(cur)) cleanup.push(cur);
    }
    onClose();
    for (const p of cleanup) {
      try { await deleteVendorDoc(p); } catch {}
    }
  };

  return (
    <>
      <div
        onClick={handleCancel}
        style={{
          position: "fixed",
          inset: 0,
          background: "#0006",
          zIndex: 1000,
        }}
      />
      <div
        className="ra-modal"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 540,
          maxWidth: "95vw",
          background: t.sidebar,
          borderRadius: 16,
          zIndex: 1001,
          overflow: "hidden",
          border: `1px solid ${t.border}`,
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${t.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>
            {editing ? "Edit Vendor" : "Add New Vendor"}
          </div>
          <button
            onClick={handleCancel}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 18,
              color: t.text2,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 20, maxHeight: "70vh", overflowY: "auto" }}>
          {err && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
                color: "#dc2626",
                marginBottom: 12,
              }}
            >
              {err}
            </div>
          )}
          <div
            className="ra-form-grid"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <FG label="Business Name *" error={fieldErrs.name}>
              <Inp
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="AutoFix Garage"
                maxLength={120}
                autoComplete="organization"
                invalid={!!fieldErrs.name}
              />
            </FG>
            <FG label="Service Category *" error={fieldErrs.category}>
              <Sel
                value={form.category}
                onChange={(e) => set("category", e.target.value)}
              >
                <option value="">Select…</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Sel>
            </FG>
            <FG label="Phone *" error={fieldErrs.phone}>
              <Inp
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+92 300 1234567"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                invalid={!!fieldErrs.phone}
              />
            </FG>
            <FG label="WhatsApp" error={fieldErrs.whatsapp}>
              <Inp
                value={form.whatsapp}
                onChange={(e) => set("whatsapp", e.target.value)}
                placeholder="+92 300 1234567"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                maxLength={20}
                invalid={!!fieldErrs.whatsapp}
              />
            </FG>
            <FG label="City *" error={fieldErrs.city}>
              <Sel
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              >
                <option value="">Select…</option>
                {CITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Sel>
            </FG>
            <FG label="Operating Hours" error={fieldErrs.operatingHours}>
              <Inp
                value={form.operatingHours}
                onChange={(e) => set("operatingHours", e.target.value)}
                maxLength={60}
                invalid={!!fieldErrs.operatingHours}
              />
            </FG>
            <FG label="Cost Range" error={fieldErrs.costRange}>
              <Inp
                value={form.costRange}
                onChange={(e) => set("costRange", e.target.value)}
                placeholder="Rs. 500 – 2,000"
                maxLength={60}
                invalid={!!fieldErrs.costRange}
              />
            </FG>
            <FG label="Status">
              <Sel
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
              >
                <option value="pending">Pending</option>
                <option value="verified">Verified</option>
              </Sel>
            </FG>
            <div style={{ gridColumn: "1/-1" }}>
              <FG label="Address" error={fieldErrs.address}>
                <Inp
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  placeholder="Full address"
                  maxLength={500}
                  autoComplete="street-address"
                  invalid={!!fieldErrs.address}
                />
              </FG>
            </div>
            <FG label="GPS Lat" error={fieldErrs.lat}>
              <Inp
                value={form.lat}
                onChange={(e) => set("lat", e.target.value)}
                placeholder="24.8607"
                inputMode="decimal"
                pattern="-?[0-9]+(\.[0-9]+)?"
                maxLength={12}
                invalid={!!fieldErrs.lat}
              />
            </FG>
            <FG label="GPS Lng" error={fieldErrs.lng}>
              <Inp
                value={form.lng}
                onChange={(e) => set("lng", e.target.value)}
                placeholder="67.0011"
                inputMode="decimal"
                pattern="-?[0-9]+(\.[0-9]+)?"
                maxLength={12}
                invalid={!!fieldErrs.lng}
              />
            </FG>
            <div
              style={{
                gridColumn: "1/-1",
                borderTop: `1px solid ${t.border}`,
                paddingTop: 12,
                marginTop: 4,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: t.muted,
                  fontWeight: 600,
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {editing ? "Login Account" : "Login Credentials *"}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: t.muted,
                  marginBottom: 10,
                  lineHeight: 1.5,
                }}
              >
                {editing
                  ? "This vendor's mobile-app login is identified by the Auth UID below. Leave it blank if you haven't created an account for them yet."
                  : "We'll create a Firebase Auth account so the vendor can sign into the mobile app and accept jobs. If they already have an account (e.g. they self-registered), paste the existing Auth UID instead."}
              </div>
              {!editing && (
                <div
                  className="ra-form-grid"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: 12,
                    marginBottom: 10,
                  }}
                >
                  <FG label="Login email" error={fieldErrs.email}>
                    <Inp
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="vendor@example.com"
                      type="email"
                      autoComplete="off"
                      maxLength={120}
                      invalid={!!fieldErrs.email}
                    />
                  </FG>
                  <FG label="Login password" error={fieldErrs.password}>
                    <Inp
                      value={form.password}
                      onChange={(e) => set("password", e.target.value)}
                      placeholder="At least 6 characters"
                      type="password"
                      autoComplete="new-password"
                      maxLength={120}
                      invalid={!!fieldErrs.password}
                    />
                  </FG>
                </div>
              )}
              <FG label="Auth UID (optional — link existing account)">
                <Inp
                  value={form.authUid}
                  onChange={(e) => set("authUid", e.target.value)}
                  placeholder="abc123XYZ…"
                  maxLength={64}
                  autoComplete="off"
                />
              </FG>
            </div>
            <div
              style={{
                gridColumn: "1/-1",
                borderTop: `1px solid ${t.border}`,
                paddingTop: 12,
                marginTop: 4,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  color: t.muted,
                  fontWeight: 600,
                  marginBottom: 8,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                Documents (optional)
              </div>
              <div style={{ display: "grid", gap: 8 }}>
                {[
                  { key: "cnic", label: "CNIC" },
                  { key: "license", label: "License / Certificate" },
                  { key: "photo", label: "Owner Photo" },
                ].map(({ key, label }) => (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      flexWrap: "wrap",
                    }}
                  >
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      ref={(el) => (fileRefs.current[key] = el)}
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        handleFile(key, f);
                      }}
                    />
                    <Btn
                      style={{ padding: "4px 10px", fontSize: 11, minWidth: 130 }}
                      onClick={() => fileRefs.current[key]?.click()}
                    >
                      {uploads[key] ? `Replace ${label}` : `Upload ${label}`}
                    </Btn>
                    <div
                      style={{
                        fontSize: 11,
                        color: t.muted,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {uploadErrs[key] ? (
                        <span style={{ color: "#dc2626" }}>{uploadErrs[key]}</span>
                      ) : uploads[key] ? (
                        <span style={{ color: "#16a34a" }}>✓ Uploaded</span>
                      ) : progress[key] > 0 && progress[key] < 100 ? (
                        <span>Uploading… {progress[key]}%</span>
                      ) : (
                        "—"
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div
          style={{
            padding: "14px 20px",
            borderTop: `1px solid ${t.border}`,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <Btn onClick={handleCancel}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSubmit} disabled={loading}>
            {loading
              ? "Saving…"
              : editing
              ? "Save Changes"
              : "Add Vendor"}
          </Btn>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
//  PAGES
// ─────────────────────────────────────────────────────────────────
function Dashboard() {
  const t = useTheme();
  const { vendors, users, requests, sos } = useAdmin();
  const TT = {
    background: t.ttBg,
    border: `1px solid ${t.ttBdr}`,
    borderRadius: 8,
    fontSize: 11,
    color: t.text1,
  };
  // "Live" = anything currently being worked on. Includes legacy
  // `in_progress` so we don't lose count of older Firestore docs.
  const liveJobs = requests.filter((r) =>
    ["accepted", "onTheWay", "arrived", "in_progress"].includes(r.status),
  ).length;
  const sosToday = sos.filter((s) => {
    const d = toDate(s.createdAt);
    return d && new Date() - d < 86400000;
  }).length;

  return (
    <>
      <div
        className="ra-stat-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6,1fr)",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <KCard
          label="Total Users"
          value={users.length || "—"}
          delta="Live from Supabase"
          accent={t.orange}
        />
        <KCard
          label="Active Vendors"
          value={
            vendors.filter((v) => !v.deletedAt && v.status === "verified")
              .length || "—"
          }
          delta="Verified only"
          accent="#22c55e"
        />
        <KCard
          label="Live Jobs"
          value={liveJobs}
          delta="● real-time"
          accent={t.orange}
        />
        <KCard
          label="SOS Today"
          value={sosToday}
          delta="Last 24h"
          accent="#ef4444"
        />
        <KCard
          label="Pending KYC"
          value={
            vendors.filter((v) => !v.deletedAt && v.kyc === "pending").length
          }
          delta="Needs review"
          accent="#f59e0b"
        />
        <KCard
          label="Total Requests"
          value={requests.length}
          delta="All time"
        />
      </div>
      <div
        className="ra-chart-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Card>
          <CT action="7-day chart">Requests Trend</CT>
          <ResponsiveContainer width="100%" height={170}>
            <LineChart data={chartData}>
              <XAxis
                dataKey="day"
                tick={{ fill: t.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: t.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={TT} />
              <Line
                type="monotone"
                dataKey="requests"
                stroke={t.orange}
                strokeWidth={2}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <CT>Category Split</CT>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <PieChart width={140} height={140}>
              <Pie
                data={getCatData(t.orange)}
                cx={70}
                cy={70}
                innerRadius={40}
                outerRadius={65}
                dataKey="value"
                stroke="none"
              >
                {getCatData(t.orange).map((e, i) => (
                  <Cell key={i} fill={e.color} />
                ))}
              </Pie>
            </PieChart>
            <div>
              {getCatData(t.orange).map((c) => (
                <div
                  key={c.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    marginBottom: 5,
                    fontSize: 11,
                    color: t.text2,
                  }}
                >
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 2,
                      background: c.color,
                      display: "inline-block",
                    }}
                  />
                  {c.name}
                  <span style={{ color: t.muted, marginLeft: 2 }}>
                    {c.value}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
      <div
        className="ra-chart-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "2fr 1fr",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <Card>
          <CT>Recent Requests</CT>
          {requests.length === 0 ? (
            <Empty />
          ) : (
            <Tbl
              headers={["Customer", "Vendor", "Category", "Status", "Time"]}
              rows={requests.slice(0, 6).map((r, i) => (
                <tr key={r.id || i}>
                  <TD style={{ fontSize: 12 }}>
                    {r.customerName || r.cust || "—"}
                  </TD>
                  <TD style={{ fontSize: 12 }}>
                    {r.vendorName || r.vendor || "—"}
                  </TD>
                  <TD>
                    <CatDot cat={r.category || r.cat || "Mechanic"} />
                  </TD>
                  <TD>
                    <Badge status={r.status} />
                  </TD>
                  <TD style={{ fontSize: 10, color: t.muted }}>
                    {r.createdAt ? toDate(s.createdAt) : null?.toLocaleTimeString() || "—"}
                  </TD>
                </tr>
              ))}
            />
          )}
        </Card>
        <Card>
          <CT>
            <span>
              SOS Alerts{" "}
              <span style={{ color: "#ef4444", fontSize: 10 }}>● Live</span>
            </span>
          </CT>
          {sos.length === 0 ? (
            <Empty icon="🆘" text="No SOS events" />
          ) : (
            sos.slice(0, 3).map((s, i) => (
              <div
                key={s.id || i}
                style={{
                  background: "#dc26260d",
                  border: "1px solid #dc262622",
                  borderRadius: 8,
                  padding: "9px 11px",
                  marginBottom: 7,
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: s.resolved ? "#22c55e" : "#ef4444",
                    flexShrink: 0,
                  }}
                />
                <div>
                  <div
                    style={{ fontSize: 12, fontWeight: 600, color: t.text1 }}
                  >
                    {s.userName || s.user || "User"}
                  </div>
                  <div style={{ fontSize: 10, color: "#b45309", marginTop: 2 }}>
                    {s.location || s.loc || "—"}
                  </div>
                </div>
              </div>
            ))
          )}
        </Card>
      </div>
      <div className="ra-chart-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <CT>Revenue ₨ — Last 7 Days</CT>
          <ResponsiveContainer width="100%" height={140}>
            <BarChart data={chartData}>
              <XAxis
                dataKey="day"
                tick={{ fill: t.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: t.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={TT}
                formatter={(v) => [`₨ ${v.toLocaleString()}`, "Revenue"]}
              />
              <Bar dataKey="revenue" fill={t.orange} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <CT>Top Vendors</CT>
          {vendors.filter((v) => !v.deletedAt).slice(0, 4).map((v, i) => (
            <div
              key={v.id || i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginBottom: 10,
              }}
            >
              <span style={{ fontSize: 11, color: t.muted, width: 12 }}>
                {i + 1}
              </span>
              <Av
                initials={(v.name || v.businessName || v.ownerName || "V").slice(0, 2).toUpperCase()}
                color={getCatColors(t.orange)[v.category] || t.orange}
                size={24}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12, color: t.text1 }}>
                  {v.name || v.businessName || v.ownerName || "—"}
                </div>
                <div style={{ fontSize: 10, color: t.muted }}>{v.category}</div>
              </div>
              <Stars n={v.rating || 0} />
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}

// Used for both Add and Edit. Pass `existing` (a user doc) for edit mode.
function AddUserModal({ onClose, existing }) {
  const t = useTheme();
  const { adminUser } = useAdmin();
  const editing = Boolean(existing);
  const [form, setForm] = useState(() => ({
    name: existing?.name || "",
    email: existing?.email || "",
    phone: existing?.phone || "",
    city: existing?.city || "",
    status: existing?.status || "active",
    password: "",
    confirmPassword: "",
  }));
  const [errs, setErrs] = useState({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrs((p) => ({ ...p, [k]: undefined }));
  };

  const validateForm = () => {
    const e = {};
    e.name = check(
      form.name,
      V.required("Name is required"),
      V.minLength(2, "Too short"),
      V.maxLength(120, "Too long"),
    );
    e.phone = V.pakPhone(form.phone); // required for everyone
    if (!editing) {
      e.email = V.emailRequired(form.email);
      if (!form.password || form.password.length < 6)
        e.password = "Password must be at least 6 characters";
      if (form.password !== form.confirmPassword)
        e.confirmPassword = "Passwords don't match";
    } else {
      e.email = V.email(form.email);
    }
    if (!form.city) e.city = "Select a city";
    for (const k of Object.keys(e)) if (!e[k]) delete e[k];
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const handleSubmit = async () => {
    if (!validateForm()) {
      setErr("Fix the highlighted fields and try again.");
      return;
    }
    setErr("");
    setLoading(true);
    try {
      if (editing) {
        const { password, confirmPassword, ...rest } = form;
        await updateUser(existing.id, rest);
        await logAudit(
          "user_updated",
          "user",
          existing.id,
          { entityName: form.name },
          adminUser,
        );
      } else {
        // 1. Create the Firebase Auth user via the admin-only Vercel route
        //    so the user can later sign in to the mobile app.
        const idToken = await getAuthToken(true);
        const res = await fetch("/api/users/create", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            email: form.email.trim(),
            password: form.password,
            name: form.name.trim() || null,
            phone: form.phone || null,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(
            j.error === "email_already_exists"
              ? "A user with that email already exists."
              : j.error === "phone_already_exists"
              ? "A user with that phone number already exists."
              : j.error || `HTTP ${res.status}`,
          );
        }
        const { uid } = await res.json();
        // 2. Mirror as a Firestore user doc keyed by uid so the mobile app
        //    profile lookup works. addUser keeps server-default fields.
        await addUser({
          name: form.name.trim(),
          email: form.email.trim(),
          phone: form.phone,
          city: form.city,
          status: form.status,
          uid,
        });
        await logAudit(
          "user_created",
          "user",
          uid,
          { entityName: form.name },
          adminUser,
        );
      }
      onClose();
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "#0006", zIndex: 1000 }}
      />
      <div
        className="ra-modal"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 480,
          maxWidth: "95vw",
          background: t.sidebar,
          borderRadius: 16,
          zIndex: 1001,
          overflow: "hidden",
          border: `1px solid ${t.border}`,
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: `1px solid ${t.border}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: t.white }}>
            {editing ? "Edit User" : "Add New User"}
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 18,
              color: t.text2,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>
        <div style={{ padding: 20, maxHeight: "70vh", overflowY: "auto" }}>
          {err && (
            <div
              style={{
                background: "#fef2f2",
                border: "1px solid #fecaca",
                borderRadius: 8,
                padding: "8px 12px",
                fontSize: 12,
                color: "#dc2626",
                marginBottom: 12,
              }}
            >
              {err}
            </div>
          )}
          <div
            className="ra-form-grid"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
          >
            <FG label="Full Name *" error={errs.name}>
              <Inp
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="Ali Khan"
                maxLength={120}
                autoComplete="name"
                invalid={!!errs.name}
              />
            </FG>
            <FG label="Phone *" error={errs.phone}>
              <Inp
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+92 300 1234567"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                maxLength={20}
                invalid={!!errs.phone}
              />
            </FG>
            <FG label={editing ? "Email" : "Email *"} error={errs.email}>
              <Inp
                value={form.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="user@example.com"
                type="email"
                inputMode="email"
                autoComplete="email"
                maxLength={120}
                invalid={!!errs.email}
              />
            </FG>
            <FG label="City *" error={errs.city}>
              <Sel
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
              >
                <option value="">Select…</option>
                {CITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Sel>
            </FG>
            {!editing && (
              <>
                <FG label="Password *" error={errs.password}>
                  <Inp
                    value={form.password}
                    onChange={(e) => set("password", e.target.value)}
                    placeholder="At least 6 characters"
                    type="password"
                    autoComplete="new-password"
                    invalid={!!errs.password}
                  />
                </FG>
                <FG label="Confirm Password *" error={errs.confirmPassword}>
                  <Inp
                    value={form.confirmPassword}
                    onChange={(e) => set("confirmPassword", e.target.value)}
                    placeholder="Re-type password"
                    type="password"
                    autoComplete="new-password"
                    invalid={!!errs.confirmPassword}
                  />
                </FG>
              </>
            )}
            <FG label="Status">
              <Sel
                value={form.status}
                onChange={(e) => set("status", e.target.value)}
              >
                <option value="active">Active</option>
                <option value="blocked">Blocked</option>
              </Sel>
            </FG>
          </div>
        </div>
        <div
          style={{
            padding: "14px 20px",
            borderTop: `1px solid ${t.border}`,
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={handleSubmit} disabled={loading}>
            {loading ? "Saving…" : editing ? "Save Changes" : "Add User"}
          </Btn>
        </div>
      </div>
    </>
  );
}

function Users() {
  const t = useTheme();
  const { users, adminUser } = useAdmin();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [contactsUser, setContactsUser] = useState(null);

  const userLabel = (u) => u.name || u.email || u.phone || "user";
  const userRole = (u) => (u.role === "vendor" || u.role === "admin" ? u.role : "customer");
  const deletedCount = users.filter((u) => u.deletedAt).length;

  // Active = not soft-deleted. Deleted view shown only when filter === "deleted".
  const filtered = users.filter((u) => {
    const isDeleted = Boolean(u.deletedAt);
    if (filter === "deleted" ? !isDeleted : isDeleted) return false;
    if (filter !== "all" && filter !== "deleted" && u.status !== filter)
      return false;
    if (roleFilter !== "all" && userRole(u) !== roleFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      const hit =
        userLabel(u).toLowerCase().includes(s) ||
        (u.phone || "").includes(search) ||
        (u.email || "").toLowerCase().includes(s);
      if (!hit) return false;
    }
    return true;
  });

  const handleBlock = async (u) => {
    if (!window.confirm(`Block ${userLabel(u)}?`)) return;
    await blockUser(u.id, "Blocked by admin", adminUser, userLabel(u));
  };
  const handleUnban = async (u) => {
    await unbanUser(u.id, adminUser, userLabel(u));
  };
  const handleDelete = async (u) => {
    if (!window.confirm(`Move ${userLabel(u)} to Deleted? You can restore later.`))
      return;
    await deleteUser(u.id, adminUser);
    await logAudit(
      "user_soft_deleted",
      "user",
      u.id,
      { entityName: userLabel(u) },
      adminUser,
    );
  };
  const handleRestore = async (u) => {
    await restoreUser(u.id);
    await logAudit(
      "user_restored",
      "user",
      u.id,
      { entityName: userLabel(u) },
      adminUser,
    );
  };
  const handlePermanent = async (u) => {
    if (
      !window.confirm(
        `Permanently delete ${userLabel(u)}? CANNOT be undone.`,
      )
    )
      return;
    await permanentlyDeleteUser(u.id);
    await logAudit(
      "user_hard_deleted",
      "user",
      u.id,
      { entityName: userLabel(u) },
      adminUser,
    );
  };

  const pager = usePagination(filtered, 25, `${search}|${filter}|${roleFilter}`);

  return (
    <>
      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} />}
      {editUser && (
        <AddUserModal
          existing={editUser}
          onClose={() => setEditUser(null)}
        />
      )}
      {contactsUser && (
        <EmergencyContactsModal
          user={contactsUser}
          onClose={() => setContactsUser(null)}
        />
      )}
      <div
        style={{
          display: "flex",
          gap: 9,
          marginBottom: 11,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <SBar
          placeholder="Search by name, phone or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Btn
          variant="primary"
          style={{ whiteSpace: "nowrap", marginBottom: 10 }}
          onClick={() => setShowAdd(true)}
        >
          + Add User
        </Btn>
      </div>
      <div style={{ marginBottom: 11 }}>
        {[
          ["all", "All"],
          ["active", "Active"],
          ["blocked", "Blocked"],
          ["deleted", `Deleted${deletedCount ? ` (${deletedCount})` : ""}`],
        ].map(([k, l]) => (
          <Chip
            key={k}
            label={l}
            active={filter === k}
            onClick={() => setFilter(k)}
          />
        ))}
      </div>
      <div style={{ marginBottom: 11 }}>
        {[
          ["all", `All Roles (${users.filter((u) => !u.deletedAt).length})`],
          ["customer", `Customers (${users.filter((u) => !u.deletedAt && userRole(u) === "customer").length})`],
          ["vendor", `Vendors (${users.filter((u) => !u.deletedAt && userRole(u) === "vendor").length})`],
          ["admin", `Admins (${users.filter((u) => !u.deletedAt && userRole(u) === "admin").length})`],
        ].map(([k, l]) => (
          <Chip
            key={k}
            label={l}
            active={roleFilter === k}
            onClick={() => setRoleFilter(k)}
          />
        ))}
      </div>
      <Card>
        {filtered.length === 0 ? (
          <Empty />
        ) : (
          <Tbl
            headers={["User", "Email", "Phone", "Role", "City", "Jobs", "Status", "Actions"]}
            rows={pager.slice.map((u) => (
              <tr key={u.id}>
                <TD>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 7 }}
                  >
                    <Av
                      initials={(userLabel(u) || "U").slice(0, 2).toUpperCase()}
                      size={26}
                    />
                    {userLabel(u)}
                  </div>
                </TD>
                <TD style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>
                  {u.email || "—"}
                </TD>
                <TD style={{ fontFamily: "monospace", fontSize: 11 }}>
                  {u.phone || "—"}
                </TD>
                <TD>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      background:
                        userRole(u) === "vendor"
                          ? "#dbeafe"
                          : userRole(u) === "admin"
                          ? "#fee2e2"
                          : "#f3f4f6",
                      color:
                        userRole(u) === "vendor"
                          ? "#1e40af"
                          : userRole(u) === "admin"
                          ? "#991b1b"
                          : t.muted,
                    }}
                  >
                    {userRole(u)}
                  </span>
                </TD>
                <TD>{u.city || "—"}</TD>
                <TD style={{ color: t.orange, fontWeight: 600 }}>
                  {u.totalJobs || 0}
                </TD>
                <TD>
                  <Badge status={u.deletedAt ? "deleted" : u.status || "active"} />
                </TD>
                <TD>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {u.deletedAt ? (
                      <>
                        <Btn
                          variant="success"
                          style={{ padding: "3px 8px", fontSize: 10 }}
                          onClick={() => handleRestore(u)}
                        >
                          Restore
                        </Btn>
                        <Btn
                          variant="danger"
                          style={{ padding: "3px 8px", fontSize: 10 }}
                          onClick={() => handlePermanent(u)}
                        >
                          Delete forever
                        </Btn>
                      </>
                    ) : (
                      <>
                        <Btn
                          style={{ padding: "3px 8px", fontSize: 10 }}
                          onClick={() => setEditUser(u)}
                        >
                          Edit
                        </Btn>
                        <Btn
                          style={{ padding: "3px 8px", fontSize: 10 }}
                          onClick={() => setContactsUser(u)}
                          title="View / manage emergency contacts"
                        >
                          Contacts
                        </Btn>
                        {(u.status || "active") === "active" ? (
                          <Btn
                            variant="danger"
                            style={{ padding: "3px 8px", fontSize: 10 }}
                            onClick={() => handleBlock(u)}
                          >
                            Block
                          </Btn>
                        ) : (
                          <Btn
                            variant="success"
                            style={{ padding: "3px 8px", fontSize: 10 }}
                            onClick={() => handleUnban(u)}
                          >
                            Unban
                          </Btn>
                        )}
                        <Btn
                          style={{ padding: "3px 8px", fontSize: 10 }}
                          onClick={() => handleDelete(u)}
                        >
                          Delete
                        </Btn>
                      </>
                    )}
                  </div>
                </TD>
              </tr>
            ))}
          />
        )}
        <Pager {...pager} />
      </Card>
    </>
  );
}

// ── Emergency contacts modal ─────────────────────────────────────
// Per-user emergency contacts (subcollection users/{uid}/emergencyContacts).
// Shows the contacts the customer added for SOS, marks app-linked contacts,
// and lets admin add / edit / delete on their behalf (e.g. correcting a
// typo'd phone or pre-seeding for support cases).
function normalisePhone(p) {
  const c = (p || "").replace(/[\s\-()]/g, "");
  if (c.startsWith("+92")) return c;
  if (c.startsWith("0092")) return "+92" + c.slice(4);
  if (c.startsWith("0")) return "+92" + c.slice(1);
  if (c.startsWith("3")) return "+92" + c;
  return c;
}
function isValidPakPhone(p) {
  const c = (p || "").replace(/[\s\-()]/g, "");
  return /^(\+92|0092|0)?3\d{9}$/.test(c);
}

function EmergencyContactsModal({ user, onClose }) {
  const t = useTheme();
  const { adminUser } = useAdmin();
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | "new" | contactObj
  const userLabel = user.name || user.email || user.phone || "user";

  useEffect(() => {
    setLoading(true);
    const unsub = getEmergencyContacts(user.id, (list) => {
      setContacts(list);
      setLoading(false);
    });
    return () => {
      try { unsub && unsub(); } catch {}
    };
  }, [user.id]);

  const handleDelete = async (c) => {
    if (!window.confirm(`Delete emergency contact "${c.name}"?`)) return;
    await deleteEmergencyContact(user.id, c.id);
    await logAudit(
      "emergency_contact_deleted",
      "user",
      user.id,
      { entityName: userLabel, contactName: c.name, contactPhone: c.phone },
      adminUser,
    );
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0007",
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: t.card,
          borderRadius: 14,
          width: "min(560px,100%)",
          maxHeight: "92vh",
          overflow: "auto",
          padding: 22,
          color: t.text1,
          border: `1px solid ${t.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>
              Emergency Contacts
            </div>
            <div style={{ fontSize: 12, color: t.muted, marginTop: 2 }}>
              For {userLabel}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              fontSize: 22,
              cursor: "pointer",
              color: t.muted,
            }}
          >
            ×
          </button>
        </div>
        <div
          style={{
            fontSize: 11,
            color: t.muted,
            background: t.input,
            padding: 9,
            borderRadius: 7,
            border: `1px solid ${t.border}`,
            marginBottom: 14,
            lineHeight: 1.5,
          }}
        >
          🆘 During SOS, app-linked contacts get a push notification + WhatsApp
          message. Non-app contacts only get WhatsApp. Max 5 contacts per user.
        </div>

        {loading ? (
          <div style={{ padding: 20, textAlign: "center", color: t.muted }}>
            Loading…
          </div>
        ) : contacts.length === 0 ? (
          <div style={{ padding: 24, textAlign: "center", color: t.muted, fontSize: 13 }}>
            No emergency contacts saved.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {contacts.map((c) => (
              <div
                key={c.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 11px",
                  background: t.input,
                  borderRadius: 9,
                  border: `1px solid ${t.border}`,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    background: c.linkedUid ? "#22c55e22" : "#f9731622",
                    color: c.linkedUid ? "#16a34a" : "#c2410c",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  {(c.name || "?").slice(0, 1).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {c.name || "(no name)"}
                  </div>
                  <div
                    style={{
                      fontSize: 11,
                      color: t.muted,
                      fontFamily: "monospace",
                    }}
                  >
                    {c.phone}
                  </div>
                  <div style={{ marginTop: 3 }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        padding: "2px 6px",
                        borderRadius: 6,
                        background: c.linkedUid ? "#22c55e22" : "#25d36622",
                        color: c.linkedUid ? "#16a34a" : "#128c7e",
                      }}
                    >
                      {c.linkedUid
                        ? "📱 APP USER · push + whatsapp"
                        : "💬 WHATSAPP ONLY"}
                    </span>
                  </div>
                </div>
                <Btn
                  style={{ padding: "3px 8px", fontSize: 10 }}
                  onClick={() => setEditing(c)}
                >
                  Edit
                </Btn>
                <Btn
                  variant="danger"
                  style={{ padding: "3px 8px", fontSize: 10 }}
                  onClick={() => handleDelete(c)}
                >
                  Delete
                </Btn>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 14,
          }}
        >
          <div style={{ fontSize: 11, color: t.muted }}>
            {contacts.length} / 5 contacts
          </div>
          <Btn
            variant="primary"
            onClick={() => setEditing("new")}
            disabled={contacts.length >= 5}
          >
            + Add Contact
          </Btn>
        </div>

        {editing && (
          <ContactEditor
            userId={user.id}
            userLabel={userLabel}
            existing={editing === "new" ? null : editing}
            adminUser={adminUser}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  );
}

function ContactEditor({ userId, userLabel, existing, adminUser, onClose }) {
  const t = useTheme();
  const [name, setName] = useState(existing?.name || "");
  const [phone, setPhone] = useState(existing?.phone || "");
  const [phoneErr, setPhoneErr] = useState(null);
  const [lookup, setLookup] = useState(null); // { uid, name } | null
  const [looking, setLooking] = useState(false);
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    setLookup(null);
    setPhoneErr(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!isValidPakPhone(phone)) return;
    debounceRef.current = setTimeout(async () => {
      setLooking(true);
      try {
        const result = await lookupUserByPhone(normalisePhone(phone));
        if (result && result.uid !== userId) {
          setLookup(result);
          if (!name && result.name) setName(result.name);
        }
      } catch {}
      setLooking(false);
    }, 500);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [phone]);

  const handleSave = async () => {
    if (!isValidPakPhone(phone)) {
      setPhoneErr("Enter a valid Pakistani number (03xx xxxxxxx)");
      return;
    }
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        phone: normalisePhone(phone),
        linkedUid: lookup?.uid || null,
      };
      if (existing) {
        await updateEmergencyContact(userId, existing.id, payload);
        await logAudit(
          "emergency_contact_updated",
          "user",
          userId,
          { entityName: userLabel, contactName: payload.name },
          adminUser,
        );
      } else {
        await addEmergencyContact(userId, payload);
        await logAudit(
          "emergency_contact_created",
          "user",
          userId,
          { entityName: userLabel, contactName: payload.name },
          adminUser,
        );
      }
      onClose();
    } catch (e) {
      alert("Failed: " + (e?.message || "unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#0009",
        zIndex: 250,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: t.card,
          borderRadius: 12,
          width: "min(420px,100%)",
          padding: 20,
          color: t.text1,
          border: `1px solid ${t.border}`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>
          {existing ? "Edit Contact" : "Add Contact"}
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: t.muted, display: "block", marginBottom: 4 }}>
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Ahmed (Brother)"
            style={{
              width: "100%",
              padding: "7px 9px",
              borderRadius: 6,
              background: t.input,
              border: `1px solid ${t.border}`,
              color: t.text1,
              fontSize: 13,
            }}
          />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 11, color: t.muted, display: "block", marginBottom: 4 }}>
            Phone (Pakistani)
          </label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="03001234567"
            style={{
              width: "100%",
              padding: "7px 9px",
              borderRadius: 6,
              background: t.input,
              border: `1px solid ${phoneErr ? "#dc2626" : t.border}`,
              color: t.text1,
              fontSize: 13,
              fontFamily: "monospace",
            }}
          />
          {phoneErr && (
            <div style={{ fontSize: 10, color: "#dc2626", marginTop: 3 }}>
              {phoneErr}
            </div>
          )}
        </div>
        <div
          style={{
            padding: 9,
            borderRadius: 7,
            background: lookup ? "#22c55e10" : "#f5f5f510",
            border: `1px solid ${lookup ? "#22c55e44" : t.border}`,
            fontSize: 11,
            marginBottom: 12,
            minHeight: 30,
            color: lookup ? "#16a34a" : t.muted,
          }}
        >
          {looking
            ? "🔍 Checking if this phone is on RoadAssist…"
            : lookup
            ? `📱 Linked to app user "${lookup.name || lookup.uid}" — they will get a push notification + WhatsApp.`
            : isValidPakPhone(phone)
            ? "💬 Not on app — they will get a WhatsApp message during SOS."
            : "Enter a phone number to check link status."}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" disabled={!name.trim() || saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

const DOC_KEYS = [
  { key: "cnic", label: "CNIC" },
  { key: "license", label: "License / Certificate" },
  { key: "photo", label: "Owner Photo" },
];

function VendorDocsModal({ vendor, onClose }) {
  const t = useTheme();
  const { adminUser } = useAdmin();
  const [paths, setPaths] = useState({});
  const [urls, setUrls] = useState({});
  const [errs, setErrs] = useState({});
  const [busy, setBusy] = useState({}); // { cnic: "uploading"|"deleting"|null }
  const fileRefs = useRef({});

  // Sync paths from the vendor doc whenever it changes.
  useEffect(() => {
    const docs = vendor.documents || {};
    setPaths({
      cnic: docs.cnicPath || docs.cnicUrl || null,
      license: docs.licensePath || docs.licenseUrl || null,
      photo: docs.photoPath || docs.photoUrl || null,
    });
  }, [vendor?.id, vendor?.documents]);

  // Resolve a signed URL for each path that needs one.
  useEffect(() => {
    let alive = true;
    (async () => {
      for (const { key } of DOC_KEYS) {
        const p = paths[key];
        if (!p) {
          if (alive) setUrls((u) => ({ ...u, [key]: null }));
          continue;
        }
        // Legacy Firebase Storage URLs are already direct https links.
        if (/^https?:/i.test(p)) {
          if (alive) setUrls((u) => ({ ...u, [key]: p }));
          continue;
        }
        try {
          const u = await viewVendorDoc(p);
          if (alive) setUrls((s) => ({ ...s, [key]: u }));
          if (alive) setErrs((s) => ({ ...s, [key]: null }));
        } catch (e) {
          if (alive) setErrs((s) => ({ ...s, [key]: e.message || "failed" }));
        }
      }
    })();
    return () => { alive = false; };
  }, [paths]);

  const isR2Path = (p) => p && !/^https?:/i.test(p);
  const canManage = Boolean(vendor.applicationId);

  async function handleReplace(key, file) {
    if (!file || !canManage) return;
    setBusy((b) => ({ ...b, [key]: "uploading" }));
    setErrs((e) => ({ ...e, [key]: null }));
    const oldPath = paths[key];
    try {
      const newPath = await uploadFile(file, vendor.applicationId, key);
      // Best-effort delete of the old object if path actually changed
      // (different ext) so we don't leave orphans.
      if (oldPath && isR2Path(oldPath) && oldPath !== newPath) {
        try { await deleteVendorDoc(oldPath); } catch {}
      }
      await updateVendor(vendor.id, {
        [`documents.${key}Path`]: newPath,
      });
      await logAudit(
        "vendor_doc_replaced",
        "vendor",
        vendor.id,
        { key, applicationId: vendor.applicationId },
        adminUser,
      );
      setPaths((p) => ({ ...p, [key]: newPath }));
      // Force a fresh signed URL fetch.
      setUrls((u) => ({ ...u, [key]: null }));
    } catch (e) {
      setErrs((s) => ({ ...s, [key]: e.message || "upload_failed" }));
    } finally {
      setBusy((b) => ({ ...b, [key]: null }));
    }
  }

  async function handleDelete(key) {
    const p = paths[key];
    if (!p) return;
    if (!window.confirm(`Delete this ${key.toUpperCase()} document?`)) return;
    setBusy((b) => ({ ...b, [key]: "deleting" }));
    setErrs((e) => ({ ...e, [key]: null }));
    try {
      if (isR2Path(p)) await deleteVendorDoc(p);
      await updateVendor(vendor.id, {
        [`documents.${key}Path`]: null,
      });
      await logAudit(
        "vendor_doc_deleted",
        "vendor",
        vendor.id,
        { key },
        adminUser,
      );
      setPaths((s) => ({ ...s, [key]: null }));
      setUrls((s) => ({ ...s, [key]: null }));
    } catch (e) {
      setErrs((s) => ({ ...s, [key]: e.message || "delete_failed" }));
    } finally {
      setBusy((b) => ({ ...b, [key]: null }));
    }
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "#0008", zIndex: 1000 }}
      />
      <div
        className="ra-modal"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: "min(720px, 92vw)",
          maxHeight: "85vh",
          overflowY: "auto",
          background: t.sidebar,
          borderRadius: 14,
          zIndex: 1001,
          padding: 20,
          border: `1px solid ${t.border}`,
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 700,
            color: t.white,
            marginBottom: 4,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          Documents — {vendor.businessName || vendor.name || vendor.ownerName || "Vendor"}
          <Btn onClick={onClose} style={{ padding: "3px 10px", fontSize: 11 }}>Close</Btn>
        </div>
        {!canManage && (
          <div style={{ fontSize: 11, color: t.muted, marginBottom: 10 }}>
            Legacy vendor — replace/delete disabled (no applicationId on record).
          </div>
        )}
        <div style={{ display: "grid", gap: 14 }}>
          {DOC_KEYS.map(({ key, label }) => {
            const path = paths[key];
            const url = urls[key];
            const err = errs[key];
            const status = busy[key];
            return (
              <div
                key={key}
                style={{ borderTop: `1px solid ${t.border}`, paddingTop: 10 }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                    flexWrap: "wrap",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 11, color: t.muted, fontWeight: 600 }}>
                    {label}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {url && (
                      <a
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ textDecoration: "none" }}
                      >
                        <Btn style={{ padding: "3px 9px", fontSize: 10 }}>
                          Open
                        </Btn>
                      </a>
                    )}
                    {canManage && (
                      <>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          ref={(el) => (fileRefs.current[key] = el)}
                          style={{ display: "none" }}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            handleReplace(key, f);
                          }}
                        />
                        <Btn
                          style={{ padding: "3px 9px", fontSize: 10 }}
                          disabled={status === "uploading"}
                          onClick={() => fileRefs.current[key]?.click()}
                        >
                          {status === "uploading"
                            ? "Uploading…"
                            : path
                            ? "Replace"
                            : "Upload"}
                        </Btn>
                        {path && (
                          <Btn
                            variant="danger"
                            style={{ padding: "3px 9px", fontSize: 10 }}
                            disabled={status === "deleting"}
                            onClick={() => handleDelete(key)}
                          >
                            {status === "deleting" ? "Deleting…" : "Delete"}
                          </Btn>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {err ? (
                  <div style={{ fontSize: 12, color: "#dc2626" }}>
                    {err}
                  </div>
                ) : !path ? (
                  <div style={{ fontSize: 12, color: t.muted, fontStyle: "italic" }}>
                    Not provided
                  </div>
                ) : !url ? (
                  <div style={{ fontSize: 12, color: t.muted }}>Loading…</div>
                ) : (
                  <a href={url} target="_blank" rel="noreferrer">
                    <img
                      src={url}
                      alt={label}
                      style={{
                        maxWidth: "100%",
                        maxHeight: 360,
                        borderRadius: 8,
                        border: `1px solid ${t.border}`,
                        display: "block",
                      }}
                    />
                  </a>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Vendors() {
  const t = useTheme();
  const { vendors, adminUser } = useAdmin();
  const [search, setSearch] = useState("");
  const [catF, setCatF] = useState("All");
  const [kycTab, setKycTab] = useState("all");
  const [showAdd, setShowAdd] = useState(false);
  const [editVendor, setEditVendor] = useState(null);
  const [rejectModal, setRejectModal] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [docsVendor, setDocsVendor] = useState(null);

  // Self-registered vendors save businessName / ownerName, not name.
  // Fall back across all three so they appear in the table and search.
  const vendorName = (v) =>
    v.name || v.businessName || v.ownerName || "";
  // Active = not soft-deleted. Deleted view shown only when kycTab === "deleted".
  const filtered = vendors.filter((v) => {
    const isDeleted = Boolean(v.deletedAt);
    if (kycTab === "deleted" ? !isDeleted : isDeleted) return false;
    if (catF !== "All" && v.category !== catF) return false;
    if (kycTab !== "all" && kycTab !== "deleted" && v.kyc !== kycTab) return false;
    if (search && !vendorName(v).toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleVerify = async (v) => {
    await approveKYC(v.id, adminUser, vendorName(v));
  };
  const handleReject = async () => {
    await rejectKYC(
      rejectModal.id,
      rejectReason,
      adminUser,
      vendorName(rejectModal),
    );
    setRejectModal(null);
    setRejectReason("");
  };
  const handleSuspend = async (v) => {
    const label = vendorName(v) || "vendor";
    if (!window.confirm(`Suspend ${label}?`)) return;
    await updateVendor(v.id, { status: "suspended" });
    await logAudit(
      "vendor_suspended",
      "vendor",
      v.id,
      { entityName: label },
      adminUser,
    );
  };
  // Soft delete (default Delete action).
  const handleDelete = async (v) => {
    const label = vendorName(v) || "vendor";
    if (!window.confirm(`Move ${label} to Deleted? You can restore later.`)) return;
    await deleteVendor(v.id, adminUser);
    await logAudit(
      "vendor_soft_deleted",
      "vendor",
      v.id,
      { entityName: label },
      adminUser,
    );
  };
  const handleRestore = async (v) => {
    const label = vendorName(v) || "vendor";
    await restoreVendor(v.id);
    await logAudit(
      "vendor_restored",
      "vendor",
      v.id,
      { entityName: label },
      adminUser,
    );
  };
  const handlePermanentDelete = async (v) => {
    const label = vendorName(v) || "vendor";
    if (
      !window.confirm(
        `Permanently delete ${label}? This wipes the record and all uploaded documents from R2. CANNOT be undone.`,
      )
    )
      return;
    await permanentlyDeleteVendor(v.id);
    await logAudit(
      "vendor_hard_deleted",
      "vendor",
      v.id,
      { entityName: label, applicationId: v.applicationId || null },
      adminUser,
    );
  };

  const activeVendors = vendors.filter((v) => !v.deletedAt);
  const pendingCount = activeVendors.filter((v) => v.kyc === "pending").length;
  const deletedCount = vendors.filter((v) => v.deletedAt).length;

  const pager = usePagination(filtered, 25, `${search}|${catF}|${kycTab}`);

  return (
    <>
      {showAdd && <AddVendorModal onClose={() => setShowAdd(false)} />}
      {editVendor && (
        <AddVendorModal
          existing={editVendor}
          onClose={() => setEditVendor(null)}
        />
      )}
      {docsVendor && (
        <VendorDocsModal vendor={docsVendor} onClose={() => setDocsVendor(null)} />
      )}
      {rejectModal && (
        <>
          <div
            onClick={() => setRejectModal(null)}
            style={{
              position: "fixed",
              inset: 0,
              background: "#0006",
              zIndex: 1000,
            }}
          />
          <div
            className="ra-modal"
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%,-50%)",
              width: 380,
              background: t.sidebar,
              borderRadius: 14,
              zIndex: 1001,
              padding: 20,
              border: `1px solid ${t.border}`,
            }}
          >
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: t.white,
                marginBottom: 12,
              }}
            >
              Reject KYC — {vendorName(rejectModal) || "vendor"}
            </div>
            <FG label="Rejection Reason (10–500 chars)">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                placeholder="e.g. Documents unclear, CNIC expired…"
                maxLength={500}
                style={{
                  background: t.input,
                  border: `1px solid ${t.border}`,
                  borderRadius: 7,
                  padding: "8px 10px",
                  color: t.text1,
                  fontSize: 12,
                  outline: "none",
                  width: "100%",
                  resize: "vertical",
                }}
              />
              <div
                style={{
                  fontSize: 10,
                  color: t.muted,
                  marginTop: 3,
                  textAlign: "right",
                }}
              >
                {rejectReason.length}/500
              </div>
            </FG>
            <div
              style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
            >
              <Btn onClick={() => setRejectModal(null)}>Cancel</Btn>
              <Btn
                variant="danger"
                onClick={handleReject}
                disabled={rejectReason.trim().length < 10}
              >
                Reject KYC
              </Btn>
            </div>
          </div>
        </>
      )}

      {pendingCount > 0 && (
        <div
          style={{
            background: "#f59e0b18",
            border: "1px solid #f59e0b33",
            borderRadius: 9,
            padding: "10px 14px",
            marginBottom: 12,
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
        >
          <span style={{ fontSize: 14 }}>⚠️</span>
          <span style={{ fontSize: 12, color: "#d97706", fontWeight: 600 }}>
            {pendingCount} vendor{pendingCount > 1 ? "s" : ""} pending KYC
            review
          </span>
          <Chip
            label="Show Pending"
            active={kycTab === "pending"}
            onClick={() => setKycTab(kycTab === "pending" ? "all" : "pending")}
          />
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: 9,
          marginBottom: 11,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <SBar
          placeholder="Search vendor name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Btn
          variant="primary"
          style={{ whiteSpace: "nowrap", marginBottom: 10 }}
          onClick={() => setShowAdd(true)}
        >
          + Add Vendor
        </Btn>
      </div>
      <div style={{ marginBottom: 8 }}>
        {["All", ...CATEGORIES].map((c) => (
          <Chip
            key={c}
            label={c}
            active={catF === c}
            onClick={() => setCatF(c)}
          />
        ))}
      </div>
      <div style={{ marginBottom: 11 }}>
        {[
          ["all", "All"],
          ["pending", "Pending KYC"],
          ["approved", "Approved"],
          ["rejected", "Rejected"],
          ["deleted", `Deleted${deletedCount ? ` (${deletedCount})` : ""}`],
        ].map(([k, l]) => (
          <Chip
            key={k}
            label={l}
            active={kycTab === k}
            onClick={() => setKycTab(k)}
          />
        ))}
      </div>
      <Card>
        {filtered.length === 0 ? (
          <Empty icon="🔧" text="No vendors match filters" />
        ) : (
          <Tbl
            headers={[
              "Vendor",
              "Category",
              "City",
              "Rating",
              "KYC",
              "Status",
              "Source",
              "Actions",
            ]}
            rows={pager.slice.map((v) => (
              <tr key={v.id}>
                <TD>
                  <div
                    style={{ display: "flex", alignItems: "center", gap: 7 }}
                  >
                    <Av
                      initials={(vendorName(v) || "V").slice(0, 2).toUpperCase()}
                      color={getCatColors(t.orange)[v.category] || t.orange}
                      size={24}
                    />
                    {vendorName(v) || "—"}
                  </div>
                </TD>
                <TD>
                  <CatDot cat={v.category} />
                </TD>
                <TD style={{ fontSize: 11, color: t.muted }}>{v.city}</TD>
                <TD>
                  <Stars n={v.rating || 0} />
                </TD>
                <TD>
                  <Badge status={v.kyc || "pending"} />
                </TD>
                <TD>
                  <Badge status={v.status || "pending"} />
                </TD>
                <TD>
                  <Badge
                    status={v.source || "manual"}
                    text={
                      v.source === "self_registration" ? "Self-reg" : "Manual"
                    }
                  />
                </TD>
                <TD>
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {v.deletedAt ? (
                      <>
                        <Btn
                          style={{ padding: "3px 7px", fontSize: 10 }}
                          onClick={() => setDocsVendor(v)}
                        >
                          Docs
                        </Btn>
                        <Btn
                          variant="success"
                          style={{ padding: "3px 7px", fontSize: 10 }}
                          onClick={() => handleRestore(v)}
                        >
                          Restore
                        </Btn>
                        <Btn
                          variant="danger"
                          style={{ padding: "3px 7px", fontSize: 10 }}
                          onClick={() => handlePermanentDelete(v)}
                        >
                          Delete forever
                        </Btn>
                      </>
                    ) : (
                      <>
                        {v.kyc === "pending" && (
                          <>
                            <Btn
                              variant="success"
                              style={{ padding: "3px 7px", fontSize: 10 }}
                              onClick={() => handleVerify(v)}
                            >
                              Approve
                            </Btn>
                            <Btn
                              variant="danger"
                              style={{ padding: "3px 7px", fontSize: 10 }}
                              onClick={() => setRejectModal(v)}
                            >
                              Reject
                            </Btn>
                          </>
                        )}
                        {v.status === "verified" && (
                          <Btn
                            variant="danger"
                            style={{ padding: "3px 7px", fontSize: 10 }}
                            onClick={() => handleSuspend(v)}
                          >
                            Suspend
                          </Btn>
                        )}
                        {v.status !== "verified" && v.kyc !== "pending" && (
                          <Btn
                            variant="success"
                            style={{ padding: "3px 7px", fontSize: 10 }}
                            onClick={() => handleVerify(v)}
                          >
                            Verify
                          </Btn>
                        )}
                        <Btn
                          style={{ padding: "3px 7px", fontSize: 10 }}
                          onClick={() => setEditVendor(v)}
                        >
                          Edit
                        </Btn>
                        <Btn
                          style={{ padding: "3px 7px", fontSize: 10 }}
                          onClick={() => setDocsVendor(v)}
                        >
                          Docs
                        </Btn>
                        <Btn
                          style={{ padding: "3px 7px", fontSize: 10 }}
                          onClick={() => handleDelete(v)}
                        >
                          Delete
                        </Btn>
                      </>
                    )}
                  </div>
                </TD>
              </tr>
            ))}
          />
        )}
        <Pager {...pager} />
      </Card>
    </>
  );
}

function Requests() {
  const t = useTheme();
  const { requests, adminUser, vendors } = useAdmin();
  const [statusF, setStatusF] = useState("all");
  // Canonical service-request statuses match the Flutter enum
  // (service_request_model.dart). Anything outside this set is legacy
  // data and gets surfaced with the original label.
  const statuses = [
    "all",
    "requested",
    "accepted",
    "onTheWay",
    "arrived",
    "completed",
    "cancelled",
  ];
  const filtered = requests.filter(
    (r) => statusF === "all" || r.status === statusF,
  );
  const [selected, setSelected] = useState(null);
  const [reassignTarget, setReassignTarget] = useState("");

  const handleCancel = async (r, reason = "Cancelled by admin") => {
    if (!window.confirm("Force-cancel this request?")) return;
    await updateRequestStatus(r.id, "cancelled");
    // Best-effort: stamp who cancelled and why so the audit story is
    // complete even if the audit_log write below fails. Also write a
    // notification to the customer with the reason so they know why
    // their request closed without explanation.
    try {
      const { supabase: sb } = await import("./src/lib/supabase");
      await sb.from("service_requests").update({
        cancelled_by: "admin",
        cancel_reason: reason,
      }).eq("id", r.id);
      if (r.userId) {
        await sb.from("notifications").insert({
          user_id: r.userId,
          type: "serviceUpdate",
          title: "Your request was cancelled",
          body: reason || "An admin cancelled your service request.",
          is_read: false,
        });
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[admin] cancel reason stamp / notify failed:", e);
    }
    await logAudit(
      "request_cancelled",
      "request",
      r.id,
      {
        entityName: r.vendorName || r.vendor || r.customerName || r.cust || r.id,
        reason,
      },
      adminUser,
    );
  };

  const handleStatusChange = async (r, next) => {
    if (next === r.status) return;
    await updateRequestStatus(r.id, next);
    await logAudit(
      "request_status_changed",
      "request",
      r.id,
      {
        entityName: r.vendorName || r.vendor || r.customerName || r.cust || r.id,
        from: r.status || "—",
        to: next,
      },
      adminUser,
    );
  };

  const handleForceComplete = async (r) => {
    if (
      !window.confirm(
        "Force-complete this request? The customer will see it as done immediately.",
      )
    )
      return;
    await handleStatusChange(r, "completed");
  };

  const handleReassign = async (r, newVendorId) => {
    if (!newVendorId || newVendorId === r.vendorId) return;
    const newVendor = vendors.find((v) => v.id === newVendorId);
    if (!newVendor) return;
    if (
      !window.confirm(
        `Reassign this job to ${newVendor.businessName || newVendor.name || "selected vendor"}?`,
      )
    )
      return;
    try {
      const { supabase: sb } = await import("./src/lib/supabase");
      await sb.from("service_requests").update({
        vendor_id: newVendorId,
        vendor_name: newVendor.businessName || newVendor.name || "",
        status: "requested",
        accepted_at: null,
        mechanic_name: "",
        mechanic_vehicle: "",
        mechanic_lat: null,
        mechanic_lng: null,
      }).eq("id", r.id);
      if (newVendor.authUid) {
        try {
          await sb.from("notifications").insert({
            user_id: newVendor.authUid,
            type: "systemInfo",
            title: "New job assigned to you",
            body: `Admin assigned a ${r.category || "service"} request. Open the app to accept it.`,
            is_read: false,
          });
        } catch (e) {
          console.warn("[admin] reassign notify failed:", e);
        }
      }
      await logAudit(
        "request_reassigned",
        "request",
        r.id,
        {
          entityName: r.vendorName || "—",
          newVendorId,
          newVendorName: newVendor.businessName || newVendor.name || "",
        },
        adminUser,
      );
      setReassignTarget("");
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[admin] reassign failed", e);
      alert("Reassign failed: " + (e.message || e));
    }
  };

  const TlDot = ({ state }) => {
    const bg =
      state === "done" ? "#22c55e" : state === "active" ? t.orange : t.border;
    return (
      <div
        style={{
          position: "absolute",
          left: -17,
          top: 2,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: bg,
          border: `1.5px solid ${bg}`,
          boxShadow: state === "active" ? `0 0 0 3px ${t.orange}22` : "none",
        }}
      />
    );
  };

  return (
    <>
      <div style={{ marginBottom: 11 }}>
        {statuses.map((s) => (
          <Chip
            key={s}
            label={s.replace(/_/g, " ")}
            active={statusF === s}
            onClick={() => setStatusF(s)}
          />
        ))}
      </div>
      <div
        className="ra-chart-grid"
        style={{
          display: "grid",
          gridTemplateColumns: selected ? "2fr 1fr" : "1fr",
          gap: 14,
        }}
      >
        <Card>
          <CT>
            Live Job Board{" "}
            <span
              style={{ color: t.muted, textTransform: "none", fontSize: 10 }}
            >
              ({filtered.length} jobs)
            </span>
          </CT>
          {filtered.length === 0 ? (
            <Empty icon="📋" text="No requests match" />
          ) : (
            <Tbl
              headers={["Customer", "Vendor", "Category", "Status", "Time", ""]}
              rows={filtered.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => setSelected(r)}
                  style={{ cursor: "pointer" }}
                >
                  <TD style={{ fontSize: 12 }}>{r.customerName || "—"}</TD>
                  <TD style={{ fontSize: 12 }}>{r.vendorName || "—"}</TD>
                  <TD>
                    <CatDot cat={r.category || "Mechanic"} />
                  </TD>
                  <TD>
                    <Badge status={r.status} />
                  </TD>
                  <TD style={{ fontSize: 10, color: t.muted }}>
                    {r.createdAt ? toDate(s.createdAt) : null?.toLocaleTimeString() || "—"}
                  </TD>
                  <TD>
                    <Btn style={{ padding: "3px 7px", fontSize: 10 }}>
                      Detail
                    </Btn>
                  </TD>
                </tr>
              ))}
            />
          )}
        </Card>
        {selected && (
          <Card>
            <CT>
              <span>Request Detail</span>
              <span
                onClick={() => setSelected(null)}
                style={{ cursor: "pointer", fontSize: 14, color: t.muted }}
              >
                ×
              </span>
            </CT>
            <div
              style={{
                fontSize: 11,
                color: t.muted,
                marginBottom: 12,
                fontFamily: "monospace",
              }}
            >
              {selected.id}
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: t.muted, marginBottom: 4 }}>
                Customer
              </div>
              <div style={{ fontSize: 13, color: t.text1, fontWeight: 600 }}>
                {selected.customerName || "—"}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: t.muted, marginBottom: 4 }}>
                Vendor
              </div>
              <div style={{ fontSize: 13, color: t.text1, fontWeight: 600 }}>
                {selected.vendorName || "—"}
              </div>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, color: t.muted, marginBottom: 4 }}>
                Category
              </div>
              <CatDot cat={selected.category || "—"} />
            </div>
            <div
              style={{
                position: "relative",
                paddingLeft: 20,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 6,
                  top: 0,
                  bottom: 0,
                  width: 1,
                  background: t.border,
                }}
              />
              {(() => {
                const s = selected.status;
                const isCancelled = s === "cancelled";
                const reachedAccepted = [
                  "accepted",
                  "onTheWay",
                  "arrived",
                  "in_progress",
                  "completed",
                ].includes(s);
                const reachedOnTheWay = [
                  "onTheWay",
                  "arrived",
                  "in_progress",
                  "completed",
                ].includes(s);
                const reachedArrived = ["arrived", "completed"].includes(s);
                const reachedCompleted = s === "completed";
                if (isCancelled) {
                  return [
                    ["Requested", "done"],
                    ["Cancelled", "active"],
                  ];
                }
                return [
                  ["Requested", "done"],
                  ["Accepted", reachedAccepted ? "done" : "pending"],
                  ["On the Way", reachedOnTheWay ? "done" : "pending"],
                  ["Arrived", reachedArrived ? "done" : "pending"],
                  ["Completed", reachedCompleted ? "done" : "pending"],
                ];
              })().map(([lbl, state]) => (
                <div
                  key={lbl}
                  style={{ position: "relative", marginBottom: 12 }}
                >
                  <TlDot state={state} />
                  <div
                    style={{
                      fontSize: 12,
                      color: state === "done" ? t.text1 : t.text2,
                    }}
                  >
                    {lbl}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 8 }}>
              <FG label="Change Status">
                <Sel
                  value={selected.status || "requested"}
                  onChange={(e) => handleStatusChange(selected, e.target.value)}
                >
                  <option value="requested">Requested</option>
                  <option value="accepted">Accepted</option>
                  <option value="onTheWay">On the Way</option>
                  <option value="arrived">Arrived</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </Sel>
              </FG>
            </div>
            <div style={{ display: "flex", gap: 7, marginBottom: 10 }}>
              <Btn
                variant="primary"
                style={{ flex: 1, justifyContent: "center", fontSize: 11 }}
                onClick={() => handleForceComplete(selected)}
              >
                Force Complete
              </Btn>
              <Btn
                variant="danger"
                style={{ flex: 1, justifyContent: "center", fontSize: 11 }}
                onClick={() => handleCancel(selected)}
              >
                Force Cancel
              </Btn>
            </div>
            <div
              style={{
                borderTop: `1px solid ${t.border}`,
                marginTop: 8,
                paddingTop: 10,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  color: t.muted,
                  textTransform: "uppercase",
                  letterSpacing: 0.6,
                  marginBottom: 6,
                }}
              >
                Reassign vendor
              </div>
              <div style={{ display: "flex", gap: 7 }}>
                <Sel
                  value={reassignTarget}
                  onChange={(e) => setReassignTarget(e.target.value)}
                  style={{ flex: 1 }}
                >
                  <option value="">Select a vendor…</option>
                  {(vendors || [])
                    .filter(
                      (v) =>
                        v.id !== selected.vendorId &&
                        v.isVerified !== false &&
                        !v.deletedAt,
                    )
                    .map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.businessName || v.name || v.id}
                      </option>
                    ))}
                </Sel>
                <Btn
                  disabled={!reassignTarget}
                  onClick={() => handleReassign(selected, reassignTarget)}
                  style={{ fontSize: 11 }}
                >
                  Reassign
                </Btn>
              </div>
              <div style={{ fontSize: 10, color: t.muted, marginTop: 6 }}>
                Resets status to <code>requested</code> so the new vendor sees it as a
                fresh incoming job.
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function SOS_Page() {
  const t = useTheme();
  const { sos, users, adminUser } = useAdmin();
  const active = sos.filter((s) => !s.resolved);
  const resolved = sos.filter((s) => s.resolved);
  // History panel state.
  const [historyFilter, setHistoryFilter] = useState("all");
  const [historySearch, setHistorySearch] = useState("");
  // Helper: enrich an SOS doc with the sender's user info if missing.
  // Older clients only wrote `userId`; newer ones also write `userName`/`userEmail`.
  const enrich = (s) => {
    if (s.userName && s.userEmail) return s;
    const u = users.find((x) => x.id === s.userId);
    return {
      ...s,
      userName: s.userName || u?.name || u?.email || "Unknown user",
      userEmail: s.userEmail || u?.email || "",
      userPhone: s.userPhone || u?.phone || "",
    };
  };

  // Renders the per-recipient delivery list. Reused by both the Active
  // and History panels so admins see the same level of detail when
  // reviewing a closed alert.
  const RecipientList = ({ items }) => (
    <div
      style={{
        marginTop: 6,
        padding: "6px 8px",
        background: t.input,
        border: `1px solid ${t.border}`,
        borderRadius: 6,
      }}
    >
      <div
        style={{
          fontSize: 9,
          fontWeight: 700,
          color: t.muted,
          textTransform: "uppercase",
          letterSpacing: 0.4,
          marginBottom: 4,
        }}
      >
        Recipients ({items.length})
      </div>
      {items.map((r, idx) => (
        <div
          key={idx}
          style={{
            fontSize: 10,
            color: t.text2,
            display: "flex",
            gap: 6,
            alignItems: "center",
            padding: "2px 0",
          }}
        >
          <span style={{ fontWeight: 600, color: t.text1 }}>
            {r.name || "—"}
          </span>
          <span style={{ fontFamily: "monospace" }}>{r.phone || ""}</span>
          <span
            style={{
              fontSize: 9,
              padding: "0 5px",
              borderRadius: 3,
              background: r.isAppUser ? "#22c55e22" : "#f59e0b22",
              color: r.isAppUser ? "#16a34a" : "#b45309",
              fontWeight: 700,
            }}
          >
            {r.isAppUser ? "APP" : "WHATSAPP"}
          </span>
          {r.isAppUser && (
            <span
              style={{
                fontSize: 9,
                color: r.pushSucceeded ? "#16a34a" : "#dc2626",
              }}
            >
              {r.pushSucceeded ? "✓ pushed" : "✕ failed"}
            </span>
          )}
        </div>
      ))}
    </div>
  );

  // Filtered + sorted history list (newest first). Active rows surface
  // when the user picks "Active" or "All" so this single list works as a
  // complete timeline. The top "live" panel still shows active for
  // quick triage.
  const sortedAll = [...sos].sort((a, b) => {
    const ta = a.createdAt ? toDate(s.createdAt) : null?.getTime?.() || 0;
    const tb = b.createdAt ? toDate(s.createdAt) : null?.getTime?.() || 0;
    return tb - ta;
  });
  const historyFiltered = sortedAll
    .filter((s) => {
      if (historyFilter === "active") return !s.resolved;
      if (historyFilter === "resolved") return s.resolved;
      return true;
    })
    .map(enrich)
    .filter((s) => {
      if (!historySearch) return true;
      const q = historySearch.toLowerCase();
      return (
        (s.userName || "").toLowerCase().includes(q) ||
        (s.userEmail || "").toLowerCase().includes(q) ||
        (s.userPhone || "").toLowerCase().includes(q) ||
        (s.id || "").toLowerCase().includes(q)
      );
    });
  const historyPager = usePagination(
    historyFiltered,
    10,
    `${historyFilter}|${historySearch}`,
  );
  return (
    <>
      <div
        className="ra-stat-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4,1fr)",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <KCard label="Active Alerts" value={active.length} accent="#ef4444" />
        <KCard
          label="Resolved Today"
          value={resolved.length}
          accent="#22c55e"
        />
        <KCard label="Total This Week" value={sos.length} />
        <KCard
          label="Avg Contacts/Alert"
          value={
            sos.length
              ? Math.round(
                  sos.reduce(
                    (a, s) => a + (s.contactsNotified || s.contacts || 0),
                    0,
                  ) / sos.length,
                )
              : 0
          }
        />
      </div>
      <div className="ra-chart-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <CT>
            <span>
              Active Alerts{" "}
              <span style={{ color: "#ef4444", fontSize: 10 }}>● Live</span>
            </span>
          </CT>
          {active.length === 0 ? (
            <Empty icon="✅" text="No active SOS alerts" />
          ) : (
            active.map(enrich).map((s, i) => {
              const mapsUrl = s.lat && s.lng
                ? `https://maps.google.com/?q=${s.lat},${s.lng}`
                : null;
              return (
                <div
                  key={s.id || i}
                  style={{
                    background: "#dc26260d",
                    border: "1px solid #dc262622",
                    borderRadius: 8,
                    padding: "10px 12px",
                    marginBottom: 7,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 10,
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "#ef4444",
                      flexShrink: 0,
                      marginTop: 6,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{ fontSize: 12, fontWeight: 700, color: t.text1 }}
                    >
                      {s.userName}
                    </div>
                    {s.userEmail && (
                      <div style={{ fontSize: 10, color: t.muted, fontFamily: "monospace" }}>
                        {s.userEmail}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "#b45309", marginTop: 3 }}>
                      📍{" "}
                      {mapsUrl ? (
                        <a
                          href={mapsUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "#b45309", textDecoration: "underline" }}
                        >
                          {s.lat?.toFixed?.(4)}, {s.lng?.toFixed?.(4)}
                        </a>
                      ) : (
                        "—"
                      )}{" "}
                      · {s.contactsNotified || 0} contacts
                      {s.appUsersPushed > 0 && ` · ${s.appUsersPushed} pushed`}
                    </div>
                    {Array.isArray(s.recipients) && s.recipients.length > 0 && (
                      <RecipientList items={s.recipients} />
                    )}
                    <div style={{ fontSize: 10, color: t.muted, marginTop: 4 }}>
                      {s.createdAt ? toDate(s.createdAt) : null?.toLocaleString() || "—"}
                    </div>
                  </div>
                  <div
                    style={{ display: "flex", flexDirection: "column", gap: 5 }}
                  >
                    <Btn
                      variant="success"
                      style={{ padding: "2px 8px", fontSize: 10 }}
                      onClick={() => resolveSOS(s.id, adminUser, s.userName)}
                    >
                      Resolve
                    </Btn>
                  </div>
                </div>
              );
            })
          )}
        </Card>
        <Card>
          <CT>Hotspot Zones</CT>
          <div
            style={{
              background: t.input,
              borderRadius: 9,
              height: 160,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: `1px solid ${t.border}`,
              marginBottom: 12,
              color: t.muted,
              flexDirection: "column",
              gap: 4,
              fontSize: 22,
            }}
          >
            🗺 <span style={{ fontSize: 11 }}>Karachi · Live Map</span>
          </div>
          {[
            ["Shahrah-e-Faisal", active.length],
            ["Burns Road", Math.max(0, active.length - 1)],
            ["MA Jinnah Rd", Math.max(0, active.length - 2)],
            ["Tariq Road", 0],
          ].map(([z, c]) => (
            <div key={z} style={{ marginBottom: 9 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 11,
                  color: t.text2,
                  marginBottom: 3,
                }}
              >
                <span>{z}</span>
                <span style={{ color: t.orange }}>{c}</span>
              </div>
              <PBar
                pct={active.length ? Math.round((c / active.length) * 100) : 0}
              />
            </div>
          ))}
        </Card>
      </div>
      {/* Full SOS history — every alert ever raised, with filter + search +
          recipient drilldown. Replaces the previous "active-only" view that
          made it impossible to audit a closed emergency after resolve. */}
      <Card style={{ marginTop: 14 }}>
        <CT>SOS History</CT>
        <div style={{ marginBottom: 9 }}>
          <SBar
            placeholder="Search by name, email, phone, or alert id…"
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
          />
        </div>
        <div style={{ marginBottom: 11 }}>
          {[
            ["all", "All"],
            ["active", "Active"],
            ["resolved", "Resolved"],
          ].map(([k, label]) => (
            <Chip
              key={k}
              label={label}
              active={historyFilter === k}
              onClick={() => setHistoryFilter(k)}
            />
          ))}
        </div>
        {historyFiltered.length === 0 ? (
          <Empty icon="📜" text="No SOS records match" />
        ) : (
          historyPager.slice.map((s, i) => {
            const mapsUrl =
              s.lat && s.lng
                ? `https://maps.google.com/?q=${s.lat},${s.lng}`
                : null;
            const ts = s.createdAt ? toDate(s.createdAt) : null;
            const resolvedTs = toDate(s.resolvedAt);
            const isActive = !s.resolved;
            return (
              <div
                key={s.id || i}
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "flex-start",
                  padding: "10px 0",
                  borderBottom: `1px solid ${t.border}`,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: isActive ? "#ef4444" : "#22c55e",
                    flexShrink: 0,
                    marginTop: 6,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      alignItems: "baseline",
                      gap: 6,
                    }}
                  >
                    <span
                      style={{ fontSize: 12, fontWeight: 700, color: t.text1 }}
                    >
                      {s.userName}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        padding: "1px 6px",
                        borderRadius: 4,
                        background: isActive ? "#ef444422" : "#22c55e22",
                        color: isActive ? "#dc2626" : "#16a34a",
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                      }}
                    >
                      {isActive ? "Active" : "Resolved"}
                    </span>
                  </div>
                  {s.userEmail && (
                    <div
                      style={{
                        fontSize: 10,
                        color: t.muted,
                        fontFamily: "monospace",
                        marginTop: 1,
                      }}
                    >
                      {s.userEmail}
                    </div>
                  )}
                  <div
                    style={{ fontSize: 10, color: "#b45309", marginTop: 3 }}
                  >
                    📍{" "}
                    {mapsUrl ? (
                      <a
                        href={mapsUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          color: "#b45309",
                          textDecoration: "underline",
                        }}
                      >
                        {s.lat?.toFixed?.(4)}, {s.lng?.toFixed?.(4)}
                      </a>
                    ) : (
                      "—"
                    )}{" "}
                    · {s.contactsNotified || 0} contacts
                    {s.appUsersPushed > 0 &&
                      ` · ${s.appUsersPushed} pushed`}
                  </div>
                  {Array.isArray(s.recipients) && s.recipients.length > 0 && (
                    <RecipientList items={s.recipients} />
                  )}
                  <div
                    style={{ fontSize: 10, color: t.muted, marginTop: 4 }}
                  >
                    Triggered: {ts ? ts.toLocaleString() : "—"}
                    {resolvedTs ? ` · Resolved: ${resolvedTs.toLocaleString()}` : ""}
                    {s.resolvedBy ? ` · by ${s.resolvedBy}` : ""}
                    {s.id ? ` · id: ${s.id}` : ""}
                  </div>
                </div>
                {isActive && (
                  <Btn
                    variant="success"
                    style={{ padding: "2px 8px", fontSize: 10 }}
                    onClick={() => resolveSOS(s.id, adminUser, s.userName)}
                  >
                    Resolve
                  </Btn>
                )}
              </div>
            );
          })
        )}
        <Pager {...historyPager} />
      </Card>
    </>
  );
}

function Finance() {
  const t = useTheme();
  const { requests } = useAdmin();
  const completed = requests.filter((r) => r.status === "completed").length;
  return (
    <>
      <div
        className="ra-stat-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(6,1fr)",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <KCard label="Completed Jobs" value={completed} accent={t.orange} />
        <KCard
          label="Est. Revenue"
          value={`₨${(completed * 800).toLocaleString()}`}
          delta="@avg ₨800/job"
          deltaType="up"
        />
        <KCard
          label="Commission"
          value={`₨${(completed * 80).toLocaleString()}`}
          delta="10% avg"
        />
        <KCard
          label="Pending Payouts"
          value={`₨${(completed * 720).toLocaleString()}`}
        />
        <KCard label="This Month" value="₨3.7L" accent="#22c55e" />
        <KCard label="Disputes" value="3" accent="#ef4444" />
      </div>
      <div className="ra-chart-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <Card>
          <CT>Commission Rates by Category</CT>
          {[
            ["Mechanic", 10],
            ["Fuel", 5],
            ["Tyre", 8],
            ["Battery", 8],
            ["Towing", 12],
            ["Accident", 15],
          ].map(([c, p]) => (
            <div
              key={c}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                marginBottom: 9,
              }}
            >
              <div style={{ minWidth: 120 }}>
                <CatDot cat={c} />
              </div>
              <div style={{ flex: 1 }}>
                <PBar pct={p * 5} />
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: t.orange,
                  minWidth: 28,
                }}
              >
                {p}%
              </span>
              <Btn style={{ padding: "2px 8px", fontSize: 10 }}>Edit</Btn>
            </div>
          ))}
        </Card>
        <Card>
          <CT>Revenue — Last 7 Days</CT>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <XAxis
                dataKey="day"
                tick={{ fill: t.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: t.muted, fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  background: t.ttBg,
                  border: `1px solid ${t.ttBdr}`,
                  borderRadius: 8,
                  fontSize: 11,
                }}
                formatter={(v) => [`₨ ${v.toLocaleString()}`, "Revenue"]}
              />
              <Bar dataKey="revenue" fill={t.orange} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </>
  );
}

function Reviews_Page() {
  const t = useTheme();
  const { reviews, adminUser } = useAdmin();
  const [filter, setFilter] = useState("all");
  const reviewLabel = (r) =>
    `${r.vendorName || r.vendor || "vendor"} / ${r.userName || r.user || "user"}`;
  const deletedReviewsCount = reviews.filter((r) => r.deletedAt).length;
  const filtered = reviews.filter((r) => {
    const isDeleted = Boolean(r.deletedAt);
    if (filter === "deleted") return isDeleted;
    if (isDeleted) return false;
    if (filter === "all") return true;
    return r.status === filter;
  });
  const pager = usePagination(filtered, 25, filter);

  const handleFlag = async (r) => {
    await flagReview(r.id);
    await logAudit(
      "review_flagged",
      "review",
      r.id,
      { entityName: reviewLabel(r) },
      adminUser,
    );
  };
  const handleUnflag = async (r) => {
    await restoreReview(r.id);
    await logAudit(
      "review_unflagged",
      "review",
      r.id,
      { entityName: reviewLabel(r) },
      adminUser,
    );
  };
  const handleSoftRemove = async (r) => {
    if (!window.confirm(`Move this review to Deleted? You can restore later.`))
      return;
    await removeReview(r.id, adminUser);
    await logAudit(
      "review_soft_deleted",
      "review",
      r.id,
      { entityName: reviewLabel(r) },
      adminUser,
    );
  };
  const handleRestore = async (r) => {
    await restoreDeletedReview(r.id);
    await logAudit(
      "review_restored",
      "review",
      r.id,
      { entityName: reviewLabel(r) },
      adminUser,
    );
  };
  const handlePermanent = async (r) => {
    if (
      !window.confirm(
        `Permanently delete this review? CANNOT be undone.`,
      )
    )
      return;
    await permanentlyDeleteReview(r.id);
    await logAudit(
      "review_hard_deleted",
      "review",
      r.id,
      { entityName: reviewLabel(r) },
      adminUser,
    );
  };

  return (
    <>
      <div style={{ marginBottom: 11 }}>
        {[
          ["all", "All"],
          ["visible", "Visible"],
          ["flagged", "Flagged"],
          [
            "deleted",
            `Deleted${deletedReviewsCount ? ` (${deletedReviewsCount})` : ""}`,
          ],
        ].map(([k, l]) => (
          <Chip
            key={k}
            label={l}
            active={filter === k}
            onClick={() => setFilter(k)}
          />
        ))}
      </div>
      <Card style={{ marginBottom: 14 }}>
        {filtered.length === 0 ? (
          <Empty icon="⭐" text="No reviews" />
        ) : (
          <Tbl
            headers={[
              "Vendor",
              "Reviewer",
              "Rating",
              "Review",
              "Date",
              "Status",
              "Actions",
            ]}
            rows={pager.slice.map((r, i) => (
              <tr key={r.id || i}>
                <TD style={{ fontWeight: 600, color: t.text1, fontSize: 11 }}>
                  {r.vendorName || r.vendor || "—"}
                </TD>
                <TD style={{ fontSize: 11 }}>{r.userName || r.user || "—"}</TD>
                <TD>
                  <Stars n={r.rating || 0} />
                </TD>
                <TD
                  style={{
                    maxWidth: 160,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.text || "—"}
                </TD>
                <TD style={{ fontSize: 10, color: t.muted }}>
                  {r.createdAt ? toDate(s.createdAt) : null?.toLocaleDateString() ||
                    r.date ||
                    "—"}
                </TD>
                <TD>
                  <Badge status={r.deletedAt ? "deleted" : r.status || "visible"} />
                </TD>
                <TD>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {r.deletedAt ? (
                      <>
                        <Btn
                          variant="success"
                          style={{ padding: "2px 7px", fontSize: 10 }}
                          onClick={() => handleRestore(r)}
                        >
                          Restore
                        </Btn>
                        <Btn
                          variant="danger"
                          style={{ padding: "2px 7px", fontSize: 10 }}
                          onClick={() => handlePermanent(r)}
                        >
                          Delete forever
                        </Btn>
                      </>
                    ) : (
                      <>
                        {r.status === "flagged" ? (
                          <Btn
                            variant="success"
                            style={{ padding: "2px 7px", fontSize: 10 }}
                            onClick={() => handleUnflag(r)}
                          >
                            Unflag
                          </Btn>
                        ) : (
                          <Btn
                            style={{ padding: "2px 7px", fontSize: 10 }}
                            onClick={() => handleFlag(r)}
                          >
                            Flag
                          </Btn>
                        )}
                        <Btn
                          variant="danger"
                          style={{ padding: "2px 7px", fontSize: 10 }}
                          onClick={() => handleSoftRemove(r)}
                        >
                          Delete
                        </Btn>
                      </>
                    )}
                  </div>
                </TD>
              </tr>
            ))}
          />
        )}
        <Pager {...pager} />
      </Card>
    </>
  );
}

// Map raw audit action strings to human-readable labels + a glyph + a
// semantic color. Anything not listed falls through to a sensible default
// derived from the action keyword (created/approved → green, deleted/
// rejected → red, soft_deleted/restored → blue/amber, etc.).
const AUDIT_ACTION_META = {
  vendor_created: { label: "Vendor created", icon: "+", color: "#22c55e" },
  vendor_kyc_approved: { label: "KYC approved", icon: "✓", color: "#22c55e" },
  vendor_kyc_rejected: { label: "KYC rejected", icon: "✕", color: "#ef4444" },
  vendor_suspended: { label: "Vendor suspended", icon: "⏸", color: "#f59e0b" },
  vendor_soft_deleted: { label: "Vendor moved to Deleted", icon: "🗑", color: "#f59e0b" },
  vendor_restored: { label: "Vendor restored", icon: "↻", color: "#3b82f6" },
  vendor_hard_deleted: { label: "Vendor permanently deleted", icon: "✕", color: "#ef4444" },
  vendor_doc_replaced: { label: "Vendor doc replaced", icon: "↻", color: "#3b82f6" },
  vendor_doc_deleted: { label: "Vendor doc deleted", icon: "🗑", color: "#f59e0b" },
  user_blocked: { label: "User blocked", icon: "🚫", color: "#ef4444" },
  user_unbanned: { label: "User unbanned", icon: "✓", color: "#22c55e" },
  review_flagged: { label: "Review flagged", icon: "⚐", color: "#f59e0b" },
  review_unflagged: { label: "Review unflagged", icon: "✓", color: "#22c55e" },
  review_soft_deleted: { label: "Review moved to Deleted", icon: "🗑", color: "#f59e0b" },
  review_restored: { label: "Review restored", icon: "↻", color: "#3b82f6" },
  review_hard_deleted: { label: "Review permanently deleted", icon: "✕", color: "#ef4444" },
  request_cancelled: { label: "Request cancelled", icon: "⏹", color: "#f59e0b" },
  broadcast_sent: { label: "Notification sent", icon: "🔔", color: "#3b82f6" },
  config_changed: { label: "Config updated", icon: "⚙", color: "#a855f7" },
  // Mobile (customer) actions
  emergency_contact_added: { label: "Emergency contact added", icon: "+", color: "#22c55e" },
  emergency_contact_updated: { label: "Emergency contact updated", icon: "✎", color: "#3b82f6" },
  emergency_contact_deleted: { label: "Emergency contact removed", icon: "🗑", color: "#f59e0b" },
  sos_triggered: { label: "🆘 SOS triggered", icon: "🆘", color: "#ef4444" },
  service_request_created: { label: "Service request created", icon: "+", color: "#22c55e" },
  service_request_cancelled: { label: "Service request cancelled", icon: "⏹", color: "#f59e0b" },
  service_request_completed: { label: "Service request completed", icon: "✓", color: "#22c55e" },
  review_submitted: { label: "Review submitted", icon: "★", color: "#22c55e" },
  user_signed_up: { label: "Account created", icon: "+", color: "#22c55e" },
  user_signed_in: { label: "Signed in", icon: "→", color: "#3b82f6" },
  user_signed_out: { label: "Signed out", icon: "←", color: "#6b7280" },
  user_profile_updated: { label: "Profile updated", icon: "✎", color: "#3b82f6" },
  vehicle_added: { label: "Vehicle added", icon: "+", color: "#22c55e" },
  vehicle_updated: { label: "Vehicle updated", icon: "✎", color: "#3b82f6" },
  vehicle_deleted: { label: "Vehicle removed", icon: "🗑", color: "#f59e0b" },
  vehicle_primary_set: { label: "Primary vehicle changed", icon: "★", color: "#3b82f6" },
  // Mobile (vendor) actions
  vendor_went_online: { label: "Vendor went online", icon: "●", color: "#22c55e" },
  vendor_went_offline: { label: "Vendor went offline", icon: "○", color: "#6b7280" },
  vendor_profile_updated: { label: "Vendor profile updated", icon: "✎", color: "#3b82f6" },
  vendor_job_accepted: { label: "Vendor accepted job", icon: "✓", color: "#22c55e" },
  vendor_job_declined: { label: "Vendor declined job", icon: "✕", color: "#ef4444" },
  vendor_job_completed: { label: "Vendor completed job", icon: "✓", color: "#22c55e" },
  vendor_job_onTheWay: { label: "Vendor on the way", icon: "→", color: "#3b82f6" },
  vendor_job_arrived: { label: "Vendor arrived", icon: "⚑", color: "#3b82f6" },
};

const ACTOR_TYPE_META = {
  admin: { label: "Admin", color: "#a855f7" },
  customer: { label: "Customer", color: "#3b82f6" },
  vendor: { label: "Vendor", color: "#f59e0b" },
  system: { label: "System", color: "#6b7280" },
};

function auditActionMeta(action) {
  const m = AUDIT_ACTION_META[action];
  if (m) return m;
  const a = String(action || "");
  if (/(_hard_deleted|_rejected|_blocked)$/.test(a))
    return { label: a.replace(/_/g, " "), icon: "✕", color: "#ef4444" };
  if (/(_soft_deleted|_suspended|_flagged|_cancelled)$/.test(a))
    return { label: a.replace(/_/g, " "), icon: "🗑", color: "#f59e0b" };
  if (/(_restored|_unflagged|_unbanned|_replaced)$/.test(a))
    return { label: a.replace(/_/g, " "), icon: "↻", color: "#3b82f6" };
  if (/(_created|_approved|_added)$/.test(a))
    return { label: a.replace(/_/g, " "), icon: "✓", color: "#22c55e" };
  return { label: a.replace(/_/g, " ") || "Event", icon: "▶", color: "#6b7280" };
}

function Notifications_Page() {
  const t = useTheme();
  const { notifications, adminUser, users, vendors } = useAdmin();
  // mode: see NotificationPanel above for full description.
  const [form, setForm] = useState({
    title: "",
    body: "",
    topic: "all",
    mode: "topic",
    selectedUids: [],
  });
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleSend = async () => {
    const title = form.title.trim();
    const body = form.body.trim();
    if (title.length < 3 || title.length > 100) {
      setResult({ ok: false, msg: "Title must be 3–100 characters." });
      return;
    }
    if (body.length < 3 || body.length > 500) {
      setResult({ ok: false, msg: "Body must be 3–500 characters." });
      return;
    }
    if (form.mode === "users" && form.selectedUids.length === 0) {
      setResult({ ok: false, msg: "Pick at least one recipient." });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const useTokens =
        form.mode === "tokens" &&
        (form.topic === "all" ||
          form.topic === "users" ||
          form.topic === "vendors");
      const useUserPicker = form.mode === "users";

      const audience = form.topic === "vendors" ? "vendors" : "users";

      const r = useUserPicker
        ? await sendNotificationToUsers({
            title,
            body,
            uids: form.selectedUids,
            sentBy: adminUser?.email || "admin",
          })
        : useTokens
        ? await sendNotificationToAudience({
            title,
            body,
            audience,
            sentBy: adminUser?.email || "admin",
          })
        : await sendNotification({
            ...form,
            sentBy: adminUser?.email || "admin",
          });
      await logAudit(
        "broadcast_sent",
        "notification",
        form.topic || "all",
        {
          entityName: form.title,
          topic: useUserPicker
            ? `selected:${form.selectedUids.length}`
            : form.topic || "all",
          mode: useUserPicker ? "users" : useTokens ? "tokens" : "topic",
          body: form.body,
          deliveryStatus: r?.deliveryStatus,
          successCount: r?.successCount,
          failureCount: r?.failureCount,
          recipients: r?.recipients,
        },
        adminUser,
      );
      if (
        r?.deliveryStatus === "delivered" ||
        r?.deliveryStatus === "delivered_legacy"
      ) {
        setResult({
          ok: true,
          msg: useUserPicker
            ? `Saved and pushed to ${r.successCount} of ${r.recipients} recipients` +
              (r.failureCount ? ` (${r.failureCount} failed).` : ".")
            : useTokens
            ? `Saved and pushed to ${r.successCount} device(s)${
                r.failureCount ? ` (${r.failureCount} failed)` : ""
              }.`
            : r.deliveryStatus === "delivered_legacy"
            ? "Sent via legacy Cloud Function."
            : "Saved and pushed to subscribers.",
        });
      } else if (r?.deliveryStatus === "partial") {
        setResult({
          ok: true,
          msg: `Sent to ${r.successCount}/${r.sentTokens} devices. ${r.failureCount} failed.`,
        });
      } else if (r?.deliveryStatus === "no_tokens") {
        setResult({
          ok: false,
          msg: useUserPicker
            ? `Saved to ${r.recipients} inbox(es), but none of them have a registered device.`
            : "Saved, but no devices have registered an FCM token yet.",
        });
      } else {
        setResult({
          ok: false,
          msg:
            "Saved to history but push failed: " +
            (r?.deliveryError || "unknown error"),
        });
      }
      setTimeout(() => setResult(null), 6000);
      setForm({
        title: "",
        body: "",
        topic: "all",
        mode: "topic",
        selectedUids: [],
      });
    } catch (e) {
      setResult({ ok: false, msg: e.message || "Send failed." });
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="ra-chart-grid"
      style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
    >
      <Card>
        <CT>Send Notification</CT>
        {result && (
          <div
            style={{
              background: result.ok ? "#dcfce7" : "#fef2f2",
              border: `1px solid ${result.ok ? "#bbf7d0" : "#fecaca"}`,
              borderRadius: 8,
              padding: "10px 12px",
              marginBottom: 12,
              fontSize: 12,
              color: result.ok ? "#16a34a" : "#dc2626",
              fontWeight: 600,
              lineHeight: 1.4,
            }}
          >
            {result.ok ? "✓ " : "⚠ "}
            {result.msg}
          </div>
        )}
        <FG label="Title (3–100 chars)">
          <Inp
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="e.g. Road Closure Alert"
            maxLength={100}
          />
        </FG>
        <FG label="Body (3–500 chars)">
          <textarea
            value={form.body}
            onChange={(e) => set("body", e.target.value)}
            placeholder="Notification message…"
            rows={4}
            maxLength={500}
            style={{
              background: t.input,
              border: `1px solid ${t.border}`,
              borderRadius: 7,
              padding: "8px 10px",
              color: t.text1,
              fontSize: 12,
              outline: "none",
              width: "100%",
              resize: "vertical",
            }}
          />
        </FG>
        <FG label="Delivery method">
          <Sel
            value={form.mode}
            onChange={(e) => set("mode", e.target.value)}
          >
            <option value="topic">Topic broadcast — by audience (fastest)</option>
            <option value="tokens">Per-device tokens — by audience</option>
            <option value="users">Specific people — pick from a list</option>
          </Sel>
        </FG>
        {form.mode !== "users" && (
          <FG label="Recipients">
            <Sel
              value={form.topic}
              onChange={(e) => set("topic", e.target.value)}
            >
              <option value="all">All Users (everyone)</option>
              <option value="users">End Users only</option>
              <option value="vendors">All Vendors</option>
              <option value="karachi">Karachi Only</option>
              <option value="lahore">Lahore Only</option>
            </Sel>
          </FG>
        )}
        {form.mode === "users" && (
          <FG label="Pick recipients">
            <RecipientPicker
              users={users}
              vendors={vendors}
              value={form.selectedUids}
              onChange={(next) => set("selectedUids", next)}
              t={t}
            />
          </FG>
        )}
        <Btn
          variant="primary"
          onClick={handleSend}
          disabled={sending || !form.title || !form.body}
          style={{
            width: "100%",
            justifyContent: "center",
            marginTop: 4,
          }}
        >
          {sending ? "Sending…" : "📢 Send Notification"}
        </Btn>
        <div style={{ fontSize: 11, color: t.muted, marginTop: 10 }}>
          Tip: devices must subscribe to the matching FCM topic in your
          mobile app for push to be delivered. The "all" topic should be
          subscribed-to on app first launch.
        </div>
      </Card>

      <Card>
        <CT>History</CT>
        {notifications.length === 0 ? (
          <Empty icon="🔔" text="No notifications sent yet" />
        ) : (
          <div style={{ maxHeight: 480, overflowY: "auto" }}>
            {notifications.map((n, i) => (
              <div
                key={n.id || i}
                style={{
                  borderBottom: `1px solid ${t.border}`,
                  padding: "10px 0",
                }}
              >
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: t.text1 }}
                >
                  {n.title || "—"}
                </div>
                <div
                  style={{
                    fontSize: 11,
                    color: t.text2,
                    marginTop: 3,
                    lineHeight: 1.4,
                  }}
                >
                  {n.body || ""}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: t.muted,
                    marginTop: 4,
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span>To: {n.topic || "all"}</span>
                  {n.sentBy && <span>· {n.sentBy}</span>}
                  {toDate(n.sentAt) && (
                    <span>· {toDate(n.sentAt).toLocaleString()}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function AuditLog_Page() {
  const t = useTheme();
  const { auditLogData } = useAdmin();
  const [filter, setFilter] = useState("all");
  const [actorFilter, setActorFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const actionTypes = [
    "all",
    "vendor",
    "user",
    "request",
    "review",
    "notification",
    "config",
    "contact",
    "sos",
    "vehicle",
  ];
  const actorTypes = ["all", "admin", "customer", "vendor", "system"];

  // Older entries don't carry actorType; fall back to "admin" so the
  // filter remains meaningful for legacy rows.
  const resolvedActorType = (a) => a.actorType || "admin";
  const resolvedActorName = (a) =>
    a.actorName || a.adminName || a.actorEmail || "Unknown";

  const matchesSearch = (a) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      (a.entityName || "").toLowerCase().includes(s) ||
      (a.action || "").toLowerCase().includes(s) ||
      (resolvedActorName(a) || "").toLowerCase().includes(s) ||
      (a.entityId || "").toLowerCase().includes(s)
    );
  };
  const filtered = auditLogData.filter(
    (a) =>
      (filter === "all" || a.entityType === filter) &&
      (actorFilter === "all" || resolvedActorType(a) === actorFilter) &&
      matchesSearch(a),
  );
  const pager = usePagination(
    filtered,
    25,
    `${filter}|${actorFilter}|${search}`,
  );

  const toggleExpand = (id) =>
    setExpanded((p) => ({ ...p, [id]: !p[id] }));

  return (
    <>
      <div style={{ marginBottom: 9 }}>
        <SBar
          placeholder="Search by entity name, action, actor…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: t.muted, marginRight: 8 }}>
          Actor:
        </span>
        {actorTypes.map((f) => (
          <Chip
            key={f}
            label={f === "all" ? "All" : ACTOR_TYPE_META[f]?.label || f}
            active={actorFilter === f}
            onClick={() => setActorFilter(f)}
          />
        ))}
      </div>
      <div style={{ marginBottom: 11 }}>
        <span style={{ fontSize: 10, color: t.muted, marginRight: 8 }}>
          Entity:
        </span>
        {actionTypes.map((f) => (
          <Chip
            key={f}
            label={f.charAt(0).toUpperCase() + f.slice(1)}
            active={filter === f}
            onClick={() => setFilter(f)}
          />
        ))}
      </div>
      <Card>
        <CT action="Export CSV">Activity History</CT>
        {filtered.length === 0 ? (
          <Empty icon="📜" text="No audit records" />
        ) : (
          pager.slice.map((a, i) => {
            const meta = auditActionMeta(a.action);
            const actorType = resolvedActorType(a);
            const actorMeta = ACTOR_TYPE_META[actorType] || ACTOR_TYPE_META.admin;
            const actorName = resolvedActorName(a);
            const name =
              a.entityName || a.details?.entityName || a.entityId || "—";
            const reason = a.details?.reason;
            const ts = toDate(a.timestamp);
            const rowId = a.id || `${i}`;
            const isOpen = !!expanded[rowId];
            const detailKeys = a.details
              ? Object.keys(a.details).filter(
                  (k) => k !== "entityName" && k !== "reason",
                )
              : [];
            return (
              <div
                key={rowId}
                style={{
                  display: "flex",
                  gap: 9,
                  alignItems: "flex-start",
                  padding: "9px 0",
                  borderBottom: `1px solid ${t.border}`,
                  cursor: detailKeys.length ? "pointer" : "default",
                }}
                onClick={() => detailKeys.length && toggleExpand(rowId)}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    background: `${meta.color}18`,
                    color: meta.color,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 12,
                    flexShrink: 0,
                  }}
                >
                  {meta.icon}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: t.text1,
                      fontWeight: 600,
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 6,
                      alignItems: "baseline",
                    }}
                  >
                    <span
                      style={{
                        background: `${actorMeta.color}22`,
                        color: actorMeta.color,
                        fontSize: 9,
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontWeight: 700,
                        textTransform: "uppercase",
                        letterSpacing: 0.3,
                      }}
                    >
                      {actorMeta.label}
                    </span>
                    <span>{meta.label}</span>
                    <span style={{ color: t.orange, fontWeight: 500 }}>
                      {name}
                    </span>
                  </div>
                  {reason && (
                    <div
                      style={{
                        fontSize: 11,
                        color: t.text2,
                        marginTop: 2,
                        fontStyle: "italic",
                      }}
                    >
                      Reason: {reason}
                    </div>
                  )}
                  <div style={{ fontSize: 10, color: t.muted, marginTop: 2 }}>
                    By {actorName}
                    {a.actorEmail && a.actorEmail !== actorName
                      ? ` (${a.actorEmail})`
                      : ""}
                    {ts ? ` · ${ts.toLocaleString()}` : ""}
                    {a.entityId && a.entityId !== name
                      ? ` · id: ${a.entityId}`
                      : ""}
                    {a.device?.platform ? ` · ${a.device.platform}` : ""}
                    {detailKeys.length
                      ? ` · ${isOpen ? "▾" : "▸"} ${detailKeys.length} detail${detailKeys.length === 1 ? "" : "s"}`
                      : ""}
                  </div>
                  {isOpen && detailKeys.length > 0 && (
                    <pre
                      style={{
                        marginTop: 6,
                        padding: 8,
                        background: t.input,
                        border: `1px solid ${t.border}`,
                        borderRadius: 6,
                        fontSize: 10,
                        color: t.text2,
                        maxHeight: 220,
                        overflow: "auto",
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                      }}
                    >
                      {JSON.stringify(a.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            );
          })
        )}
        <Pager {...pager} />
      </Card>
    </>
  );
}

function Settings_Page() {
  const t = useTheme();
  const { adminUser } = useAdmin();
  const [tab, setTab] = useState("app");
  const [config, setConfig] = useState({
    searchRadius: 10,
    resultLimit: 20,
    sosCooldown: 3,
    helpline: "1122",
    maintenanceMode: false,
    aiEnabled: true,
    selfRegistration: true,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errs, setErrs] = useState({});

  useEffect(() => {
    const unsub = getAppConfig((data) => {
      if (data) setConfig((p) => ({ ...p, ...data }));
    });
    return unsub;
  }, []);

  const validateConfig = () => {
    const e = {};
    e.searchRadius = V.positiveInt(1, 100)(config.searchRadius);
    e.resultLimit = V.positiveInt(1, 200)(config.resultLimit);
    e.sosCooldown = V.positiveInt(0, 60)(config.sosCooldown);
    e.helpline = V.helpline(config.helpline);
    for (const k of Object.keys(e)) if (!e[k]) delete e[k];
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (!validateConfig()) return;
    setSaving(true);
    try {
      await saveAppConfig(config);
      await logAudit(
        "config_changed",
        "config",
        "main",
        { entityName: "App Config", changes: config },
        adminUser,
      );
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const inp = {
    background: t.input,
    border: `1px solid ${t.border}`,
    borderRadius: 7,
    padding: "8px 10px",
    color: t.text1,
    fontSize: 12,
    outline: "none",
    width: "100%",
  };

  return (
    <>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        {[
          ["app", "App Config"],
          ["flags", "Feature Flags"],
          ["zones", "Zones"],
          ["admins", "Admin Users"],
        ].map(([k, l]) => (
          <Btn
            key={k}
            variant={tab === k ? "primary" : "ghost"}
            onClick={() => setTab(k)}
          >
            {l}
          </Btn>
        ))}
      </div>
      {tab === "app" && (
        <div
          className="ra-form-grid"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          <Card>
            <CT>App Configuration</CT>
            {saved && (
              <div
                style={{
                  background: "#dcfce7",
                  border: "1px solid #bbf7d0",
                  borderRadius: 8,
                  padding: "8px 12px",
                  fontSize: 12,
                  color: "#16a34a",
                  marginBottom: 12,
                }}
              >
                ✓ Configuration saved to Supabase!
              </div>
            )}
            <FG
              label="Vendor Search Radius (km, 1–100)"
              error={errs.searchRadius}
            >
              <input
                value={config.searchRadius}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setConfig((p) => ({ ...p, searchRadius: v }));
                  setErrs((p) => ({ ...p, searchRadius: undefined }));
                }}
                type="number"
                inputMode="numeric"
                min={1}
                max={100}
                style={{
                  ...inp,
                  borderColor: errs.searchRadius ? "#dc2626" : t.border,
                }}
              />
            </FG>
            <FG label="Vendor Result Limit (1–200)" error={errs.resultLimit}>
              <input
                value={config.resultLimit}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setConfig((p) => ({ ...p, resultLimit: v }));
                  setErrs((p) => ({ ...p, resultLimit: undefined }));
                }}
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                style={{
                  ...inp,
                  borderColor: errs.resultLimit ? "#dc2626" : t.border,
                }}
              />
            </FG>
            <FG label="SOS Cooldown (seconds, 0–60)" error={errs.sosCooldown}>
              <input
                value={config.sosCooldown}
                onChange={(e) => {
                  const v = e.target.value.replace(/\D/g, "");
                  setConfig((p) => ({ ...p, sosCooldown: v }));
                  setErrs((p) => ({ ...p, sosCooldown: undefined }));
                }}
                type="number"
                inputMode="numeric"
                min={0}
                max={60}
                style={{
                  ...inp,
                  borderColor: errs.sosCooldown ? "#dc2626" : t.border,
                }}
              />
            </FG>
            <FG label="Emergency Helpline" error={errs.helpline}>
              <input
                value={config.helpline}
                onChange={(e) => {
                  setConfig((p) => ({ ...p, helpline: e.target.value }));
                  setErrs((p) => ({ ...p, helpline: undefined }));
                }}
                type="tel"
                inputMode="tel"
                maxLength={20}
                style={{
                  ...inp,
                  borderColor: errs.helpline ? "#dc2626" : t.border,
                }}
              />
            </FG>
            <div
              style={{
                borderTop: `1px solid ${t.border}`,
                marginTop: 13,
                paddingTop: 13,
              }}
            >
              {[
                [
                  "maintenanceMode",
                  "Maintenance Mode",
                  "Shows maintenance screen to all users",
                ],
                [
                  "aiEnabled",
                  "AI Features (Gemini)",
                  "Enable/disable Gemini in-app globally",
                ],
                [
                  "selfRegistration",
                  "Vendor Self-Registration",
                  "Allow public /register form",
                ],
              ].map(([k, n, d]) => (
                <div
                  key={k}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 11,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 12, color: t.text1 }}>{n}</div>
                    <div style={{ fontSize: 10, color: t.muted }}>{d}</div>
                  </div>
                  <Tog
                    checked={!!config[k]}
                    onChange={() => setConfig((p) => ({ ...p, [k]: !p[k] }))}
                  />
                </div>
              ))}
            </div>
            <Btn variant="primary" onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save to Supabase"}
            </Btn>
          </Card>
          <Card>
            <CT>Registration Link</CT>
            <div
              style={{
                background: t.input,
                border: `1px solid ${t.border}`,
                borderRadius: 10,
                padding: 14,
                marginBottom: 12,
              }}
            >
              <div style={{ fontSize: 11, color: t.muted, marginBottom: 6 }}>
                PUBLIC VENDOR REGISTRATION URL
              </div>
              <div
                style={{
                  fontFamily: "monospace",
                  fontSize: 12,
                  color: t.orange,
                  wordBreak: "break-all",
                }}
              >
                https://roadassistpro.pk/register
              </div>
              <div style={{ fontSize: 11, color: t.muted, marginTop: 8 }}>
                Share this link with mechanics, tow truck operators, fuel
                suppliers, etc. Applications go straight to your Vendors → KYC
                queue.
              </div>
            </div>
            <div
              style={{
                background: "#f0fdf4",
                border: "1px solid #bbf7d0",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#16a34a",
                  marginBottom: 6,
                }}
              >
                Self-registration is{" "}
                {config.selfRegistration ? "ENABLED" : "DISABLED"}
              </div>
              <div style={{ fontSize: 11, color: "#166534" }}>
                Toggle above to enable/disable the public registration form.
              </div>
            </div>
          </Card>
        </div>
      )}
      {tab === "flags" && <FeatureFlagsTab />}
      {tab === "zones" && <ZonesTab />}
      {tab === "admins" && <AdminUsersTab />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
//  Settings -> Feature Flags (live runtime toggles)
// ─────────────────────────────────────────────────────────────────
// Stored at app_config/flags. Both the Flutter app and this panel stream
// the doc so flipping a switch propagates everywhere within seconds. Each
// flag below maps to a real consumer in code — see FeatureFlagsService in
// the Flutter app and the call sites in admin-panel/firebase.js.
// Each flag here is written for a non-technical admin: the label says
// what the user sees, and the description tells them in plain words what
// happens when it's ON vs OFF and when they might want to flip it.
const FLAG_GROUPS = [
  {
    title: "Vendors",
    items: [
      [
        "vendorSelfRegistration",
        "Allow vendors to sign themselves up",
        "ON: anyone with the registration link can apply to join as a vendor. OFF: only you can add vendors from this panel. Turn off if you're getting too many low-quality applications.",
      ],
      [
        "vendorAppEnabled",
        "Vendors can log into the mobile app",
        "ON: approved vendors can sign in and accept customer jobs. OFF: vendors are temporarily locked out of the app — useful during a system issue or update.",
      ],
      [
        "kycStrict",
        "Require ID and license before approving",
        "ON: every vendor must upload CNIC, business license, and a photo before you can approve them. OFF: you can approve vendors with whatever documents they've provided.",
      ],
    ],
  },
  {
    title: "Customer experience",
    items: [
      [
        "liveLocationTracking",
        "Show vendor's live location to customer",
        "ON: while a vendor is on the way, the customer sees them moving on the map in real time. OFF: customer just sees a status (\"On the way\", \"Arrived\") without the moving pin.",
      ],
      [
        "simulatedTrackingFallback",
        "Demo mode (fake vendor moving)",
        "ON: even with no real vendor active, the customer's tracking screen will pretend a vendor is on the way (auto-progressing every 8 seconds). Use only when showing the app to investors or for a demo. Keep OFF in production.",
      ],
      [
        "autoCompleteOnArrived",
        "Auto-finish job 2 seconds after \"Arrived\"",
        "ON: the moment a vendor marks \"I've arrived\", the customer's screen wraps up the job automatically. OFF: the vendor has to also press \"Mark complete\" themselves.",
      ],
      [
        "reviewsEnabled",
        "Let customers leave a rating and review",
        "ON: after a job is done, the customer is prompted to give the vendor 1–5 stars. OFF: no rating step — useful if you want to disable reviews during a problem period.",
      ],
    ],
  },
  {
    title: "Notifications & alerts",
    items: [
      [
        "fcmPushEnabled",
        "Send push notifications at all",
        "Master ON/OFF switch for all push notifications across the app. Turn OFF temporarily if push is broken or spamming users — nothing will be delivered until you turn it back on.",
      ],
      [
        "autoNotifyVendorOnRequest",
        "Auto-alert nearby vendors of a new request",
        "ON: when a customer requests help, vendors get an instant push notification on their phone. OFF: no automatic ping — you'll have to call/notify vendors yourself.",
      ],
      [
        "smsNotifications",
        "Send SMS messages",
        "ON: send updates by SMS as well as push (handy if a customer's app is closed). OFF: no SMS. Note: needs an SMS provider account configured — leave OFF if you haven't set one up.",
      ],
      [
        "whatsappNotifications",
        "Send WhatsApp messages",
        "Same as SMS but via WhatsApp Business. ON: customers get WhatsApp notifications. OFF: nothing sent. Requires a WhatsApp Business account.",
      ],
    ],
  },
  {
    title: "Other features",
    items: [
      [
        "sosEnabled",
        "Show the emergency SOS button",
        "ON: customers see the red SOS button at the bottom of the home screen. OFF: SOS is hidden — only turn off if it's being misused or you don't have an emergency response plan in place.",
      ],
      [
        "aiAssistantEnabled",
        "Show the AI chat assistant",
        "ON: customers can chat with the AI helper inside the app. OFF: the AI chat tab is hidden. Turn off if AI costs are too high or the assistant is giving bad answers.",
      ],
      [
        "paymentCollection",
        "Collect payments inside the app",
        "ON: at the end of a job, customers pay through the app (JazzCash / Easypaisa). OFF: customers pay vendors directly in cash. Keep OFF until the payment provider is fully connected.",
      ],
    ],
  },
  {
    title: "Maintenance",
    items: [
      [
        "appUnderMaintenance",
        "Show maintenance screen to everyone",
        "ON: every user (customer and vendor) opening the app sees a friendly \"we'll be right back\" screen instead of the normal app. Use this while pushing a big update so people don't hit broken screens. Remember to turn it OFF after.",
      ],
    ],
  },
];

function FeatureFlagsTab() {
  const t = useTheme();
  const { adminUser } = useAdmin();
  const [flags, setFlags] = useState(DEFAULT_FLAGS);
  const [savedSnapshot, setSavedSnapshot] = useState(DEFAULT_FLAGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const unsub = getFeatureFlags((data) => {
      setFlags(data);
      setSavedSnapshot(data);
      setLoading(false);
    });
    return unsub;
  }, []);

  const setFlag = (k, v) => setFlags((p) => ({ ...p, [k]: v }));

  const handleSave = async () => {
    setSaving(true);
    try {
      // Compute the delta between what was saved and what's about to be
      // saved so the audit log shows what actually changed instead of
      // dumping the entire flag object on every save.
      const delta = {};
      for (const k of Object.keys(flags)) {
        if (savedSnapshot[k] !== flags[k]) {
          delta[k] = { from: savedSnapshot[k], to: flags[k] };
        }
      }
      await saveFeatureFlags(flags);
      await logAudit(
        "feature_flags_updated",
        "config",
        "flags",
        {
          entityName: "Feature Flags",
          changes: delta,
          changedKeys: Object.keys(delta),
        },
        adminUser,
      );
      setSavedSnapshot(flags);
      setSaved(true);
      setTimeout(() => setSaved(false), 2200);
    } finally {
      setSaving(false);
    }
  };

  const handleResetDefaults = async () => {
    if (!window.confirm("Reset all feature flags to defaults?")) return;
    setFlags({ ...DEFAULT_FLAGS });
  };

  if (loading) {
    return <div style={{ padding: 24, color: t.muted }}>Loading flags…</div>;
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
         className="ra-form-grid">
      <Card>
        <CT>Live Feature Flags</CT>
        {saved && (
          <div
            style={{
              background: "#dcfce7",
              border: "1px solid #bbf7d0",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              color: "#16a34a",
              marginBottom: 12,
            }}
          >
            ✓ Saved! Changes will reach customer and vendor apps within a few
            seconds — no app update needed.
          </div>
        )}
        <div
          style={{
            background: "#eff6ff",
            border: "1px solid #bfdbfe",
            borderRadius: 10,
            padding: "10px 12px",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: "#1d4ed8",
              marginBottom: 4,
            }}
          >
            What is this page?
          </div>
          <div style={{ fontSize: 11, color: "#1e3a8a", lineHeight: 1.5 }}>
            Each switch below turns a feature on or off across the whole app.
            Flip a switch and it takes effect for every user (customers and
            vendors) within a few seconds — no need to update the app on
            anyone's phone. <strong>Don't forget to press "Save Flags"</strong>{" "}
            at the bottom of this column when you're done.
          </div>
        </div>
        {FLAG_GROUPS.slice(0, Math.ceil(FLAG_GROUPS.length / 2)).map((group) => (
          <FlagGroup key={group.title} group={group} flags={flags} setFlag={setFlag} t={t} />
        ))}
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          <Btn variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save Flags"}
          </Btn>
          <Btn variant="ghost" onClick={handleResetDefaults}>
            Reset to defaults
          </Btn>
        </div>
      </Card>
      <Card>
        <CT>More flags</CT>
        {FLAG_GROUPS.slice(Math.ceil(FLAG_GROUPS.length / 2)).map((group) => (
          <FlagGroup key={group.title} group={group} flags={flags} setFlag={setFlag} t={t} />
        ))}
        {flags.appUnderMaintenance && (
          <div
            style={{
              borderTop: `1px solid ${t.border}`,
              marginTop: 12,
              paddingTop: 12,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: t.text1, marginBottom: 6 }}>
              Message shown to users during maintenance
            </div>
            <textarea
              value={flags.maintenanceMessage || ""}
              onChange={(e) => setFlag("maintenanceMessage", e.target.value)}
              placeholder="We're upgrading our service. Back in 30 minutes."
              rows={3}
              style={{
                width: "100%",
                background: t.input,
                border: `1px solid ${t.border}`,
                borderRadius: 7,
                padding: "8px 10px",
                color: t.text1,
                fontSize: 12,
                outline: "none",
                resize: "vertical",
              }}
            />
            <div style={{ fontSize: 10, color: t.muted, marginTop: 4 }}>
              Write a short, friendly note. This is what every user will see on
              the maintenance screen.
            </div>
          </div>
        )}
        <div
          style={{
            borderTop: `1px solid ${t.border}`,
            marginTop: 12,
            paddingTop: 12,
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: t.text1, marginBottom: 6 }}>
            How many jobs can a vendor handle at once?
          </div>
          <input
            value={flags.maxActiveJobsPerVendor}
            onChange={(e) =>
              setFlag(
                "maxActiveJobsPerVendor",
                Math.max(1, parseInt(e.target.value || "1", 10)),
              )
            }
            type="number"
            min={1}
            max={10}
            style={{
              width: 90,
              background: t.input,
              border: `1px solid ${t.border}`,
              borderRadius: 7,
              padding: "8px 10px",
              color: t.text1,
              fontSize: 12,
              outline: "none",
            }}
          />
          <div style={{ fontSize: 10, color: t.muted, marginTop: 4 }}>
            The most jobs a vendor can have accepted at the same time.
            Recommended: 1 (so they finish one before taking another).
          </div>
        </div>
      </Card>
    </div>
  );
}

function FlagGroup({ group, flags, setFlag, t }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          color: t.muted,
          textTransform: "uppercase",
          letterSpacing: 0.6,
          marginBottom: 8,
        }}
      >
        {group.title}
      </div>
      {group.items.map(([k, n, d]) => {
        const on = !!flags[k];
        return (
          <div
            key={k}
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              padding: "10px 0",
              borderBottom: `1px dashed ${t.border}`,
              gap: 10,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ fontSize: 12, color: t.text1, fontWeight: 600 }}>
                  {n}
                </div>
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    letterSpacing: 0.5,
                    color: on ? "#16a34a" : t.muted,
                    background: on ? "#dcfce7" : "transparent",
                    border: on ? "1px solid #bbf7d0" : `1px solid ${t.border}`,
                    padding: "2px 6px",
                    borderRadius: 999,
                  }}
                >
                  {on ? "ON" : "OFF"}
                </span>
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: t.muted,
                  lineHeight: 1.5,
                  marginTop: 4,
                }}
              >
                {d}
              </div>
            </div>
            <Tog checked={on} onChange={() => setFlag(k, !on)} />
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  Settings -> Zones (dynamic, Firestore-backed)
// ─────────────────────────────────────────────────────────────────
function ZonesTab() {
  const t = useTheme();
  const { adminUser } = useAdmin();
  const [zones, setZones] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editZone, setEditZone] = useState(null);
  useEffect(() => getZones(setZones), []);

  const handleDelete = async (z) => {
    if (!window.confirm(`Delete zone "${z.name}"? This cannot be undone.`))
      return;
    await deleteZone(z.id);
    await logAudit(
      "zone_deleted",
      "zone",
      z.id,
      { entityName: z.name },
      adminUser,
    );
  };

  return (
    <>
      {showAdd && <ZoneModal onClose={() => setShowAdd(false)} />}
      {editZone && (
        <ZoneModal
          existing={editZone}
          onClose={() => setEditZone(null)}
        />
      )}
      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <CT>Service Zones</CT>
          <Btn
            variant="primary"
            style={{ fontSize: 11 }}
            onClick={() => setShowAdd(true)}
          >
            + Add Zone
          </Btn>
        </div>
        {zones.length === 0 ? (
          <Empty icon="🗺" text="No zones yet — add one above." />
        ) : (
          zones.map((z) => (
            <div
              key={z.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "10px 0",
                borderBottom: `1px solid ${t.border}`,
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 140 }}>
                <div
                  style={{ fontSize: 13, fontWeight: 600, color: t.text1 }}
                >
                  {z.name || "—"}
                </div>
                <div style={{ fontSize: 11, color: t.muted }}>
                  Avg response: {z.avgResponseMins || 0} min
                </div>
              </div>
              <Badge
                status={
                  z.coverage === "high"
                    ? "verified"
                    : z.coverage === "medium"
                    ? "pending"
                    : "rejected"
                }
                text={
                  z.coverage === "high"
                    ? "High"
                    : z.coverage === "medium"
                    ? "Medium"
                    : "Low"
                }
              />
              <span
                style={{ color: t.orange, fontWeight: 600, fontSize: 13 }}
              >
                {z.vendorCount || 0} vendors
              </span>
              <Btn
                style={{ padding: "3px 8px", fontSize: 10 }}
                onClick={() => setEditZone(z)}
              >
                Edit
              </Btn>
              <Btn
                variant="danger"
                style={{ padding: "3px 8px", fontSize: 10 }}
                onClick={() => handleDelete(z)}
              >
                Delete
              </Btn>
            </div>
          ))
        )}
      </Card>
    </>
  );
}

function ZoneModal({ onClose, existing }) {
  const t = useTheme();
  const { adminUser } = useAdmin();
  const editing = Boolean(existing);
  const [form, setForm] = useState(() => ({
    name: existing?.name || "",
    coverage: existing?.coverage || "high",
    avgResponseMins: existing?.avgResponseMins ?? 0,
    vendorCount: existing?.vendorCount ?? 0,
  }));
  const [errs, setErrs] = useState({});
  const [loading, setLoading] = useState(false);
  const set = (k, v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrs((p) => ({ ...p, [k]: undefined }));
  };
  const validate = () => {
    const e = {};
    e.name = check(form.name, V.required("Zone name required"), V.maxLength(120));
    e.avgResponseMins = V.nonNegativeInt(form.avgResponseMins);
    e.vendorCount = V.nonNegativeInt(form.vendorCount);
    for (const k of Object.keys(e)) if (!e[k]) delete e[k];
    setErrs(e);
    return Object.keys(e).length === 0;
  };
  const save = async () => {
    if (!validate()) return;
    setLoading(true);
    try {
      const payload = {
        name: form.name.trim(),
        coverage: form.coverage,
        avgResponseMins: Number(form.avgResponseMins) || 0,
        vendorCount: Number(form.vendorCount) || 0,
      };
      if (editing) {
        await updateZone(existing.id, payload);
        await logAudit(
          "zone_updated",
          "zone",
          existing.id,
          { entityName: payload.name },
          adminUser,
        );
      } else {
        const ref = await addZone(payload);
        await logAudit(
          "zone_created",
          "zone",
          ref.id,
          { entityName: payload.name },
          adminUser,
        );
      }
      onClose();
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "#0006", zIndex: 1000 }}
      />
      <div
        className="ra-modal"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 440,
          maxWidth: "95vw",
          background: t.sidebar,
          borderRadius: 16,
          zIndex: 1001,
          padding: 20,
          border: `1px solid ${t.border}`,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 14 }}>
          {editing ? "Edit Zone" : "Add Zone"}
        </div>
        <div className="ra-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div style={{ gridColumn: "1/-1" }}>
            <FG label="Zone Name *" error={errs.name}>
              <Inp
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="DHA / Clifton"
                maxLength={120}
                invalid={!!errs.name}
              />
            </FG>
          </div>
          <FG label="Coverage Level">
            <Sel
              value={form.coverage}
              onChange={(e) => set("coverage", e.target.value)}
            >
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </Sel>
          </FG>
          <FG label="Avg Response (min)" error={errs.avgResponseMins}>
            <Inp
              value={form.avgResponseMins}
              onChange={(e) => set("avgResponseMins", e.target.value.replace(/\D/g, ""))}
              type="number"
              inputMode="numeric"
              invalid={!!errs.avgResponseMins}
            />
          </FG>
          <FG label="Vendor Count" error={errs.vendorCount}>
            <Inp
              value={form.vendorCount}
              onChange={(e) => set("vendorCount", e.target.value.replace(/\D/g, ""))}
              type="number"
              inputMode="numeric"
              invalid={!!errs.vendorCount}
            />
          </FG>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={loading}>
            {loading ? "Saving…" : editing ? "Save Changes" : "Add Zone"}
          </Btn>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
//  Settings -> Admin Users (dynamic, role-gated)
//  Rules:
//   - Anyone can view.
//   - Only superadmin or manager can invite/edit/disable/delete.
//   - The superadmin row is read-only (not editable, not deletable).
//   - Cannot edit/disable/delete YOURSELF (lockout protection).
// ─────────────────────────────────────────────────────────────────
function AdminUsersTab() {
  const t = useTheme();
  const { adminUser, adminRole } = useAdmin();
  const [admins, setAdmins] = useState([]);
  const [showInvite, setShowInvite] = useState(false);
  const [editAdmin, setEditAdmin] = useState(null);
  useEffect(() => getAdminUsers(setAdmins), []);

  const canManage = adminRole === "superadmin" || adminRole === "manager";

  const isSuperadmin = (a) => a.role === "superadmin";
  const isSelf = (a) => a.id === adminUser?.uid;

  const handleToggleDisabled = async (a) => {
    const next = !a.disabled;
    if (!window.confirm(`${next ? "Disable" : "Enable"} ${a.name || a.email}?`))
      return;
    await updateAdminUser(a.id, { disabled: next });
    await logAudit(
      next ? "admin_disabled" : "admin_enabled",
      "admin",
      a.id,
      { entityName: a.name || a.email },
      adminUser,
    );
  };
  const handleDelete = async (a) => {
    if (
      !window.confirm(
        `Remove admin access for ${a.name || a.email}? Their Firebase Auth account stays but they can no longer access this panel.`,
      )
    )
      return;
    await removeAdminUser(a.id);
    await logAudit(
      "admin_removed",
      "admin",
      a.id,
      { entityName: a.name || a.email },
      adminUser,
    );
  };

  return (
    <>
      {showInvite && (
        <AdminUserModal onClose={() => setShowInvite(false)} />
      )}
      {editAdmin && (
        <AdminUserModal
          existing={editAdmin}
          onClose={() => setEditAdmin(null)}
        />
      )}
      <Card>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 14,
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <CT>Admin Users</CT>
          {canManage && (
            <Btn
              variant="primary"
              style={{ fontSize: 11 }}
              onClick={() => setShowInvite(true)}
            >
              + Invite Admin
            </Btn>
          )}
        </div>
        {!canManage && (
          <div
            style={{
              fontSize: 11,
              color: t.muted,
              marginBottom: 12,
              fontStyle: "italic",
            }}
          >
            Read-only — invite/edit requires superadmin or manager role.
          </div>
        )}
        {admins.length === 0 ? (
          <Empty icon="👥" text="No admins" />
        ) : (
          <Tbl
            headers={["Admin", "Email", "Role", "Status", "Actions"]}
            rows={admins.map((a) => {
              const locked = isSuperadmin(a);
              const self = isSelf(a);
              return (
                <tr key={a.id}>
                  <TD>
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 7 }}
                    >
                      <Av
                        initials={(a.name || a.email || "A")
                          .slice(0, 2)
                          .toUpperCase()}
                        size={24}
                      />
                      <span style={{ fontSize: 12 }}>
                        {a.name || a.email || "—"}
                        {self && (
                          <span
                            style={{
                              fontSize: 9,
                              color: t.orange,
                              marginLeft: 6,
                              fontWeight: 600,
                            }}
                          >
                            you
                          </span>
                        )}
                      </span>
                    </div>
                  </TD>
                  <TD style={{ fontSize: 11, color: t.muted }}>{a.email || "—"}</TD>
                  <TD>
                    <Badge status={a.role} />
                  </TD>
                  <TD>
                    <Badge
                      status={a.disabled ? "blocked" : "active"}
                      text={a.disabled ? "Disabled" : "Active"}
                    />
                  </TD>
                  <TD>
                    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {locked ? (
                        <span style={{ fontSize: 10, color: t.muted }}>
                          Main user — locked
                        </span>
                      ) : !canManage || self ? (
                        <span style={{ fontSize: 10, color: t.muted }}>—</span>
                      ) : (
                        <>
                          <Btn
                            style={{ padding: "3px 8px", fontSize: 10 }}
                            onClick={() => setEditAdmin(a)}
                          >
                            Edit
                          </Btn>
                          <Btn
                            variant={a.disabled ? "success" : "danger"}
                            style={{ padding: "3px 8px", fontSize: 10 }}
                            onClick={() => handleToggleDisabled(a)}
                          >
                            {a.disabled ? "Enable" : "Disable"}
                          </Btn>
                          <Btn
                            variant="danger"
                            style={{ padding: "3px 8px", fontSize: 10 }}
                            onClick={() => handleDelete(a)}
                          >
                            Remove
                          </Btn>
                        </>
                      )}
                    </div>
                  </TD>
                </tr>
              );
            })}
          />
        )}
      </Card>
    </>
  );
}

function AdminUserModal({ onClose, existing }) {
  const t = useTheme();
  const { adminUser } = useAdmin();
  const editing = Boolean(existing);
  const [form, setForm] = useState(() => ({
    name: existing?.name || "",
    email: existing?.email || "",
    password: "",
    role: existing?.role || "manager",
  }));
  const [errs, setErrs] = useState({});
  const [loading, setLoading] = useState(false);
  const [serverErr, setServerErr] = useState("");
  const set = (k, v) => {
    setForm((p) => ({ ...p, [k]: v }));
    setErrs((p) => ({ ...p, [k]: undefined }));
  };

  const validate = () => {
    const e = {};
    e.name = V.maxLength(120, "Too long")(form.name);
    if (!editing) {
      e.email = V.emailRequired(form.email);
      if (!form.password || form.password.length < 6)
        e.password = "Password must be at least 6 characters";
    }
    if (!["manager", "support", "viewer"].includes(form.role))
      e.role = "Invalid role";
    for (const k of Object.keys(e)) if (!e[k]) delete e[k];
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setServerErr("");
    setLoading(true);
    try {
      if (editing) {
        await updateAdminUser(existing.id, {
          name: form.name || null,
          role: form.role,
        });
        await logAudit(
          "admin_updated",
          "admin",
          existing.id,
          { entityName: form.name || existing.email, role: form.role },
          adminUser,
        );
      } else {
        const idToken = await getAuthToken(true);
        const res = await fetch("/api/admin-users/invite", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            email: form.email.trim(),
            password: form.password,
            name: form.name.trim() || null,
            role: form.role,
          }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const { uid } = await res.json();
        await logAudit(
          "admin_invited",
          "admin",
          uid,
          { entityName: form.name || form.email, role: form.role },
          adminUser,
        );
      }
      onClose();
    } catch (e) {
      setServerErr(e.message || "Save failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "#0006", zIndex: 1000 }}
      />
      <div
        className="ra-modal"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 480,
          maxWidth: "95vw",
          background: t.sidebar,
          borderRadius: 16,
          zIndex: 1001,
          padding: 20,
          border: `1px solid ${t.border}`,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: t.white, marginBottom: 14 }}>
          {editing ? "Edit Admin" : "Invite Admin"}
        </div>
        {serverErr && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              color: "#dc2626",
              marginBottom: 12,
            }}
          >
            {serverErr}
          </div>
        )}
        <div className="ra-form-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <FG label="Name" error={errs.name}>
            <Inp
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Ali Khan"
              maxLength={120}
              autoComplete="name"
              invalid={!!errs.name}
            />
          </FG>
          <FG label="Role" error={errs.role}>
            <Sel
              value={form.role}
              onChange={(e) => set("role", e.target.value)}
            >
              <option value="manager">Manager</option>
              <option value="support">Support</option>
              <option value="viewer">Viewer</option>
            </Sel>
          </FG>
          {!editing && (
            <>
              <FG label="Email *" error={errs.email}>
                <Inp
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="user@example.com"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  maxLength={120}
                  invalid={!!errs.email}
                />
              </FG>
              <FG label="Temporary Password *" error={errs.password}>
                <Inp
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder="At least 6 characters"
                  type="password"
                  autoComplete="new-password"
                  invalid={!!errs.password}
                />
              </FG>
            </>
          )}
        </div>
        {editing && (
          <div style={{ fontSize: 11, color: t.muted, marginTop: 8, fontStyle: "italic" }}>
            Email cannot be changed. To reset password, use Firebase Console.
          </div>
        )}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={loading}>
            {loading ? "Saving…" : editing ? "Save Changes" : "Send Invite"}
          </Btn>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────
//  NAV
// ─────────────────────────────────────────────────────────────────
const NAV = [
  {
    section: "Main",
    items: [
      { key: "dashboard", label: "Dashboard", icon: "▦", comp: Dashboard },
      { key: "users", label: "Users", icon: "◉", comp: Users },
      {
        key: "vendors",
        label: "Vendors",
        icon: "⊛",
        comp: Vendors,
        badgeKey: "pendingKyc",
        bc: "#ca8a04",
      },
      { key: "requests", label: "Requests", icon: "≡", comp: Requests },
    ],
  },
  {
    section: "Emergency",
    items: [
      {
        key: "sos",
        label: "SOS Alerts",
        icon: "!",
        comp: SOS_Page,
        badgeKey: "activeSos",
        bc: "#dc2626",
      },
    ],
  },
  {
    section: "Operations",
    items: [
      { key: "finance", label: "Finance", icon: "₨", comp: Finance },
      {
        key: "reviews",
        label: "Reviews",
        icon: "★",
        comp: Reviews_Page,
        badgeKey: "flaggedReviews",
        bc: "#e8630a",
      },
      {
        key: "notifications",
        label: "Notifications",
        icon: "🔔",
        comp: Notifications_Page,
      },
    ],
  },
  {
    section: "System",
    items: [
      { key: "audit", label: "Audit Log", icon: "◷", comp: AuditLog_Page },
      { key: "settings", label: "Settings", icon: "⚙", comp: Settings_Page },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────
//  LOGIN SCREEN
// ─────────────────────────────────────────────────────────────────
function Login({ onLogin }) {
  const t = useTheme();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async (e) => {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const { data: cred, error: loginErr } = await adminLogin(email, pass);
      if (loginErr) throw loginErr;
      // Verify admin via app_metadata (fast path) or profiles table fallback.
      const meta = cred.user?.user_metadata;
      const appMeta = cred.session?.user?.app_metadata || {};
      if (appMeta.admin !== true) {
        // Fallback: check profiles.role
        try {
          const { data: profile } = await supabase
            .from("profiles")
            .select("role")
            .eq("id", cred.user.id)
            .single();
          const adminRoles = ["admin", "superadmin", "manager", "support", "viewer"];
          if (!profile || !adminRoles.includes(profile.role)) {
            await adminLogout();
            setErr("Access denied. You are not an admin.");
            return;
          }
        } catch (verifyErr) {
          console.warn("Could not verify admin role. Proceeding; RLS will enforce.", verifyErr);
        }
      }
      onLogin(cred.user);
    } catch (e) {
      setErr(
        e.code === "auth/wrong-password" ||
          e.code === "auth/user-not-found" ||
          e.code === "auth/invalid-credential"
          ? "Invalid email or password."
          : e.message,
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: t.bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        style={{
          background: t.card,
          border: `1px solid ${t.border}`,
          borderRadius: 20,
          padding: 36,
          width: 380,
          maxWidth: "100%",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div
            style={{
              width: 44,
              height: 44,
              background: t.orange,
              borderRadius: 12,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 900,
              fontSize: 22,
              color: "#fff",
              margin: "0 auto 12px",
            }}
          >
            R
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: t.white }}>
            RoadAssist Pro
          </div>
          <div style={{ fontSize: 12, color: t.muted, marginTop: 3 }}>
            Admin Panel Login
          </div>
        </div>
        {err && (
          <div
            style={{
              background: "#fef2f2",
              border: "1px solid #fecaca",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 12,
              color: "#dc2626",
              marginBottom: 14,
            }}
          >
            {err}
          </div>
        )}
        <form onSubmit={handleLogin}>
          <FG label="Email">
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              placeholder="admin@roadassist.pk"
              required
              style={{
                background: t.input,
                border: `1px solid ${t.border}`,
                borderRadius: 7,
                padding: "9px 12px",
                color: t.text1,
                fontSize: 13,
                outline: "none",
                width: "100%",
              }}
            />
          </FG>
          <FG label="Password">
            <input
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              type="password"
              placeholder="••••••••"
              required
              style={{
                background: t.input,
                border: `1px solid ${t.border}`,
                borderRadius: 7,
                padding: "9px 12px",
                color: t.text1,
                fontSize: 13,
                outline: "none",
                width: "100%",
              }}
            />
          </FG>
          <button
            type="submit"
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px",
              background: t.orange,
              color: "#fff",
              border: "none",
              borderRadius: 9,
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "wait" : "pointer",
              marginTop: 4,
            }}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>
        </form>
        <div
          style={{
            textAlign: "center",
            marginTop: 16,
            fontSize: 11,
            color: t.muted,
          }}
        >
          Need an account? Contact your super admin.
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
//  ROOT APP
// ─────────────────────────────────────────────────────────────────
export default function AdminPanel() {
  const [isDark, setIsDark] = useState(
    () => localStorage.getItem("ra_dark") === "true",
  );
  const [primaryColor, setPrimaryColor] = useState(
    () => localStorage.getItem("ra_primary") || "#F97316",
  );
  const [page, setPage] = useState("dashboard");
  const [adminUser, setAdminUser] = useState(null);
  const [adminProfile, setAdminProfile] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [notifOpen, setNotifOpen] = useState(false);

  // Firebase data
  const [vendors, setVendors] = useState([]);
  const [users, setUsers] = useState([]);
  const [requests, setRequests] = useState([]);
  const [sos, setSos] = useState([]);
  const [reviews, setReviews] = useState([]);
  const [notifications, setNotifs] = useState([]);
  const [auditLogData, setAudit] = useState([]);

  // FCM foreground
  const [fcmToast, setFcmToast] = useState(null);

  const t = isDark ? DARK(primaryColor) : LIGHT(primaryColor);

  useEffect(() => { localStorage.setItem("ra_dark", isDark); }, [isDark]);
  useEffect(() => { localStorage.setItem("ra_primary", primaryColor); }, [primaryColor]);

  // Auth listener — verify admin role before exposing data listeners.
  useEffect(() => {
    let cancelled = false;
    // Safety timeout: if Supabase client is misconfigured and onAuthStateChange
    // never fires, fall through to login screen after 5s instead of spinning forever.
    const safetyTimer = setTimeout(() => {
      if (!cancelled) {
        console.warn("[auth] onAuthStateChange did not fire within 5s — showing login");
        setAuthLoading(false);
      }
    }, 5000);
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      clearTimeout(safetyTimer);
      const user = session?.user ?? null;
      if (!user) {
        if (!cancelled) {
          setAdminUser(null);
          setAuthLoading(false);
        }
        return;
      }
      try {
        const appMeta = user.app_metadata || {};
        const adminRoles = ["admin", "superadmin", "manager", "support", "viewer"];
        let role = appMeta.role || null;
        let disabled = appMeta.disabled === true;

        if (!role) {
          // Fallback: read from profiles table
          const { data: profile } = await supabase
            .from("profiles")
            .select("role, status")
            .eq("id", user.id)
            .single();
          role = profile?.role || null;
          disabled = profile?.status === "blocked";
        }

        if (cancelled) return;
        if (role && adminRoles.includes(role) && !disabled) {
          setAdminProfile({ role, name: user.user_metadata?.name || user.email || null });
          setAdminUser(user);
        } else {
          setAdminProfile(null);
          await adminLogout();
          setAdminUser(null);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("admin role check failed — signing out:", err);
        await adminLogout();
        setAdminUser(null);
      } finally {
        if (!cancelled) setAuthLoading(false);
      }
    });
    return () => {
      cancelled = true;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, []);

  // Supabase listeners — only when logged in
  useEffect(() => {
    if (!adminUser) return;
    const u1 = getVendors(setVendors);
    const u2 = getUsers(setUsers);
    const u3 = getRequests(setRequests);
    const u4 = getSOS(setSos);
    const u5 = getReviews(setReviews);
    const u6 = getNotifications(setNotifs);
    const u7 = getAuditLog(setAudit);
    return () => {
      u1();
      u2();
      u3();
      u4();
      u5();
      u6();
      u7();
    };
  }, [adminUser]);

  // FCM foreground messages
  useEffect(() => {
    const unsub = onFCMMessage((payload) => {
      setFcmToast(payload.notification);
      setTimeout(() => setFcmToast(null), 4000);
    });
  }, []);

  const allItems = NAV.flatMap((s) => s.items);
  const current = allItems.find((i) => i.key === page);
  const PageComp = current?.comp || Dashboard;

  // Badge counts
  const badges = {
    pendingKyc: vendors.filter((v) => !v.deletedAt && v.kyc === "pending").length,
    activeSos: sos.filter((s) => !s.resolved).length,
    flaggedReviews: reviews.filter((r) => r.status === "flagged").length,
    unreadNotifs: notifications.filter((n) => !n.isRead).length,
  };

  const adminCtx = {
    vendors,
    users,
    requests,
    sos,
    reviews,
    notifications,
    auditLogData,
    adminUser,
    adminProfile,
    adminRole: adminProfile?.role || null,
  };

  if (authLoading)
    return (
      <ThemeCtx.Provider value={t}>
        <div
          style={{
            minHeight: "100vh",
            background: t.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Spinner />
        </div>
      </ThemeCtx.Provider>
    );
  if (!adminUser)
    return (
      <ThemeCtx.Provider value={t}>
        <Login onLogin={setAdminUser} />
      </ThemeCtx.Provider>
    );

  return (
    <ThemeCtx.Provider value={t}>
      <AdminCtx.Provider value={adminCtx}>
        <div
          style={{
            display: "flex",
            height: "100vh",
            background: t.bg,
            overflow: "hidden",
            fontFamily: "'Segoe UI',system-ui,sans-serif",
            transition: "background .25s",
          }}
        >
          {/* FCM toast */}
          {fcmToast && (
            <div
              style={{
                position: "fixed",
                bottom: 20,
                right: 20,
                left: 20,
                background: t.orange,
                color: "#fff",
                borderRadius: 12,
                padding: "12px 18px",
                zIndex: 2000,
                fontSize: 13,
                fontWeight: 600,
                boxShadow: "0 4px 20px #0004",
                maxWidth: 300,
                marginLeft: "auto",
              }}
            >
              🔔 {fcmToast.title}: {fcmToast.body}
            </div>
          )}

          {/* Notification panel */}
          <NotificationPanel
            open={notifOpen}
            onClose={() => setNotifOpen(false)}
          />

          {/* Backdrop for mobile sidebar drawer */}
          <div
            className="ra-mobile-sidebar-backdrop"
            onClick={() => document.body.classList.remove("ra-sidebar-open")}
          />
          {/* Sidebar */}
          <div
            className="ra-sidebar"
            style={{
              width: 215,
              minWidth: 215,
              background: t.sidebar,
              borderRight: `1px solid ${t.border}`,
              display: "flex",
              flexDirection: "column",
              overflowY: "auto",
              transition: "background .25s",
            }}
          >
            <div
              style={{
                padding: "18px 14px 14px",
                borderBottom: `1px solid ${t.border}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}
            >
              <div
                style={{
                  width: 32,
                  height: 32,
                  background: t.orange,
                  borderRadius: 8,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 900,
                  fontSize: 16,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                R
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: t.white }}>
                  RoadAssist Pro
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: t.muted,
                    letterSpacing: 0.8,
                    textTransform: "uppercase",
                    marginTop: 1,
                  }}
                >
                  Admin Panel
                </div>
              </div>
            </div>

            {NAV.map((section) => (
              <div key={section.section} style={{ padding: "12px 8px 4px" }}>
                <div
                  style={{
                    fontSize: 9,
                    color: t.muted,
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    padding: "0 6px",
                    marginBottom: 6,
                    fontWeight: 600,
                  }}
                >
                  {section.section}
                </div>
                {section.items.map((item) => {
                  const active = page === item.key;
                  const badgeCount = item.badgeKey ? badges[item.badgeKey] : 0;
                  return (
                    <div
                      key={item.key}
                      onClick={() => setPage(item.key)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 9,
                        padding: "8px 9px",
                        borderRadius: 8,
                        cursor: "pointer",
                        color: active ? t.orange : t.text2,
                        background: active ? t.activeNavBg : "transparent",
                        fontSize: 12.5,
                        marginBottom: 2,
                        borderLeft: `3px solid ${active ? t.orange : "transparent"}`,
                        transition: "all .12s",
                      }}
                    >
                      <span
                        style={{ width: 16, textAlign: "center", fontSize: 13 }}
                      >
                        {item.icon}
                      </span>
                      <span style={{ flex: 1 }}>{item.label}</span>
                      {badgeCount > 0 && (
                        <span
                          style={{
                            padding: "1px 6px",
                            borderRadius: 10,
                            fontSize: 9,
                            fontWeight: 700,
                            background: item.bc ? t.orange : undefined,
                            color: "#fff",
                          }}
                        >
                          {badgeCount}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            <div
              style={{
                marginTop: "auto",
                padding: 10,
                borderTop: `1px solid ${t.border}`,
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  background: t.hover,
                  borderRadius: 8,
                  padding: "8px 10px",
                }}
              >
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    background: t.orange,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    fontWeight: 700,
                    color: "#fff",
                  }}
                >
                  {(adminUser.email || "A").slice(0, 2).toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: t.text1,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {adminUser.email}
                  </div>
                  <div style={{ fontSize: 9, color: t.muted }}>
                    admin · online
                  </div>
                </div>
                <button
                  onClick={() => adminLogout()}
                  title="Sign out"
                  style={{
                    background: "transparent",
                    border: "none",
                    color: t.muted,
                    cursor: "pointer",
                    fontSize: 14,
                  }}
                >
                  ↪
                </button>
              </div>
            </div>
          </div>

          {/* Main */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              minWidth: 0,
            }}
          >
            {/* Topbar */}
            <div
              className="ra-topbar"
              style={{
                minHeight: 50,
                background: t.sidebar,
                borderBottom: `1px solid ${t.border}`,
                display: "flex",
                alignItems: "center",
                padding: "8px 18px",
                gap: 10,
                flexShrink: 0,
                flexWrap: "wrap",
                transition: "background .25s",
              }}
            >
              {/* Hamburger — only visible on mobile via CSS */}
              <button
                className="ra-hamburger"
                aria-label="Open menu"
                onClick={() =>
                  document.body.classList.toggle("ra-sidebar-open")
                }
                style={{
                  background: t.hover,
                  border: `1px solid ${t.border}`,
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: 15,
                  color: t.text2,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ☰
              </button>
              <div
                style={{
                  flex: 1,
                  fontSize: 15,
                  fontWeight: 700,
                  color: t.white,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {current?.label}
              </div>
              <span
                className="ra-topbar-extra"
                style={{
                  background: `${t.orange}1a`,
                  border: `1px solid ${t.orange}33`,
                  color: t.orange,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "3px 9px",
                  borderRadius: 20,
                }}
              >
                ● Live
              </span>

              {/* Notification bell */}
              <button
                onClick={() => setNotifOpen(true)}
                style={{
                  position: "relative",
                  background: t.hover,
                  border: `1px solid ${t.border}`,
                  borderRadius: 8,
                  padding: "6px 10px",
                  cursor: "pointer",
                  fontSize: 15,
                  color: t.text2,
                  transition: "all .15s",
                }}
              >
                🔔
                {badges.unreadNotifs > 0 && (
                  <span
                    style={{
                      position: "absolute",
                      top: -4,
                      right: -4,
                      width: 16,
                      height: 16,
                      borderRadius: "50%",
                      background: "#ef4444",
                      color: "#fff",
                      fontSize: 9,
                      fontWeight: 700,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {badges.unreadNotifs}
                  </span>
                )}
              </button>

              {/* Primary color picker */}
              <label
                className="ra-topbar-extra"
                title="Pick primary color"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: t.hover,
                  border: `1px solid ${t.border}`,
                  borderRadius: 20,
                  padding: "5px 13px",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  color: t.text1,
                }}
              >
                <span
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: "50%",
                    background: primaryColor,
                    border: `2px solid ${t.border}`,
                    display: "inline-block",
                  }}
                />
                Color
                <input
                  type="color"
                  value={primaryColor}
                  onChange={(e) => setPrimaryColor(e.target.value)}
                  style={{ width: 0, height: 0, opacity: 0, position: "absolute" }}
                />
              </label>

              {/* Light/Dark toggle */}
              <button
                className="ra-topbar-extra"
                onClick={() => setIsDark((d) => !d)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: t.hover,
                  border: `1px solid ${t.border}`,
                  borderRadius: 20,
                  padding: "5px 13px",
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                  color: t.text1,
                  transition: "all .2s",
                }}
              >
                {isDark ? "☀ Light" : "☽ Dark"}
              </button>

              <button
                className="ra-topbar-extra"
                style={{
                  background: t.hover,
                  border: `1px solid ${t.border}`,
                  color: t.text2,
                  padding: "5px 11px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 11,
                }}
              >
                Export
              </button>
              <button
                style={{
                  background: "#dc26261a",
                  border: "1px solid #dc262633",
                  color: "#ef4444",
                  padding: "5px 12px",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                ⚠ SOS · {badges.activeSos} Active
              </button>
            </div>

            {/* Page */}
            <div className="ra-content" style={{ flex: 1, overflowY: "auto", padding: 18 }}>
              <div style={{ marginBottom: 16 }}>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: t.white,
                    letterSpacing: -0.4,
                  }}
                >
                  {current?.label}
                </div>
              </div>
              <PageComp />
            </div>
          </div>
        </div>
        <style>{`*{box-sizing:border-box;margin:0;padding:0}::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-thumb{background:${t.scrollThumb};border-radius:3px}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </AdminCtx.Provider>
    </ThemeCtx.Provider>
  );
}

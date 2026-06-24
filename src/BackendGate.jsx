// BackendGate — verifies the Supabase backend is reachable BEFORE mounting the
// app. This prevents the "refresh_token storm": when the (free-tier) Supabase
// project is paused/asleep, supabase-js auto-refresh otherwise hammers the dead
// host with endless failing token requests. Instead we show a clear, friendly
// "waking up" screen with auto-retry + a manual retry button, and only mount the
// real app (and its auth flow) once the backend actually answers.

import { useState, useEffect, useCallback, useRef } from "react";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Any HTTP response below 500 means the gateway AND origin answered → alive.
// A 5xx (502/503/521 = Cloudflare "origin down") or a thrown fetch = backend down.
async function pingBackend(signal) {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
    method: "GET",
    headers: { apikey: SUPABASE_KEY },
    signal,
  });
  return res.status < 500;
}

export default function BackendGate({ children }) {
  // "checking" | "up" | "down"
  const [state, setState] = useState("checking");
  const [attempt, setAttempt] = useState(0);
  const timerRef = useRef(null);

  const check = useCallback(async () => {
    setState((s) => (s === "up" ? "up" : "checking"));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    try {
      const alive = await pingBackend(controller.signal);
      setState(alive ? "up" : "down");
    } catch {
      setState("down"); // network error / timeout / DNS failure
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  // Initial check + whenever the user (or auto-retry) bumps `attempt`.
  useEffect(() => {
    check();
  }, [check, attempt]);

  // While down, auto-retry with a gentle backoff (5s → 10s → 20s, capped 30s).
  useEffect(() => {
    if (state !== "down") return;
    const delay = Math.min(5000 * 2 ** Math.min(attempt, 2), 30000);
    timerRef.current = setTimeout(() => setAttempt((a) => a + 1), delay);
    return () => clearTimeout(timerRef.current);
  }, [state, attempt]);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    // Misconfigured build — let the app render so the real config error surfaces.
    return children;
  }

  if (state === "up") return children;

  const down = state === "down";
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 420,
          background: "#fff",
          borderRadius: 16,
          padding: "40px 32px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
          textAlign: "center",
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 14,
            background: "#f97316",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 28,
            fontWeight: 700,
            margin: "0 auto 20px",
          }}
        >
          R
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: "#0f172a", margin: 0 }}>
          {down ? "Server is waking up" : "Connecting…"}
        </h1>
        <p style={{ fontSize: 14, color: "#64748b", margin: "10px 0 24px", lineHeight: 1.5 }}>
          {down
            ? "The backend isn’t responding right now. This usually means it’s starting back up. It should be ready in a moment."
            : "Checking the connection to the server…"}
        </p>
        <button
          onClick={() => setAttempt((a) => a + 1)}
          disabled={state === "checking"}
          style={{
            width: "100%",
            padding: "12px 16px",
            borderRadius: 10,
            border: "none",
            background: state === "checking" ? "#fdba74" : "#f97316",
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: state === "checking" ? "default" : "pointer",
          }}
        >
          {state === "checking" ? "Checking…" : "Retry now"}
        </button>
        {down && (
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "16px 0 0" }}>
            Retrying automatically…
          </p>
        )}
      </div>
    </div>
  );
}

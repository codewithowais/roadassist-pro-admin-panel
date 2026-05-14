import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { supabase, adminLogout } from "../lib/supabase";

const ROLE_CACHE_KEY = "ra_admin_role";
const ADMIN_ROLES = ["admin", "superadmin", "manager", "support", "viewer"];

async function resolveRole(user) {
  const appMeta = user.app_metadata || {};
  const jwtRole = appMeta.role || null;

  // Fast path: role already in the JWT, no DB call needed.
  if (jwtRole && ADMIN_ROLES.includes(jwtRole) && appMeta.disabled !== true) {
    localStorage.setItem(ROLE_CACHE_KEY, jwtRole);
    return { role: jwtRole, disabled: false };
  }

  const cachedRole = localStorage.getItem(ROLE_CACHE_KEY);

  try {
    const { data: profile } = await Promise.race([
      supabase.from("profiles").select("role, status").eq("id", user.id).single(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("profile_timeout")), 5000)
      ),
    ]);
    const role = profile?.role ?? null;
    const disabled = profile?.status === "blocked";
    if (role) localStorage.setItem(ROLE_CACHE_KEY, role);
    else localStorage.removeItem(ROLE_CACHE_KEY);
    return { role, disabled };
  } catch {
    // Network failure or timeout — use cached role. Never sign out on a bad
    // connection; the session itself is still valid.
    return { role: cachedRole ?? null, disabled: false };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
export const AuthContext = createContext(null);
export const useAuthContext = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  // `undefined` = still loading; `null` = confirmed logged-out; User = logged-in
  const [user, setUser] = useState(undefined);
  const [profile, setProfile] = useState(null);

  const applyUser = useCallback(async (supaUser) => {
    if (!supaUser) {
      localStorage.removeItem(ROLE_CACHE_KEY);
      setUser(null);
      setProfile(null);
      return;
    }

    const { role, disabled } = await resolveRole(supaUser);

    if (role && ADMIN_ROLES.includes(role) && !disabled) {
      setProfile({ role, name: supaUser.user_metadata?.name || supaUser.email });
      setUser(supaUser);
    } else {
      localStorage.removeItem(ROLE_CACHE_KEY);
      await adminLogout();
      setUser(null);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    let mounted = true;

    // Absolute fallback — if nothing resolves within 10s, stop spinning.
    const safety = setTimeout(() => {
      if (mounted && user === undefined) setUser(null);
    }, 10000);

    // PRIMARY FIX: getSession() reads the stored session from localStorage
    // immediately without waiting for a network token-refresh call. This is
    // why onAuthStateChange(INITIAL_SESSION) alone caused the infinite spinner —
    // it waits for the refresh round-trip before firing.
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return;
        clearTimeout(safety);
        applyUser(session?.user ?? null);
      })
      .catch(() => {
        if (mounted) {
          clearTimeout(safety);
          setUser(null);
        }
      });

    // SECONDARY: respond to future auth state changes.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === "SIGNED_IN") {
        applyUser(session?.user ?? null);
      } else if (event === "SIGNED_OUT") {
        localStorage.removeItem(ROLE_CACHE_KEY);
        setUser(null);
        setProfile(null);
      } else if (event === "TOKEN_REFRESHED") {
        // Token was silently refreshed — re-verify the role in case it changed.
        applyUser(session?.user ?? null);
      }
    });

    return () => {
      mounted = false;
      clearTimeout(safety);
      subscription.unsubscribe();
    };
  }, [applyUser]);

  const logout = useCallback(async () => {
    localStorage.removeItem(ROLE_CACHE_KEY);
    localStorage.removeItem("ra_session_id");
    await adminLogout();
    setUser(null);
    setProfile(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, profile, loading: user === undefined, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuthContext } from "./auth/useAuth.jsx";
import AdminPanel, { Login } from "../adminpanel.jsx";
import VendorRegister from "../vendorregister.jsx";

function FullPageSpinner() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f8fafc",
      }}
    >
      <div
        style={{
          width: 36,
          height: 36,
          border: "3px solid #e5e7eb",
          borderTopColor: "#F97316",
          borderRadius: "50%",
          animation: "spin 0.7s linear infinite",
        }}
      />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

// Redirects unauthenticated users to /login.
function AuthGuard({ children }) {
  const { user, loading } = useAuthContext();
  if (loading) return <FullPageSpinner />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Redirects authenticated users away from /login to /dashboard.
function GuestGuard({ children }) {
  const { user, loading } = useAuthContext();
  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function AppRouter() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          {/* Public — vendor self-registration */}
          <Route path="/register" element={<VendorRegister />} />

          {/* Login page — redirects to /dashboard if already authenticated */}
          <Route
            path="/login"
            element={
              <GuestGuard>
                <Login />
              </GuestGuard>
            }
          />

          {/* Protected admin pages — redirects to /login if not authenticated */}
          <Route
            path="/:page"
            element={
              <AuthGuard>
                <AdminPanel />
              </AuthGuard>
            }
          />

          {/* Root — redirect to dashboard */}
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

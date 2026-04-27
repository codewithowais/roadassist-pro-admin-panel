import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import AdminPanel from "../adminpanel.jsx";
import VendorRegister from "../vendorregister.jsx";
import "./index.css";

function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return path === "/register" ? <VendorRegister /> : <AdminPanel />;
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

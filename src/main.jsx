import React from "react";
import { createRoot } from "react-dom/client";
import AppRouter from "./AppRouter.jsx";
import BackendGate from "./BackendGate.jsx";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BackendGate>
      <AppRouter />
    </BackendGate>
  </React.StrictMode>
);

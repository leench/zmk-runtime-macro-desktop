import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import App from "./App";
import "./index.css";

const DESIGN_PAGE_ZOOM = 1.1;

if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
  void getCurrentWebview().setZoom(DESIGN_PAGE_ZOOM).catch(() => undefined);
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

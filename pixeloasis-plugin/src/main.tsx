import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";

const root = document.getElementById("root");

if (!root) {
  throw new Error("PixelOasis root element not found.");
}

try {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
} catch (error) {
  root.textContent = error instanceof Error ? error.message : String(error);
}

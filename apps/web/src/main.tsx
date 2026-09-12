import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@copperkeep/ui/tokens.css";
import "@copperkeep/ui/components.css";
import "./app.css";
import { App } from "./App";
import { loadConfig } from "./config";

// Config first: every backend URL comes from /config.json, so nothing can render until
// it has landed.
loadConfig().then(
  () => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  },
  (error) => {
    document.getElementById("root")!.textContent =
      `Copperkeep could not load its configuration: ${String(error)}`;
  },
);

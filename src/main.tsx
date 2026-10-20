// Must stay the first import: installs the E2E bridge shim (Chromium only,
// when VITE_E2E_BRIDGE=1) before any module captures `isMock()`.
import "./e2eBridge";
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";
import { isMock } from "./env";
import { setupMockIpc } from "./mockIpc";

if (isMock()) {
  setupMockIpc();
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

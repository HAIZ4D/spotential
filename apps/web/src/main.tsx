import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.js";
import "./styles.css";
import { initFirebase } from "./lib/firebase.js";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // The server is a confirmation channel, not the source of truth, so
      // there is nothing to gain from refetching when a window regains focus.
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

// App Check and anonymous sign-in. Non-fatal if it fails: the simulator
// computes in-browser and only the paid analysis panels depend on it.
initFirebase();

const root = document.getElementById("root");
if (!root) throw new Error("#root missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

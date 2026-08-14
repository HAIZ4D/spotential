import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Simulator from "./routes/Simulator.js";

/**
 * The analysis route is lazy-loaded, and that is a COST decision as much as a
 * bundle-size one: it keeps the Google Maps script and the maps bundle out of
 * the page for anyone who only opens the simulator. Maps Platform bills per
 * map load, so a stray import on the wrong route is real money.
 */
const Analysis = lazy(() => import("./routes/Analysis.js"));
const Compare = lazy(() => import("./routes/Compare.js"));
const Heatmap = lazy(() => import("./routes/Heatmap.js"));

/**
 * Redirect to the simulator KEEPING the query string.
 *
 * Every share link already in the wild is of the form `/?s=<scenario>`. A
 * plain <Navigate to="/simulator"> drops the search params and silently resets
 * those links to the default scenario — a data-loss bug disguised as a routing
 * tidy-up.
 */
function RedirectToSimulator() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/simulator", search }} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RedirectToSimulator />} />
      <Route path="/simulator" element={<Simulator />} />
      <Route
        path="/analysis"
        element={
          <Suspense fallback={<div style={{ padding: 24 }}>Loading location analysis…</div>}>
            <Analysis />
          </Suspense>
        }
      />
      <Route
        path="/compare"
        element={
          <Suspense fallback={<div style={{ padding: 24 }}>Loading comparison…</div>}>
            <Compare />
          </Suspense>
        }
      />
      <Route
        path="/heatmap"
        element={
          <Suspense fallback={<div style={{ padding: 24 }}>Loading city demand…</div>}>
            <Heatmap />
          </Suspense>
        }
      />
      <Route path="*" element={<RedirectToSimulator />} />
    </Routes>
  );
}

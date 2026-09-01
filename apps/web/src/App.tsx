import { Suspense, lazy } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import Simulator from "./routes/Simulator.js";
import { Footer } from "./components/Footer.js";

/**
 * The analysis route is lazy-loaded, and that is a COST decision as much as a
 * bundle-size one: it keeps the Google Maps script and the maps bundle out of
 * the page for anyone who only opens the simulator. Maps Platform bills per
 * map load, so a stray import on the wrong route is real money.
 */
const Analysis = lazy(() => import("./routes/Analysis.js"));
const Compare = lazy(() => import("./routes/Compare.js"));
/** Events never loads the Maps bundle, so it stays out of the main chunk too. */
const Events = lazy(() => import("./routes/Events.js"));
const EventDetail = lazy(() => import("./routes/EventDetail.js"));

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

/** Old City Demand links land on the page that absorbed it. */
function RedirectToAnalysis() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: "/analysis", search }} replace />;
}

export default function App() {
  return (
    <>
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
        {/**
          * City Demand folded into the Location page.
          *
          * A REDIRECT rather than a 404: the URL is this product's persistence
          * layer — every view is a shareable link — so a `/heatmap` link
          * someone already sent has to land somewhere useful rather than on
          * the simulator via the catch-all. The query string rides along for
          * the same reason it does on the `/` redirect.
          */}
        <Route path="/heatmap" element={<RedirectToAnalysis />} />
        <Route
          path="/events"
          element={
            <Suspense fallback={<div style={{ padding: 24 }}>Loading events…</div>}>
              <Events />
            </Suspense>
          }
        />
        <Route
          path="/events/:slug"
          element={
            <Suspense fallback={<div style={{ padding: 24 }}>Loading event…</div>}>
              <EventDetail />
            </Suspense>
          }
        />
          <Route path="*" element={<RedirectToSimulator />} />
      </Routes>

      {/* One footer for every route. It carries the CC BY 4.0 and ODbL
          attributions, which have to appear wherever that data is shown —
          not only on the page that introduced it. */}
      <Footer />
    </>
  );
}

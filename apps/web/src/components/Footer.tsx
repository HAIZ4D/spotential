import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import mark from "../../img/spotential-mark.png";

/**
 * The site footer.
 *
 * It exists for one obligation as much as for polish: Kontur Population is
 * CC BY 4.0 and OpenStreetMap is ODbL, and both require attribution wherever
 * the data is shown. Those credits used to live only at the bottom of the
 * heatmap page, which meant a catchment figure quoted on /analysis or an
 * events card carried the data without the notice. Putting them in a footer
 * every route renders makes the attribution follow the data instead of the
 * page it happened to be introduced on.
 *
 * The disclaimer sits here too, for the same reason: the Success Score is a
 * comparison aid rather than a forecast, and a reader who lands deep in the
 * app should not have to find the one panel that says so.
 */

const SECTIONS: { title: string; links: { to: string; label: string }[] }[] = [
  {
    title: "Decide",
    links: [
      { to: "/analysis", label: "Score a location" },
      { to: "/compare", label: "Compare sites" },
      { to: "/heatmap", label: "City demand" },
    ],
  },
  {
    title: "Plan",
    links: [
      { to: "/simulator", label: "What-if simulator" },
      { to: "/events", label: "Find events" },
    ],
  },
];

export function Footer() {
  const rootRef = useRef<HTMLElement>(null);

  /**
   * Resolves once, as the footer comes into view.
   *
   * An IntersectionObserver rather than GSAP's ScrollTrigger: the plugin is
   * around 40KB for what is a single entrance on one element, and this page
   * already pays for the GSAP core on every route. `once` semantics come free
   * by disconnecting after the first hit.
   */
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {}, root);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        observer.disconnect();
        // Created inside the context so `ctx.revert()` can put the columns
        // back; `ctx.add(fn)` registers rather than returning a callable.
        ctx.add(() => {
          gsap.from(root.querySelectorAll(".ft-col"), {
            y: 14,
            opacity: 0,
            duration: 0.5,
            stagger: 0.07,
            ease: "power2.out",
          });
        });
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(root);

    return () => {
      observer.disconnect();
      // revert, not kill: a killed `from` freezes wherever it reached and
      // would leave the columns stranded at opacity 0 on a remount.
      ctx.revert();
    };
  }, []);

  return (
    <footer className="footer" ref={rootRef}>
      <span className="ft-glow no-print" aria-hidden="true" />

      <div className="ft-inner">
        <div className="ft-col ft-brand">
          <Link to="/" className="ft-logo">
            <span className="ft-mark">
              <img src={mark} alt="" width={30} height={30} />
            </span>
            <span className="ft-word" aria-hidden="true">
              Spot<b>ential</b>
            </span>
            <span className="sr-only">Spotential home</span>
          </Link>
          <p className="ft-tagline">Know the spot. Know the potential.</p>
          <p className="ft-blurb">
            Location intelligence for Malaysian MSMEs — score a site, compare two, and see what a
            booth or a shopfront would really cost before you sign anything.
          </p>
        </div>

        {SECTIONS.map((section) => (
          <nav className="ft-col no-print" key={section.title} aria-label={section.title}>
            <h2>{section.title}</h2>
            <ul>
              {section.links.map((link) => (
                <li key={link.to}>
                  <Link to={link.to}>
                    <span>{link.label}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div className="ft-col ft-data">
          <h2>Where the data comes from</h2>
          {/* CC BY 4.0 and ODbL both oblige attribution wherever the data is
              shown, so these are not optional and do not move. */}
          <ul className="ft-sources">
            <li>
              Population grid —{" "}
              <a href="https://data.humdata.org/dataset/kontur-population-malaysia" target="_blank" rel="noreferrer">
                Kontur Population
              </a>{" "}
              (CC BY 4.0)
            </li>
            <li>
              Places of interest —{" "}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                © OpenStreetMap contributors
              </a>{" "}
              (ODbL)
            </li>
            <li>Demographics — Department of Statistics Malaysia</li>
            <li>Competitors and maps — Google Maps Platform</li>
          </ul>
        </div>
      </div>

      <div className="ft-base">
        <p>
          <strong>Every score here is a comparison aid, not a forecast.</strong> Nothing in it has
          been validated against real business outcomes, and each figure says whether it was
          measured or inferred.
        </p>
        <span className="ft-copy">© {new Date().getFullYear()} Spotential</span>
      </div>
    </footer>
  );
}

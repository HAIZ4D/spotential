import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import mark from "../../img/spotential-mark.png";
import { currentAccount, onAccountChange, signInWithGoogle, signOutAccount } from "../lib/firebase.js";

gsap.registerPlugin(useGSAP);

/**
 * The floating capsule navigation.
 *
 * WHY STICKY AND NOT FIXED. A fixed bar leaves a hole in the document and every
 * page underneath would need its own top padding to compensate — which would
 * mean editing five routes to change one component. Sticky keeps the header in
 * normal flow, so it still occupies its own height and every existing layout
 * lands exactly where it did before, while still detaching visually and riding
 * along on scroll.
 *
 * THE SLIDING PILL is one absolutely-positioned element behind the links, not a
 * background on each link. Animating a shared element is what makes the active
 * state read as movement between destinations rather than as two independent
 * fades, and it is measured from the live DOM (`offsetLeft`/`offsetWidth`) so it
 * stays correct at any font size, zoom level or translated label length.
 *
 * MOTION IS DELIBERATELY SMALL. Hover displacement is 1px and the entrance runs
 * once in under half a second: this is a tool people use every day, and a navbar
 * that performs on every visit gets tiring long before it gets impressive.
 * Everything animates transform and opacity only, so it stays on the compositor.
 */

interface NavItem {
  to: string;
  label: string;
  /** Sub-routes that should still light this item, e.g. /events/:slug. */
  match?: (pathname: string) => boolean;
}

const NAV: NavItem[] = [
  { to: "/events", label: "Events", match: (p) => p.startsWith("/events") },
  { to: "/simulator", label: "Simulator" },
  { to: "/analysis", label: "Location" },
  { to: "/compare", label: "Compare" },
];

const isActive = (item: NavItem, pathname: string): boolean =>
  item.match ? item.match(pathname) : pathname === item.to;

export function Masthead({ subtitle, children }: { subtitle: string; children?: ReactNode }) {
  const { pathname } = useLocation();

  const shellRef = useRef<HTMLElement>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState(currentAccount());
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => onAccountChange(setAccount), []);

  /** Close the drawer on navigation, or the menu lingers over the new page. */
  useEffect(() => setOpen(false), [pathname]);

  /**
   * Move the pill to whichever link is current.
   *
   * Measured rather than computed: the labels are different widths and will be
   * different again if the copy ever changes, so reading the DOM is the only
   * thing that stays correct. The first placement is instant — a pill flying in
   * from x=0 on a cold load would look like a glitch rather than a transition.
   */
  const placePill = useCallback((animate: boolean) => {
    const links = linksRef.current;
    const pill = pillRef.current;
    if (!links || !pill) return;

    const active = links.querySelector<HTMLElement>("[data-active='true']");
    if (!active) {
      gsap.to(pill, { opacity: 0, duration: 0.15 });
      return;
    }

    const to = { x: active.offsetLeft, width: active.offsetWidth, opacity: 1 };

    if (!animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.set(pill, to);
      return;
    }

    // Slightly springy, but short. The pill should arrive before the eye has
    // finished travelling to the new label.
    gsap.to(pill, { ...to, duration: 0.42, ease: "back.out(1.4)" });
  }, []);

  useGSAP(
    () => {
      placePill(false);

      // Entrance: the capsule settles, then the links resolve behind it.
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) return;

      gsap
        .timeline()
        .from(".navbar", { y: -14, opacity: 0, duration: 0.45, ease: "power2.out" })
        .from(
          ".nav-link, .nav-actions > *",
          { y: 6, opacity: 0, duration: 0.3, stagger: 0.03, ease: "power1.out" },
          "-=0.25",
        )
        .from(".nav-logo", { scale: 0.92, opacity: 0, duration: 0.35, ease: "back.out(2)" }, 0.05);
    },
    { scope: shellRef },
  );

  /** Re-place on route change and whenever the row can have resized. */
  useEffect(() => {
    placePill(true);
  }, [pathname, placePill]);

  useEffect(() => {
    const links = linksRef.current;
    if (!links || typeof ResizeObserver === "undefined") return;
    // Fonts loading late and the window resizing both change the geometry the
    // pill was measured against, so it is re-measured rather than assumed.
    const observer = new ResizeObserver(() => placePill(false));
    observer.observe(links);
    return () => observer.disconnect();
  }, [placePill]);

  /**
   * The mobile dropdown, animated open and closed rather than snapped.
   *
   * Guarded on the breakpoint: above it the same element is `display: contents`
   * and has no box of its own, so animating its height would silently do
   * nothing on desktop while still fighting the layout.
   */
  useGSAP(
    () => {
      const drawer = drawerRef.current;
      if (!drawer) return;
      if (!window.matchMedia("(max-width: 900px)").matches) {
        gsap.set(drawer, { clearProps: "all" });
        return;
      }

      /**
       * Kill whatever is still running on this element before starting.
       *
       * The close tween finishes by setting `visibility: hidden`. Reopening
       * before it completes — which is exactly what happens when you navigate
       * with the menu open and immediately open it again — left that stale
       * onComplete queued, so it fired a moment later and hid the menu that had
       * just been opened. Intermittent, and it looked like the button had
       * simply not registered the tap.
       */
      gsap.killTweensOf(drawer);

      /**
       * The children need the same treatment, and they need their props back.
       *
       * They enter on a staggered `from`, and a `from` that is killed part-way
       * leaves every target stranded at whatever opacity it had reached — it
       * does not put back what it changed. Opening the menu while the page was
       * still settling could do exactly that, and the panel then sat at 0.69
       * to 1.00 down the list permanently, with no further tween to finish it.
       * Killing and clearing first means an interrupted open can never leave a
       * half-faded menu on screen.
       */
      const items = drawer.querySelectorAll(".nav-link, .nav-actions > *");
      gsap.killTweensOf(items);
      gsap.set(items, { clearProps: "opacity,transform" });

      /**
       * `visibility` is driven by the timeline rather than by a CSS class.
       *
       * A collapsed-but-visible drawer still holds its links in the tab order,
       * so a keyboard user would tab into a menu they cannot see. Flipping it
       * with React state instead would hide the panel before the close
       * animation had a chance to play, so the timeline owns both: visible for
       * the whole of the open animation, hidden only once the close finishes.
       */
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.set(drawer, {
          height: open ? "auto" : 0,
          opacity: open ? 1 : 0,
          visibility: open ? "visible" : "hidden",
        });
        return;
      }

      if (open) {
        /**
         * Measured in pixels, never animated to the string "auto".
         *
         * GSAP cannot interpolate towards `auto`, so `from({height: 0})` against
         * an auto height collapsed the panel to just its padding — 18px — and
         * the menu appeared to open behind the page. Setting auto, reading the
         * real height, then animating between two numbers is the reliable form;
         * auto is restored afterwards so the panel still reflows if its content
         * changes (signing in swaps two buttons for one).
         */
        gsap.set(drawer, { visibility: "visible", height: "auto", opacity: 1 });
        const full = drawer.offsetHeight;

        gsap
          .timeline()
          .fromTo(
            drawer,
            { height: 0 },
            {
              height: full,
              duration: 0.32,
              ease: "power2.out",
              onComplete: () => gsap.set(drawer, { height: "auto" }),
            },
          )
          .from(
            items,
            {
              y: 8,
              opacity: 0,
              duration: 0.25,
              stagger: 0.035,
              ease: "power1.out",
              // Leave nothing inline behind, so the resting state is the
              // stylesheet's rather than the tail of an animation.
              onComplete: () => gsap.set(items, { clearProps: "opacity,transform" }),
            },
            "-=0.18",
          );
      } else {
        gsap.to(drawer, {
          height: 0,
          opacity: 0,
          duration: 0.22,
          ease: "power2.in",
          onComplete: () => gsap.set(drawer, { visibility: "hidden" }),
        });
      }
    },
    { dependencies: [open], scope: shellRef },
  );

  /** Escape closes the drawer — a menu you cannot dismiss from the keyboard is a trap. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const hover = (on: boolean) => (e: React.MouseEvent<HTMLElement>) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Under 2px, so it reads as feedback rather than as motion.
    gsap.to(e.currentTarget, { y: on ? -1 : 0, duration: 0.15, ease: "power1.out" });
  };

  const signIn = async () => {
    setAuthError(null);
    try {
      await signInWithGoogle();
    } catch (error) {
      const code = (error as { code?: string }).code ?? "";
      setAuthError(
        code.includes("popup-closed") || code.includes("cancelled")
          ? "Sign-in was cancelled."
          : code.includes("operation-not-allowed")
            ? "Sign-in is not switched on for this project yet."
            : "Could not sign in. Try again in a moment.",
      );
    }
  };

  return (
    <header className="navbar-shell no-print" ref={shellRef}>
      <nav className="navbar" aria-label="Main">
        <Link to="/" className="nav-logo" onMouseEnter={hover(true)} onMouseLeave={hover(false)}>
          <span className="nav-mark">
            <img src={mark} alt="" width={30} height={30} />
          </span>
          <span className="nav-wordmark" aria-hidden="true">
            Spot<b>ential</b>
          </span>
          {/* The accessible name for the home link, and the page context the
              visible capsule has no room for. */}
          <span className="sr-only">Spotential home, {subtitle}</span>
        </Link>

        {/* One collapse container holding the links AND the auth actions.
            On desktop it is `display: contents`, so both children become direct
            grid cells and the links stay optically centred; on mobile it turns
            into the dropdown panel. Rendering a second copy of the links for
            mobile would duplicate every nav item in the accessibility tree and
            give the page two elements with each name. */}
        <div className="nav-collapse" id="nav-collapse" ref={drawerRef} data-open={open}>
          <div className="nav-links" ref={linksRef}>
          <span className="nav-pill" ref={pillRef} aria-hidden="true" />
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className="nav-link"
              data-active={isActive(item, pathname)}
              aria-current={isActive(item, pathname) ? "page" : undefined}
              onMouseEnter={hover(true)}
              onMouseLeave={hover(false)}
            >
              {item.label}
            </NavLink>
          ))}
          </div>

          <div className="nav-actions">
          {account ? (
            <>
              <span className="nav-account" title={account.email ?? "Signed in"}>
                {(account.email ?? "?").charAt(0).toUpperCase()}
              </span>
              <button className="nav-login" onClick={() => void signOutAccount()}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <button
                className="nav-login"
                onClick={() => void signIn()}
                onMouseEnter={hover(true)}
                onMouseLeave={hover(false)}
              >
                Log in
              </button>
              <button
                className="nav-signup"
                onClick={() => void signIn()}
                onMouseEnter={hover(true)}
                onMouseLeave={hover(false)}
              >
                Sign up
              </button>
            </>
          )}
          </div>
        </div>

        <button
          className="nav-burger"
          aria-expanded={open}
          aria-controls="nav-collapse"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`burger-box${open ? " is-open" : ""}`}>
            <i />
            <i />
            <i />
          </span>
        </button>
      </nav>

      {authError && (
        <p className="nav-auth-error" role="status">
          {authError}
        </p>
      )}

      {/* Page-level actions the routes pass in — the parity badge, share bar,
          print and report buttons. They keep their own row so the capsule stays
          the shape it is meant to be, and pages without actions render nothing
          extra at all. */}
      {children && <div className="page-actions no-print">{children}</div>}
    </header>
  );
}

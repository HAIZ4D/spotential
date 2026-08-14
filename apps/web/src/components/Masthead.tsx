import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

/**
 * Shared app header.
 *
 * Page-specific actions come in as children — the simulator brings its parity
 * badge, share bar and print button; analysis brings its own — so the shell
 * stays ignorant of what each route needs.
 */
export function Masthead({ subtitle, children }: { subtitle: string; children?: ReactNode }) {
  return (
    <header className="masthead no-print">
      <h1>Spotential</h1>
      <span className="sub">{subtitle}</span>

      <nav className="mast-nav" aria-label="Sections">
        <NavLink to="/simulator" className={({ isActive }) => (isActive ? "active" : "")}>
          Simulator
        </NavLink>
        <NavLink to="/analysis" className={({ isActive }) => (isActive ? "active" : "")}>
          Location
        </NavLink>
        <NavLink to="/compare" className={({ isActive }) => (isActive ? "active" : "")}>
          Compare
        </NavLink>
        <NavLink to="/heatmap" className={({ isActive }) => (isActive ? "active" : "")}>
          City demand
        </NavLink>
      </nav>

      {/* Styled in CSS rather than inline so the mobile breakpoint can move it
          onto its own row. Inline margin-left:auto would win over the media
          query and push these actions off a narrow screen entirely. */}
      <span className="mast-actions">{children}</span>
    </header>
  );
}

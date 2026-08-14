import { useId, useState, type ReactNode } from "react";

/**
 * A group of inputs, closed until wanted.
 *
 * The sidebar was seventeen fields in one 2,900px column, every one carrying
 * the same weight as the price and the rent. Progressive disclosure fixes the
 * wall, but it can also hide something that needs attention — so a group
 * carrying a warning opens itself and says how many, and the summary always
 * shows how many fields are inside.
 */
export function CollapsibleGroup({
  title,
  count,
  warnings = 0,
  defaultOpen = false,
  children,
}: {
  title: string;
  count: number;
  /** Forces the group open and marks it, so a warning is never buried. */
  warnings?: number;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen || warnings > 0);
  const id = useId();

  return (
    <section className="card sim-group">
      <button
        type="button"
        className="sim-group-head"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="sim-group-title">{title}</span>

        {warnings > 0 && (
          <span className="pill amber">
            {warnings} to check
          </span>
        )}

        <span className="sim-group-count">{count}</span>
        <span className={`sim-chevron ${open ? "open" : ""}`} aria-hidden="true">
          ›
        </span>
      </button>

      {open && (
        <div className="body" id={id}>
          {children}
        </div>
      )}
    </section>
  );
}

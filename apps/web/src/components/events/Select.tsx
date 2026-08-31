import { useEffect, useId, useRef, useState } from "react";
import gsap from "gsap";

/**
 * A listbox that can actually be animated.
 *
 * A native `<select>` renders its options in the operating system's own popup,
 * which no stylesheet or tween can touch — so the panel here is real DOM. That
 * is a trade, not a free upgrade: the browser gives you keyboard support,
 * type-ahead and screen-reader semantics for nothing, and rebuilding them is
 * the price of the animation. All of it is implemented below rather than
 * skipped, because a filter you cannot drive from the keyboard is worse than
 * one that does not animate.
 *
 * Follows the ARIA listbox pattern: the trigger owns `aria-expanded` and
 * `aria-haspopup`, the panel is `role="listbox"`, each row is `role="option"`
 * with `aria-selected`, and the active row is tracked through
 * `aria-activedescendant` so focus never leaves the trigger.
 */

export interface SelectOption {
  value: string;
  label: string;
  /** Optional right-aligned hint, e.g. a count. */
  hint?: string;
}

export function Select({
  label,
  value,
  options,
  onChange,
  placeholder = "Any",
  icon,
  variant = "plain",
}: {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  icon?: React.ReactNode;
  /** `accent` is the ranking control — it carries the page's one primary action. */
  variant?: "plain" | "accent";
}) {
  const id = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value);

  /**
   * An empty value shows the PLACEHOLDER, even though an empty-valued option
   * exists in the list.
   *
   * Both controls have one — "All states" and "Show in date order" — but they
   * mean different things. For the state filter, empty is a real selection and
   * the placeholder says the same thing. For ranking it means "not chosen
   * yet", and echoing the off-option there made the trigger describe what the
   * page is currently doing instead of inviting the choice it wants.
   */
  const display = value ? (selected?.label ?? placeholder) : placeholder;
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /** Open the panel at the current selection rather than at the top. */
  useEffect(() => {
    if (!open) return;
    const index = options.findIndex((o) => o.value === value);
    setActive(index >= 0 ? index : 0);
  }, [open, value, options]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;

    // Killed first: reopening mid-close would otherwise let the close tween's
    // completion hide the panel that had just opened.
    gsap.killTweensOf(panel);
    gsap.killTweensOf(panel.querySelectorAll(".sel-opt"));

    if (reduced()) {
      gsap.set(panel, { autoAlpha: open ? 1 : 0, y: 0, scale: 1 });
      return;
    }

    if (open) {
      gsap
        .timeline()
        .fromTo(
          panel,
          { autoAlpha: 0, y: -6, scale: 0.97 },
          { autoAlpha: 1, y: 0, scale: 1, duration: 0.24, ease: "power3.out" },
        )
        .from(
          panel.querySelectorAll(".sel-opt"),
          { opacity: 0, y: -4, duration: 0.18, stagger: 0.018, ease: "power1.out" },
          "-=0.14",
        );
    } else {
      // Exit runs shorter than entry, which is what makes a menu feel
      // responsive rather than reluctant to leave.
      gsap.to(panel, { autoAlpha: 0, y: -4, scale: 0.98, duration: 0.15, ease: "power2.in" });
    }
  }, [open]);

  /**
   * Keep the active row in view when arrowing past the fold — by scrolling the
   * LIST, never the page.
   *
   * `scrollIntoView` walks up and scrolls every scrollable ancestor, including
   * the document. On a phone that moved the sticky filter bar, which moved the
   * panel, which moved the option out from under the finger: the row never
   * settled and a tap could not land on it. Adjusting the list's own
   * scrollTop touches nothing outside the panel.
   */
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    const row = list?.children[active] as HTMLElement | undefined;
    if (!list || !row) return;

    const top = row.offsetTop;
    const bottom = top + row.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) {
      list.scrollTop = bottom - list.clientHeight;
    }
  }, [active, open]);

  /** Click or focus leaving the control closes it. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const commit = (index: number) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  };

  /** The keyboard contract a native select would have given us for free. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = options.length - 1;

    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;

    switch (e.key) {
      case "Escape":
        e.preventDefault();
        setOpen(false);
        break;
      case "ArrowDown":
        e.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActive(0);
        break;
      case "End":
        e.preventDefault();
        setActive(last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        commit(active);
        break;
      case "Tab":
        setOpen(false);
        break;
      default:
        // Type-ahead: jump to the next option starting with the typed letter.
        if (e.key.length === 1 && /\S/.test(e.key)) {
          const letter = e.key.toLowerCase();
          const from = active + 1;
          const order = [...options.slice(from), ...options.slice(0, from)];
          const hit = order.find((o) => o.label.toLowerCase().startsWith(letter));
          if (hit) setActive(options.indexOf(hit));
        }
    }
  };

  return (
    <div
      /* `is-on` marks the accent control as ACTIVE rather than merely
         clickable — ranking is either shaping the list or it is not, and gold
         is reserved for the state where it is. */
      className={`sel sel-${variant}${open ? " is-open" : ""}${value ? " is-on" : ""}`}
      ref={rootRef}
    >
      {/* A SPAN, not a <label for>. A label associated with a button REPLACES
          its content as the accessible name, so this control would have
          announced "State" and never said which state was chosen. Pairing the
          caption with the button's own id in aria-labelledby announces both:
          "State, All states". */}
      <span className="sel-label" id={`${id}-lbl`}>
        {label}
      </span>

      <button
        id={`${id}-btn`}
        type="button"
        className="sel-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-labelledby={`${id}-lbl ${id}-btn`}
        {...(open ? { "aria-activedescendant": `${id}-opt-${active}` } : {})}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKeyDown}
      >
        {icon && <span className="sel-icon">{icon}</span>}
        <span className="sel-value">{display}</span>
        <svg className="sel-caret" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Rendered always so the close animation has something to run on;
          `autoAlpha` takes it out of the accessibility tree when hidden. */}
      <div className="sel-panel" ref={panelRef}>
        <ul id={`${id}-list`} role="listbox" aria-label={label} ref={listRef} className="sel-list">
          {options.map((option, i) => (
            <li
              key={option.value}
              id={`${id}-opt-${i}`}
              role="option"
              aria-selected={option.value === value}
              className={`sel-opt${i === active ? " is-active" : ""}${
                option.value === value ? " is-selected" : ""
              }`}
              /**
               * No onMouseEnter here, deliberately.
               *
               * Setting the active row on hover fed a loop: hover moved the
               * active row, which scrolled the list, which slid a different
               * row under the pointer, which fired hover again — the option
               * never settled and a tap could not land on it. The pointer
               * highlight is CSS `:hover`; `active` now tracks the keyboard
               * alone, which is the only thing that needs to be remembered.
               */
              onMouseDown={(e) => {
                // mousedown, not click: the outside-click handler fires first
                // and would close the panel before a click could land.
                e.preventDefault();
                commit(i);
              }}
            >
              <span className="sel-opt-label">{option.label}</span>
              {option.hint && <span className="sel-opt-hint">{option.hint}</span>}
              <svg className="sel-tick" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

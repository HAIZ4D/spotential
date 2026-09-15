import { useRef } from "react";
import type { BusinessCategory, EventListing } from "@spotential/sim-engine";
import { buildGuidance } from "./guidance.js";
import { useReveal } from "./useReveal.js";

/**
 * The rules, in two voices that are never allowed to blur.
 *
 * The organizer's requirements are quoted verbatim under their name. Ours are
 * headed as ours, in a line the reader cannot miss, because this page is what
 * a vendor uses to decide whether to pay an organizer money and advice in the
 * wrong voice would read as a term they have agreed to. See `guidance.ts` for
 * why that distinction is load-bearing rather than fussy.
 */

export function EventRules({
  event,
  category,
}: {
  event: EventListing;
  category: BusinessCategory;
}) {
  const guidance = buildGuidance(event, category);
  const askRef = useRef<HTMLUListElement>(null);
  useReveal(askRef, { selector: ":scope > li", stagger: 0.05 });

  return (
    <section className="evx-sec" id="rules">
      <header className="evx-sec-head">
        <span className="evx-kicker">Before you commit</span>
        <h2>The rules, and the questions worth asking</h2>
        <p className="evx-lede">
          Two different things, kept apart on purpose. What the organizer requires is theirs and
          you are bound by it. Everything under it is ours.
        </p>
      </header>

      <div className="evx-rules">
        <div className="evx-rulecard organizer">
          <h3>
            What {event.organizerName} requires
            <span className="evx-tag">their terms</span>
          </h3>
          {event.vendorRequirements.length === 0 ? (
            <p className="evx-none">
              No vendor requirements are published for this event. That is not the same as none
              existing, so ask before you plan your setup.
            </p>
          ) : (
            <ul className="evx-ticks">
              {event.vendorRequirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="evx-rulecard ask">
          <h3>
            Ask before you pay
            <span className="evx-tag ours">Spotential&apos;s guidance, not the organizer&apos;s terms</span>
          </h3>
          <ul className="evx-asklist" ref={askRef}>
            {guidance.askFirst.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function EventDoDont({
  event,
  category,
}: {
  event: EventListing;
  category: BusinessCategory;
}) {
  const guidance = buildGuidance(event, category);
  const gridRef = useRef<HTMLDivElement>(null);
  useReveal(gridRef, { selector: ":scope > div", stagger: 0.08 });

  return (
    <section className="evx-sec" id="do-dont">
      <header className="evx-sec-head">
        <span className="evx-kicker">Trading it well</span>
        <h2>Do, and do not</h2>
        <p className="evx-lede">
          Worked out from this event&apos;s own hours, dates, venue and what you sell, so none of it
          is generic. <strong>Spotential&apos;s guidance, not the organizer&apos;s terms.</strong>
          {guidance.traits.length > 0 && (
            <>
              {" "}
              Based on:{" "}
              {guidance.traits.map((trait) => (
                <span className="evx-trait" key={trait}>
                  {trait}
                </span>
              ))}
            </>
          )}
        </p>
      </header>

      <div className="evx-dd" ref={gridRef}>
        <div className="evx-dd-col do">
          <h3>
            <Tick /> Do
          </h3>
          <ul>
            {guidance.doThis.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="evx-dd-col dont">
          <h3>
            <Cross /> Do not
          </h3>
          <ul>
            {guidance.notThis.map((item) => (
              <li key={item.title}>
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/* Inline SVG rather than an icon package or an emoji: two glyphs do not
   justify a dependency, and emoji render differently on every platform and
   cannot be themed. */
function Tick() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" focusable="false">
      <path
        d="M4 10.5l4 4 8-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Cross() {
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true" focusable="false">
      <path
        d="M5 5l10 10M15 5L5 15"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

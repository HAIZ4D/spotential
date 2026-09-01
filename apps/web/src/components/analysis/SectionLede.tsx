import { useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";

/**
 * The band that answers before the section lists.
 *
 * The rentals panel reads better than the rest of this page for one structural
 * reason, not a decorative one: it states the answer, then shows the evidence.
 * The other sections opened straight into a control row and a list, so a
 * reader had to assemble the finding themselves from twenty rows.
 *
 * EVERY SENTENCE HERE IS DERIVED, never generated. The same call the PDF cover
 * and the event cards already make, and for the same reason: this sits
 * directly on top of the figures it describes, so a model-written sentence
 * could contradict the number an inch below it. It also costs nothing and
 * cannot fail, which is why it renders on every section rather than behind a
 * button and a spend limit.
 */

export interface LedeFact {
  value: string;
  label: string;
  tone?: "navy" | "green" | "amber" | "red" | undefined;
}

export function SectionLede({
  eyebrow,
  headline,
  facts = [],
  note,
}: {
  eyebrow: string;
  headline: React.ReactNode;
  facts?: LedeFact[];
  note?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      gsap.from(".lede-fact", {
        y: 8,
        autoAlpha: 0,
        duration: 0.4,
        ease: "power2.out",
        stagger: 0.045,
        // Stagger reveals order, so it must not outlast the reader's glance.
        delay: 0.05,
      });
    },
    { scope: ref },
  );

  return (
    <div className="lede" ref={ref}>
      <p className="lede-eyebrow">{eyebrow}</p>
      <p className="lede-headline">{headline}</p>

      {facts.length > 0 && (
        <dl className="lede-facts">
          {facts.map((fact) => (
            <div key={fact.label} className={`lede-fact ${fact.tone ?? ""}`}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {note && <p className="lede-note">{note}</p>}
    </div>
  );
}

import { useRef, type CSSProperties } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { PREMIUM } from "../../lib/ease.js";
import mark from "../../../img/spotential-mark.png";

/**
 * The Spotential mark, thinking.
 *
 * A 9 second loop for the wait on `/simulator`, which is a measured 13 to 46
 * seconds against the live model. Two 4.5s halves: the gleam fires on the
 * second one only, so the light reads as an occasional catch rather than a
 * metronome.
 *
 * THE ARTWORK IS THE REAL FILE, not a trace. The supplied mark is a 101x108
 * PNG — an illustrative logo with gradients, a folded map and buildings — and
 * eyeballing that into vector paths would ship a visibly worse imitation of
 * the brand. The PNG's alpha channel is what makes the light sweep possible
 * anyway: masking a moving gradient with the file itself sends the light
 * through the mark's own silhouette rather than across a rectangle.
 *
 * ON A WHITE DISC, deliberately. The mark's darkest navy is the same family as
 * the console behind it, so on that ground the S loses its edge — the same
 * finding the navbar made. The disc also puts the glow out on the navy, where
 * a luminous bloom actually reads; on white it would be near invisible.
 *
 * MOTION IDENTITY: PREMIUM. One signature curve carries everything that is not
 * a seamless loop. The first version used four unrelated easings, which is why
 * it read as assembled rather than designed — the single most valuable change
 * the motion-design skill surfaced.
 */

/**
 * The signature curve: `cubic-bezier(0.4, 0, 0.2, 1)`, the Premium archetype.
 *
 * Registered through `CustomEase`, which is free in GSAP 3.11 and up and ships
 * inside the package already installed. Worth the import rather than reaching
 * for the nearest built-in: `power2.inOut` is symmetric and lands visibly
 * differently, and the point of a signature curve is that it is one exact
 * curve rather than an approximation applied inconsistently.
 *
 * VERIFIED against the CSS bezier rather than assumed — GSAP's core does NOT
 * parse a `cubic-bezier(...)` string, and passing one silently falls back to a
 * default ease, which would have been a defect nobody could see. Sampled at
 * quarter points the two agree to three decimals.
 */
/* Registered in `lib/ease.ts`, which every surface that wants this curve
   imports. It used to be created here, which worked only because the
   simulator was the only page asking for it: a named ease that was never
   registered falls back to a default and says nothing. */

/**
 * Radius, orbit period, start angle, and which of three waves it belongs to.
 *
 * WAVES, not a burst. The skill's 1/3 rule says no more than a third of a set
 * should be in active motion at once; the first version emitted all eight
 * inside half a second, which is all of them. Three waves keep roughly a third
 * in transit and leave the rest holding station, which reads as a system
 * working rather than a firework.
 */
const PARTICLES = [
  { r: 44, spin: 7.5, from: 0, gold: false, wave: 0 },
  { r: 52, spin: 9.5, from: 140, gold: true, wave: 1 },
  { r: 38, spin: 6.5, from: 220, gold: false, wave: 2 },
  { r: 58, spin: 11, from: 60, gold: true, wave: 0 },
  { r: 47, spin: 8.5, from: 300, gold: false, wave: 1 },
  { r: 63, spin: 12.5, from: 25, gold: true, wave: 2 },
  { r: 41, spin: 7, from: 180, gold: false, wave: 0 },
  { r: 55, spin: 10, from: 255, gold: true, wave: 1 },
];

/** Quick / standard / slow. Three durations, applied consistently. */
const QUICK = 0.18;
const STANDARD = 0.42;
const SLOW = 0.9;

export function SpotentialThinking() {
  const rootRef = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      // Held on the resting frame for anyone who asked for less motion. The
      // mark is still present and still the brand; it simply does not move.
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const loop = gsap.timeline({ repeat: -1, defaults: { ease: PREMIUM } });

      /**
       * ONE 9 SECOND COMPOSITION, not two identical halves.
       *
       * The halves had to be widened so far apart to satisfy the 1/3 rule that
       * they stopped being halves. A single sequence gives the waves room to
       * finish before the next begins, and gives the gleam a genuine 7 second
       * rest rather than firing every loop.
       */

      // ANTICIPATION: a contraction against the coming expansion. 180ms and
      // about 15% of the main action, per the skill's 100-200ms / 10-20%.
      loop.to(".st-mark", { scale: 0.985, duration: QUICK }, 0.55);

      // The bloom. Navy leads, gold trails a beat behind so it layers rather
      // than flashes.
      loop
        .fromTo(".st-glow-navy", { opacity: 0.16, scale: 0.88 }, { opacity: 0.72, scale: 1.06, duration: SLOW }, 0.8)
        .fromTo(".st-glow-gold", { opacity: 0.09, scale: 0.92 }, { opacity: 0.5, scale: 1.12, duration: SLOW + 0.1 }, 1.0);

      /**
       * Two breaths across the loop, inside the skill's waiting/idle band of
       * 0.98 to 1.02 at roughly 3000ms a cycle. It was 1.03 before: past that
       * a wait starts demanding attention instead of keeping company.
       */
      for (const at of [0.9, 4.5]) {
        loop
          .to(".st-mark", { scale: 1.015, duration: 1.7, ease: "sine.inOut" }, at)
          .to(".st-mark", { scale: 1, duration: 1.6, ease: "sine.inOut" }, at + 1.7);

        /**
         * SECONDARY ACTION on the disc: its shadow follows the breath at about
         * 40% amplitude, 80ms behind. The skill names a missing secondary
         * layer as the cause of animation that "feels cheap/flat", and this is
         * the layer the disc did not have.
         */
        loop
          .to(".st-disc", { "--lift": 1, duration: 1.7, ease: "sine.inOut" }, at + 0.08)
          .to(".st-disc", { "--lift": 0, duration: 1.6, ease: "sine.inOut" }, at + 1.78);
      }

      /**
       * Particles, in three waves that DO NOT OVERLAP.
       *
       * The 1/3 rule says no more than a third of a set should be in active
       * motion at once. Eight dots emitting together is all of them; even
       * three waves overlapping put eight in transit at the crossover, which a
       * measurement caught and the eye would have read as a burst. Each wave
       * now completes its travel before the next begins, so at most three of
       * the eight are ever moving between radii. The rest hold station and
       * orbit, which is ambient rather than competing.
       *
       * GSAP owns `x` and `y` on the dot; CSS owns `rotate` on the ring around
       * it. Different elements on purpose — the two must never both own one
       * element's transform, a collision that has cost this codebase three
       * separate bugs.
       *
       * `y` arcs the path rather than firing it straight out: natural arcs
       * unless intentionally mechanical, and curved reads as friendly where
       * angular reads as tense.
       */
      const TRAVEL = 0.9;
      for (let wave = 0; wave < 3; wave += 1) {
        const sel = `.st-dot[data-wave="${wave}"]`;

        loop
          .fromTo(
            sel,
            { x: 0, y: 0, opacity: 0, scale: 0.35 },
            {
              x: (_i: number, t: HTMLElement) => Number(t.dataset["r"]),
              y: (_i: number, t: HTMLElement) => Number(t.dataset["r"]) * -0.18,
              opacity: 1,
              scale: 1,
              duration: TRAVEL,
              ease: PREMIUM,
            },
            1.0 + wave * 1.0,
          )
          .to(
            sel,
            { x: 0, y: 0, opacity: 0, scale: 0.35, duration: TRAVEL, ease: PREMIUM },
            5.0 + wave * 1.0,
          );
      }

      /**
       * The gleam, once per loop.
       *
       * The shimmer pattern asks for a 1500-2500ms sweep with a 2000-5000ms
       * rest between. It used to fire every 4.5s at 55% white, which stops
       * reading as light and starts reading as a mechanism. Once per 9s leaves
       * roughly 7 seconds of quiet either side.
       */
      loop.fromTo(
        ".st-sweep",
        { backgroundPosition: "130% 130%" },
        { backgroundPosition: "-50% -50%", duration: 1.8, ease: PREMIUM },
        3.3,
      );

      /**
       * FOLLOW-THROUGH: the glow settles 120ms after the mark rather than with
       * it. Children trailing their parent is most of what separates crafted
       * motion from mechanical motion.
       */
      loop
        .to(".st-glow-navy", { opacity: 0.16, scale: 0.88, duration: SLOW }, 7.4)
        .to(".st-glow-gold", { opacity: 0.09, scale: 0.92, duration: SLOW }, 7.52);

      // Dead air, matching the still opening, so the loop joins invisibly.
      loop.to({}, { duration: STANDARD }, 8.6);
    },
    { scope: rootRef },
  );

  return (
    <span className="st" ref={rootRef} aria-hidden="true">
      <span className="st-glow-navy" />
      <span className="st-glow-gold" />

      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="st-ring"
          style={{ "--spin": `${p.spin}s`, "--from": `${p.from}deg` } as CSSProperties}
        >
          <span
            className={`st-dot ${p.gold ? "gold" : "navy"}`}
            data-wave={p.wave}
            data-r={p.r}
          />
        </span>
      ))}

      <span className="st-disc">
        <img src={mark} alt="" width={54} height={58} className="st-mark" />
        {/* Masked by the artwork's own alpha, so the light travels through the
            logo rather than across a box. */}
        <span className="st-sweep" style={{ "--mark": `url(${mark})` } as CSSProperties} />
      </span>
    </span>
  );
}

import { useCountUp } from "../sim/useCountUp.js";
import { formatNumber } from "@spotential/sim-engine";

/**
 * One tile of the events hero's bento grid.
 *
 * Three things it deliberately does NOT do. It does not print an em dash while
 * the catalogue loads — a lone dash means nothing to a reader who has not been
 * told what it means, so an unresolved figure is a skeleton and a resolved-but-
 * absent one says so in words. It does not animate a figure it cannot count:
 * `value` is null for "no priced booth here", which is a different statement
 * from zero. And it counts on ARRIVAL only, at 700ms rather than the 200ms the
 * simulator's sliders use, because nothing here is waiting on the number.
 */
export function HeroTile({
  label,
  value,
  prefix = "",
  absent,
  note,
  wide = false,
  accent = false,
}: {
  label: string;
  /** `undefined` while loading, `null` when there is genuinely no figure. */
  value: number | null | undefined;
  prefix?: string;
  /** What to say instead of a number when `value` is null. In words. */
  absent?: string;
  note: string;
  wide?: boolean;
  accent?: boolean;
}) {
  const shown = useCountUp(typeof value === "number" ? value : 0, 700);

  const body =
    value === undefined ? (
      <>
        <span className="hb-skel" aria-hidden="true" />
        <span className="sr-only">Loading</span>
      </>
    ) : value === null ? (
      <span className="hb-absent">{absent ?? "not stated"}</span>
    ) : (
      <>
        {prefix}
        {formatNumber(Math.round(shown))}
      </>
    );

  return (
    <div className={`hb-tile${wide ? " hb-wide" : ""}${accent ? " hb-accent" : ""}`}>
      <dt>{label}</dt>
      <dd>
        <span className="hb-value">{body}</span>
        <span className="hb-note">{note}</span>
      </dd>
    </div>
  );
}

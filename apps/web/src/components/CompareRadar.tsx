import {
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import type { ComparedLocation } from "@spotential/sim-engine";

/**
 * Two or three location profiles on one radar.
 *
 * This is the hero of the comparison: the shape difference lands before any
 * number does. A site that is weak on competition but strong on catchment
 * looks visibly different from the reverse, which a pair of scores cannot show.
 */

/** Navy, gold, green — the CLAUDE.md palette, distinguishable at a glance. */
const SERIES_COLOURS = ["#003087", "#f2a900", "#16a34a"];

/**
 * Axes with data on at least one site. Below three, a radar is a sliver.
 *
 * This is the same finding that removed the radar from `/analysis`: with most
 * axes unscored the shape reads as two terrible locations rather than as
 * absent data. `/compare` keeps its radar because overlaying two shapes is the
 * point, and that only holds when there are shapes.
 */
export function scoredAxisCount(locations: ComparedLocation[]): number {
  const axes = locations[0]?.score.dimensions.length ?? 0;
  let scored = 0;
  for (let i = 0; i < axes; i += 1) {
    const any = locations.some((l) => l.score.dimensions[i]?.kind !== "unavailable");
    if (any) scored += 1;
  }
  return scored;
}

export const MIN_RADAR_AXES = 3;

export function CompareRadar({ locations }: { locations: ComparedLocation[] }) {
  if (locations.length === 0) return null;

  /**
   * Fewer than three measured axes and the chart says something false, so it
   * says nothing instead and the panel explains why in words. Silence would be
   * worse: a reader who saw a radar last time needs to know it is gone because
   * of the data, not because it broke.
   */
  const scored = scoredAxisCount(locations);
  if (scored < MIN_RADAR_AXES) {
    return (
      <p className="cmpx-noshape">
        Only {scored === 0 ? "no" : scored} of {locations[0]!.score.dimensions.length} dimensions
        {scored === 1 ? " carries" : " carry"} data on either site, which is too few to draw a
        profile worth comparing. A shape built mostly from unscored axes looks like a weak
        location rather than a thinly measured one, so the bars above are the honest read here.
      </p>
    );
  }

  /**
   * ONLY THE AXES THAT CARRY DATA, which is a reversal of what this did.
   *
   * Unavailable axes used to plot at zero, on the reasoning that hiding them
   * would imply a complete profile. In practice a pentagon with two spokes
   * pinned at the centre does not read as "two axes unmeasured", it reads as
   * two bad locations — the same misreading that removed the radar from
   * `/analysis` entirely. A triangle built from three real numbers is honest;
   * a pentagon built from three real numbers and two zeroes is not, and the
   * panel says in words how many axes were dropped.
   */
  const measured = locations[0]!.score.dimensions
    .map((d, index) => ({ label: d.label, index }))
    .filter(({ index }) =>
      locations.some((l) => l.score.dimensions[index]?.kind !== "unavailable"),
    );

  const data = measured.map(({ label, index }) => {
    const row: Record<string, string | number> = { axis: label };
    for (const location of locations) {
      const dimension = location.score.dimensions[index];
      // Within a plotted axis, a site with no reading still sits at zero: the
      // other site DOES have a number there, so the gap is the finding.
      row[location.label] =
        dimension && dimension.kind !== "unavailable" ? dimension.score : 0;
    }
    return row;
  });

  const total = locations[0]!.score.dimensions.length;
  const dropped = total - measured.length;

  return (
    <div>
      {dropped > 0 && (
        <p className="cmpx-shapenote">
          Drawn from the {measured.length} dimension{measured.length === 1 ? "" : "s"} that carry
          data. {dropped} unscored {dropped === 1 ? "axis is" : "axes are"} left off rather than
          plotted at zero, which would make both sites look worse than the evidence says.
        </p>
      )}
      <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <RadarChart data={data} outerRadius="70%">
          <PolarGrid stroke="var(--line)" />
          <PolarAngleAxis dataKey="axis" tick={{ fontSize: 11, fill: "var(--ink-2)" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          {locations.map((location, index) => (
            <Radar
              key={location.id}
              name={location.label}
              dataKey={location.label}
              stroke={SERIES_COLOURS[index % SERIES_COLOURS.length]}
              fill={SERIES_COLOURS[index % SERIES_COLOURS.length]}
              fillOpacity={0.18}
              isAnimationActive={false}
            />
          ))}
          <Legend wrapperStyle={{ fontSize: 12 }} />
          </RadarChart>
      </ResponsiveContainer>
      </div>
    </div>
  );
}

export { SERIES_COLOURS };

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

export function CompareRadar({ locations }: { locations: ComparedLocation[] }) {
  if (locations.length === 0) return null;

  // One row per axis, one key per location.
  const axes = locations[0]!.score.dimensions.map((d) => d.label);
  const data = axes.map((axis, index) => {
    const row: Record<string, string | number> = { axis };
    for (const location of locations) {
      const dimension = location.score.dimensions[index];
      // Unavailable axes plot at zero so the missing side of every shape is
      // visible rather than quietly closed up — the rent gap is the same on
      // both, and hiding it would imply the profile is complete.
      row[location.label] =
        dimension && dimension.kind !== "unavailable" ? dimension.score : 0;
    }
    return row;
  });

  return (
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
  );
}

export { SERIES_COLOURS };

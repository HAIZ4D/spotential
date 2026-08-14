import {
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { useMemo, useState } from "react";
import { formatNumber, type CompetitorsResponseShape } from "./competitorTypes.js";
import { CompetitorRow } from "./analysis/CompetitorRow.js";

/**
 * Competitor panels — Feature 1b.
 *
 * Everything here reads from one server response. The browser never calls
 * Places: results are cached server-side, so panning the pin slightly costs
 * nothing and two users looking at the same street share one paid lookup.
 */

export function CompetitorList({
  data,
  hoveredId = null,
  onHover,
}: {
  data: CompetitorsResponseShape;
  /** Shared with the map, so a row and its pin light up together. */
  hoveredId?: string | null;
  onHover?: (id: string | null) => void;
}) {
  const { competitors, summary, fromCache, fetchedAt } = data;
  const [sort, setSort] = useState<"distance" | "rating" | "reviews">("distance");

  const sorted = useMemo(() => {
    const list = [...competitors];
    if (sort === "rating") {
      // Unrated last rather than at the top as a zero — the same rule the
      // summary follows when it refuses to average them in.
      return list.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    }
    if (sort === "reviews") return list.sort((a, b) => b.reviewCount - a.reviewCount);
    return list.sort((a, b) => a.distanceMetres - b.distanceMetres);
  }, [competitors, sort]);

  const maxReviews = useMemo(
    () => competitors.reduce((max, c) => Math.max(max, c.reviewCount), 0),
    [competitors],
  );

  return (
    <section className="card">
      <header>
        <h2>Competitors nearby</h2>
        <span className="pill muted" title={fromCache ? "Served from cache — no API call" : "Freshly fetched"}>
          {competitors.length} within {formatNumber(data.radiusMetres)}m
        </span>
      </header>

      <div className="body">
        <div className="spread" style={{ marginBottom: 10 }}>
          <div className="small muted">
            {summary.averageRating === null
              ? "None of them have ratings yet"
              : `Average rating ${summary.averageRating} across ${summary.ratedCount} rated`}
            {summary.nearestMetres !== null && ` · nearest ${formatNumber(summary.nearestMetres)}m away`}
          </div>
          {/* An SME should know whether this is today's data or last Tuesday's. */}
          <span className="tiny muted">{describeAge(fetchedAt, fromCache)}</span>
        </div>

        {/* Single span child below: .notice is display:flex, so bare inline
            elements would each become a flex item and fragment the sentence. */}
        {data.truncated && data.completeToMetres !== null && (
          <div className="notice warn" style={{ marginBottom: 10 }}>
            <span>
              Google returns at most 20 places per search, and this area filled that quota within{" "}
              {formatNumber(data.completeToMetres)}m. Treat this as the <strong>20 nearest</strong>,
              not the full picture — there are very likely more beyond{" "}
              {formatNumber(data.completeToMetres)}m.
            </span>
          </div>
        )}

        {competitors.length === 0 ? (
          <div className="notice info">
            No competitors of this type found within the radius. Either a genuine gap, or the
            category is not how Google labels them here — try a wider radius.
          </div>
        ) : (
          <>
            <div className="clist-sort">
              <span className="tiny muted">Sort</span>
              <div className="segmented">
                {(
                  [
                    ["distance", "Nearest"],
                    ["rating", "Best rated"],
                    ["reviews", "Busiest"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={sort === key}
                    onClick={() => setSort(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <ul className="clist">
              {sorted.map((c, index) => (
                <CompetitorRow
                  key={c.id}
                  competitor={c}
                  rank={index + 1}
                  maxReviews={maxReviews}
                  radiusMetres={data.radiusMetres}
                  hovered={hoveredId === c.id}
                  onHover={onHover ?? (() => {})}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

/**
 * The spec's "competitor analysis (size vs rating)".
 *
 * Review count stands in for size — it is the only proxy Places gives without
 * moving into a more expensive field tier.
 */
export function CompetitorScatter({ data }: { data: CompetitorsResponseShape }) {
  const points = data.competitors
    .filter((c) => typeof c.rating === "number")
    .map((c) => ({ x: c.reviewCount, y: c.rating as number, name: c.name, z: 60 }));

  if (points.length < 2) return null;

  return (
    <section className="card">
      <header>
        <h2>Size against rating</h2>
        <span className="tiny muted">review count as a proxy for size</span>
      </header>
      <div className="body">
        <div style={{ width: "100%", height: 240 }}>
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 0 }}>
              <CartesianGrid stroke="var(--line)" />
              <XAxis
                type="number"
                dataKey="x"
                name="Reviews"
                tick={{ fontSize: 11, fill: "var(--ink-2)" }}
                axisLine={{ stroke: "var(--line)" }}
                tickLine={false}
                label={{ value: "reviews", position: "insideBottom", offset: -8, fontSize: 10, fill: "var(--ink-3)" }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="Rating"
                domain={[1, 5]}
                tick={{ fontSize: 11, fill: "var(--ink-2)" }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <ZAxis type="number" dataKey="z" range={[50, 90]} />
              <Tooltip
                cursor={{ strokeDasharray: "3 3" }}
                contentStyle={{ border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}
                formatter={(value: number, name) => [value, name === "x" ? "Reviews" : "Rating"]}
                labelFormatter={() => ""}
              />
              <Scatter data={points} fill="var(--navy)">
                {points.map((p, i) => (
                  // Highly rated AND busy is the genuinely hard competition.
                  <Cell
                    key={i}
                    fill={p.y >= 4.3 && p.x >= 200 ? "var(--red)" : "var(--navy)"}
                    fillOpacity={0.75}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
        <p className="tiny muted" style={{ margin: "8px 0 0" }}>
          Red marks the established operators — well rated with many reviews. Those are the ones
          you would be taking custom from.
        </p>
      </div>
    </section>
  );
}

export function CompetitionDensity({ data }: { data: CompetitorsResponseShape }) {
  const { density, completeToMetres } = data;
  const max = Math.max(...density.map((b) => b.count), 1);
  let lower = 0;

  return (
    <section className="card">
      <header>
        <h2>Competition density</h2>
        {completeToMetres !== null && (
          <span className="pill amber">complete to {formatNumber(completeToMetres)}m</span>
        )}
      </header>
      <div className="body">
        {density.map((band) => {
          const from = lower;
          lower = band.upToMetres;
          // Beyond the truncation point we did not look, so we do not know.
          // Showing "0" here would invent a gap that may not exist.
          const unknown = completeToMetres !== null && from >= completeToMetres;

          return (
            <div className="sens-row" key={band.upToMetres}>
              <span className={unknown ? "muted" : undefined}>
                {from}–{band.upToMetres}m
              </span>
              <span className="sens-bar">
                {!unknown && <span style={{ width: `${(band.count / max) * 100}%` }} />}
              </span>
              <span className="months" title={unknown ? "Not searched this far out" : undefined}>
                {unknown ? "not searched" : band.count}
              </span>
            </div>
          );
        })}

        {completeToMetres !== null && (
          <p className="tiny muted" style={{ margin: "10px 0 0" }}>
            Google capped the search at 20 results, which ran out at{" "}
            {formatNumber(completeToMetres)}m. Bands past that are unknown, not empty — a dense
            area cannot be read as a quiet one just because the quota ran out.
          </p>
        )}
      </div>
    </section>
  );
}

function describeAge(fetchedAt: number, fromCache: boolean): string {
  if (!fromCache) return "just fetched";
  const days = Math.floor((Date.now() - fetchedAt) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "cached today";
  return `cached ${days} day${days === 1 ? "" : "s"} ago`;
}

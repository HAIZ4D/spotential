import { formatNumber, formatPercent } from "@spotential/sim-engine";
import type { DemographicsResponse } from "../lib/api.js";

/**
 * District demographics — Feature 1c.
 *
 * THE THING THIS PANEL MUST NOT DO is let someone read the district population
 * as their catchment. Kuala Lumpur district is over two million people; a 500m
 * radius is not. Getting that wrong by two orders of magnitude, next to a
 * break-even calculator, is exactly the sort of error this product cannot
 * afford — so the headline is the MIX, the population is labelled as area
 * context, and it is never multiplied into anything.
 */

/** DOSM's ethnicity keys, in the order they are worth reading. */
const ETHNICITY_LABELS: [string, string][] = [
  ["bumi_malay", "Malay"],
  ["bumi_other", "Other Bumiputera"],
  ["chinese", "Chinese"],
  ["indian", "Indian"],
  ["other_citizen", "Other citizens"],
  ["other_noncitizen", "Non-citizens"],
];

/** Working-age bands matter most for an F&B catchment. */
const AGE_GROUPS: [string, string[]][] = [
  ["Under 15", ["0-4", "5-9", "10-14"]],
  ["15–24", ["15-19", "20-24"]],
  ["25–34", ["25-29", "30-34"]],
  ["35–44", ["35-39", "40-44"]],
  ["45–54", ["45-49", "50-54"]],
  ["55–64", ["55-59", "60-64"]],
  ["65+", ["65-69", "70-74", "75-79", "80-84", "85+"]],
];

export function DemographicsPanel({ data }: { data: DemographicsResponse }) {
  if (!data.matched || !data.demographics) {
    return (
      <section className="card">
        <header>
          <h2>Area demographics</h2>
        </header>
        <div className="body">
          <div className="notice info">
            This point does not fall inside any Malaysian administrative district, so there is no
            demographic data for it. Offshore pins and locations outside Malaysia will show this.
          </div>
        </div>
      </section>
    );
  }

  const { district, total, age, ethnicity } = data.demographics;

  const ageRows = AGE_GROUPS.map(([label, bands]) => ({
    label,
    people: bands.reduce((sum, band) => sum + (age[band] ?? 0), 0),
  }));
  const ageTotal = ageRows.reduce((sum, r) => sum + r.people, 0) || 1;
  const maxAge = Math.max(...ageRows.map((r) => r.people), 1);

  const ethRows = ETHNICITY_LABELS.map(([key, label]) => ({
    label,
    people: ethnicity[key] ?? 0,
  })).filter((r) => r.people > 0);
  const ethTotal = ethRows.reduce((sum, r) => sum + r.people, 0) || 1;

  return (
    <section className="card">
      <header>
        <h2>Area demographics</h2>
        <span className="pill navy">{district}</span>
      </header>

      <div className="body">
        {/* The headline is now the CATCHMENT, not the district.
            For two years this panel could only show a district total and warn
            people not to use it. The 400m population grid answers the question
            they were actually asking. */}
        {data.catchment && (
          <div className="figure-row" style={{ marginBottom: 14 }}>
            <div>
              <div className="tiny muted">People within {formatNumber(data.catchment.radiusMetres)}m</div>
              <div className="figure">{formatNumber(data.catchment.population)}</div>
              <div className="tiny muted">
                estimated from a 400m population grid
              </div>
            </div>
            <div>
              <div className="tiny muted">District population</div>
              <div className="figure muted">{formatNumber(total)}</div>
              <div className="tiny muted">context only — never a customer count</div>
            </div>
          </div>
        )}

        {/* Proportions transfer to a 500m radius. The district headcount does not. */}
        {/* Single span child: .notice is display:flex, so bare inline elements
            would each become a flex item and the sentence would fragment. */}
        <div className="notice info" style={{ marginBottom: 12 }}>
          <span>
            {data.catchment ? (
              <>
                The catchment above is an <strong>estimate</strong>: population is assumed even
                within each 400m cell. The age and ethnicity mix below is for the whole{" "}
                <strong>{district}</strong> district
                {total > 0 && <> ({formatNumber(total)} people)</>} — proportions carry across to
                your radius, the headcount does not.
              </>
            ) : (
              <>
                These are figures for the whole <strong>{district}</strong> district
                {total > 0 && <> ({formatNumber(total)} people)</>} — <strong>not</strong> a
                catchment estimate for your radius. Use the <em>mix</em> below; the headcount is
                context for the area, and multiplying it by anything would badly overstate your
                market.
              </>
            )}
          </span>
        </div>

        <div style={{ display: "grid", gap: 18, gridTemplateColumns: "1fr" }}>
          <div>
            <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 6 }}>
              AGE DISTRIBUTION
            </div>
            {ageRows.map((row) => (
              <div className="sens-row" key={row.label}>
                <span>{row.label}</span>
                <span className="sens-bar">
                  <span style={{ width: `${(row.people / maxAge) * 100}%` }} />
                </span>
                <span className="months">{formatPercent(row.people / ageTotal)}</span>
              </div>
            ))}
          </div>

          <div>
            <div className="tiny muted" style={{ fontWeight: 600, marginBottom: 6 }}>
              ETHNIC MIX
            </div>
            {ethRows.map((row) => (
              <div className="sens-row" key={row.label}>
                <span>{row.label}</span>
                <span className="sens-bar">
                  <span
                    style={{
                      width: `${(row.people / ethTotal) * 100}%`,
                      background: "var(--gold)",
                    }}
                  />
                </span>
                <span className="months">{formatPercent(row.people / ethTotal)}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="tiny muted" style={{ margin: "12px 0 0" }}>
          Department of Statistics Malaysia, {data.vintage} estimates (CC BY 4.0), reviewed{" "}
          {data.reviewed}. District boundaries from geoBoundaries (CC BY 3.0). District-level data
          is the finest resolution DOSM publishes openly.
        </p>
      </div>
    </section>
  );
}

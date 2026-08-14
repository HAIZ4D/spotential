import { Circle, G, Line, Polygon, Polyline, Rect, Svg, Text } from "@react-pdf/renderer";
import type { RadarSeries } from "./model.js";

/**
 * Report charts — Feature 4.
 *
 * Hand-emitted SVG rather than Recharts. Recharts needs a DOM and a measured
 * container; react-pdf gives neither, and these shapes are simple enough that
 * the geometry is shorter than the adapter would be. It is also deterministic,
 * which matters for a document someone may compare against another copy.
 *
 * Palette from CLAUDE.md. Gold is light, so it never carries white text.
 */

const NAVY = "#003087";
const GOLD = "#f2a900";
const GREEN = "#16a34a";
const RED = "#dc2626";
const LINE = "#e4e7ec";
const INK_2 = "#475467";
const INK_3 = "#98a2b3";
const SURFACE = "#f9fafb";

export const SERIES_COLOURS = [NAVY, GOLD, GREEN] as const;

// ------------------------------------------------------------------- radar

/** Vertex for axis `i` of `n`, at `radius`, starting at 12 o'clock. */
function vertex(i: number, n: number, radius: number, cx: number, cy: number) {
  const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
  return { x: cx + radius * Math.cos(angle), y: cy + radius * Math.sin(angle) };
}

const points = (pts: { x: number; y: number }[]) =>
  pts.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");

/**
 * The location profile, one polygon per location.
 *
 * A dimension with no data plots at 0 rather than being dropped. Dropping it
 * would silently reshape the polygon into a smaller regular one and hide the
 * gap; plotting zero makes the missing axis visible as a dent, which is the
 * honest picture and matches what the on-screen radar does.
 */
export function RadarChart({
  axes,
  series,
  /**
   * WIDER THAN TALL, deliberately.
   *
   * The chart used to be a 260pt square, which left the longest axis labels
   * running off both edges — "Rent sensitivity" rendered as "nt sensitivity".
   * The polygon needs a square, but the LABELS need horizontal room either
   * side of it, so the canvas spans the full content width and the geometry
   * is sized from the height.
   */
  width = 500,
  height = 250,
}: {
  axes: string[];
  series: RadarSeries[];
  width?: number;
  height?: number;
}) {
  if (axes.length < 3) return null;

  const cx = width / 2;
  const cy = height / 2 + 4;
  // From the height, so tall labels above and below still fit.
  const radius = height / 2 - 34;
  const n = axes.length;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Grid rings at 25/50/75/100. */}
      {[0.25, 0.5, 0.75, 1].map((ring) => (
        <Polygon
          key={ring}
          points={points(Array.from({ length: n }, (_, i) => vertex(i, n, radius * ring, cx, cy)))}
          stroke={LINE}
          strokeWidth={0.6}
          fill="none"
        />
      ))}

      {/* Ring values. Without a scale the polygon is a shape, not a reading. */}
      {[50, 100].map((value) => (
        <Text
          key={value}
          x={cx + 2}
          y={cy - (radius * value) / 100 + 7}
          style={{ fontSize: 5.5, fill: INK_3 }}
        >
          {String(value)}
        </Text>
      ))}

      {/* Spokes. */}
      <G>
        {axes.map((axis, i) => {
          const p = vertex(i, n, radius, cx, cy);
          return (
            <Line key={axis} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={LINE} strokeWidth={0.6} />
          );
        })}
      </G>

      {/* One filled polygon per location. */}
      {series.map((s, index) => {
        const colour = SERIES_COLOURS[index % SERIES_COLOURS.length] as string;
        return (
          <G key={s.label}>
            <Polygon
              points={points(
                s.values.map((value, i) =>
                  vertex(i, n, (radius * Math.max(0, Math.min(100, value))) / 100, cx, cy),
                ),
              )}
              stroke={colour}
              strokeWidth={1.4}
              fill={colour}
              fillOpacity={0.16}
            />
            {/* A hollow dot marks an axis with no data, so a zero that means
                "missing" is distinguishable from a zero that was measured. */}
            {s.missing.map((isMissing, i) =>
              isMissing ? (
                <Circle
                  key={`${s.label}-${i}`}
                  cx={vertex(i, n, 0, cx, cy).x}
                  cy={vertex(i, n, 0, cx, cy).y}
                  r={2.5}
                  stroke={colour}
                  strokeWidth={1}
                  fill="#ffffff"
                />
              ) : null,
            )}
          </G>
        );
      })}

      {/* Axis labels, nudged so they do not overlap the outer ring. */}
      {axes.map((axis, i) => {
        const p = vertex(i, n, radius + 16, cx, cy);
        const anchor = p.x < cx - 6 ? "end" : p.x > cx + 6 ? "start" : "middle";
        return (
          <Text
            key={axis}
            x={p.x}
            y={p.y + 3}
            style={{ fontSize: 7, fill: INK_2 }}
            textAnchor={anchor}
          >
            {axis}
          </Text>
        );
      })}
    </Svg>
  );
}

// -------------------------------------------------------------- cash curve

/**
 * The 24-month cash position.
 *
 * Zero is drawn as a hard rule and the area below it is what the report is
 * really about: the trough is the money an owner must have before opening.
 */
export function CashCurve({
  cash,
  width = 500,
  height = 150,
}: {
  cash: number[];
  width?: number;
  height?: number;
}) {
  if (cash.length < 2) return null;

  const padLeft = 46;
  const padBottom = 16;
  const padTop = 10;
  const plotW = width - padLeft - 10;
  const plotH = height - padBottom - padTop;

  const min = Math.min(...cash, 0);
  const max = Math.max(...cash, 0);
  const span = max - min || 1;

  const x = (i: number) => padLeft + (plotW * i) / (cash.length - 1);
  const y = (v: number) => padTop + plotH - (plotH * (v - min)) / span;

  const zeroY = y(0);
  const troughIndex = cash.indexOf(Math.min(...cash));
  const trough = cash[troughIndex] ?? 0;

  /** Thousands, because a cash axis in full ringgit does not fit. */
  const short = (v: number) => `${v < 0 ? "-" : ""}RM${Math.round(Math.abs(v) / 1000)}k`;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Shaded band below zero — the period being funded out of pocket. */}
      <Rect
        x={padLeft}
        y={zeroY}
        width={plotW}
        height={Math.max(0, padTop + plotH - zeroY)}
        fill="#fdeaea"
      />

      {/* A money axis, so the curve's height means something. */}
      {[max, min].map((value) => (
        <Text
          key={value}
          x={padLeft - 5}
          y={y(value) + 2.5}
          style={{ fontSize: 6.5, fill: INK_3 }}
          textAnchor="end"
        >
          {short(value)}
        </Text>
      ))}

      <Line x1={padLeft} y1={zeroY} x2={padLeft + plotW} y2={zeroY} stroke={INK_3} strokeWidth={0.8} />
      <Text x={padLeft - 5} y={zeroY + 2.5} style={{ fontSize: 6.5, fill: INK_3 }} textAnchor="end">
        0
      </Text>

      <Polyline
        points={points(cash.map((v, i) => ({ x: x(i), y: y(v) })))}
        stroke={NAVY}
        strokeWidth={1.6}
        fill="none"
      />

      {/* The trough, called out WITH ITS VALUE because it is the number people
          miss — the cash you must have before opening. */}
      <Circle cx={x(troughIndex)} cy={y(trough)} r={3} fill={RED} />
      <Text
        x={Math.min(x(troughIndex) + 6, padLeft + plotW - 40)}
        y={y(trough) + 11}
        style={{ fontSize: 7, fill: RED }}
      >
        {`${short(trough)} at M${troughIndex}`}
      </Text>

      {[0, 6, 12, 18, 24]
        .filter((m) => m < cash.length)
        .map((m) => (
          <Text key={m} x={x(m)} y={height - 4} style={{ fontSize: 7, fill: INK_3 }} textAnchor="middle">
            {`M${m}`}
          </Text>
        ))}
    </Svg>
  );
}

// --------------------------------------------------------------- bar chart

export interface DistanceBar {
  label: string;
  value: number;
  /**
   * Places returned the nearest 20 and stopped, so this ring was never looked
   * at. It is NOT a zero, and drawing it as one would be the report asserting
   * a measurement it does not have.
   */
  unsearched?: boolean;
}

/**
 * Competitor counts by distance ring.
 *
 * Three defects lived in the previous version of this chart and all three are
 * pinned by tests now:
 *
 *   1. The value label sat at `6 + plotH - h - 3`, which is 3 for the tallest
 *      bar — above the top edge of the SVG. The tallest number, the one people
 *      read first, was always clipped. Hence LABEL_BAND: explicit headroom
 *      that the bars are never allowed into.
 *   2. The rings are exclusive (0-250, 250-500, 500-1000) but were labelled
 *      "within 250m / 500m / 1000m", so the chart read "0 within 500m" beneath
 *      "20 within 250m". Labels are built by the model now and say `250-500m`.
 *   3. An unsearched ring rendered as a bar of height zero, indistinguishable
 *      from a measured zero. It is now hatched and labelled.
 */
export function BarChart({
  bars,
  width = 500,
  height = 150,
}: {
  bars: DistanceBar[];
  width?: number;
  height?: number;
}) {
  if (bars.length === 0) return null;

  /** Reserved for the value labels. Nothing is drawn into this band. */
  const LABEL_BAND = 14;
  const padTop = 6;
  const padBottom = 18;
  const padLeft = 26;

  const plotTop = padTop + LABEL_BAND;
  const plotH = height - padBottom - plotTop;
  const plotW = width - padLeft - 8;

  const measured = bars.filter((b) => !b.unsearched).map((b) => b.value);
  const max = Math.max(...measured, 1);

  const slot = plotW / bars.length;
  const barW = Math.min(84, slot * 0.62);
  const baseline = plotTop + plotH;

  /** Round gridlines rather than arbitrary fractions of the max. */
  const step = max <= 4 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : Math.ceil(max / 4 / 10) * 10;
  const ticks: number[] = [];
  for (let t = 0; t <= max; t += step) ticks.push(t);

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {/* Gridlines and the value axis, so a bar has something to be read against. */}
      {ticks.map((tick) => {
        const y = baseline - (plotH * tick) / max;
        return (
          <G key={`tick-${tick}`}>
            <Line x1={padLeft} y1={y} x2={padLeft + plotW} y2={y} stroke={LINE} strokeWidth={0.5} />
            <Text x={padLeft - 5} y={y + 2.5} style={{ fontSize: 6.5, fill: INK_3 }} textAnchor="end">
              {String(tick)}
            </Text>
          </G>
        );
      })}

      <Line
        x1={padLeft}
        y1={baseline}
        x2={padLeft + plotW}
        y2={baseline}
        stroke={INK_3}
        strokeWidth={0.9}
      />

      {bars.map((bar, i) => {
        const cx = padLeft + slot * i + slot / 2;
        const left = cx - barW / 2;

        if (bar.unsearched) {
          /**
           * Hatched, full height, no number. The reader should see that
           * something is unknown here rather than read a zero.
           */
          const stripes = Math.floor(plotH / 6);
          return (
            <G key={bar.label}>
              <Rect x={left} y={plotTop} width={barW} height={plotH} fill={SURFACE} />
              {Array.from({ length: stripes }, (_, k) => {
                const y = plotTop + k * 6;
                return (
                  <Line
                    key={k}
                    x1={left}
                    y1={y + 6}
                    x2={left + Math.min(barW, plotH - k * 6)}
                    y2={y + 6 - Math.min(barW, plotH - k * 6)}
                    stroke="#dfe3ea"
                    strokeWidth={0.8}
                  />
                );
              })}
              <Text
                x={cx}
                y={plotTop - 4}
                style={{ fontSize: 6.5, fill: INK_3 }}
                textAnchor="middle"
              >
                not searched
              </Text>
              <Text x={cx} y={height - 5} style={{ fontSize: 7, fill: INK_3 }} textAnchor="middle">
                {bar.label}
              </Text>
            </G>
          );
        }

        const h = (plotH * bar.value) / max;
        // A measured zero still gets a visible stub, so the category reads as
        // "we looked and found none" rather than as a missing bar.
        const drawn = bar.value === 0 ? 1.5 : h;

        return (
          <G key={bar.label}>
            <Rect
              x={left}
              y={baseline - drawn}
              width={barW}
              height={drawn}
              fill={bar.value === 0 ? INK_3 : NAVY}
            />
            <Text
              x={cx}
              y={baseline - drawn - 4}
              style={{ fontSize: 8, fill: INK_2 }}
              textAnchor="middle"
            >
              {String(bar.value)}
            </Text>
            <Text x={cx} y={height - 5} style={{ fontSize: 7, fill: INK_3 }} textAnchor="middle">
              {bar.label}
            </Text>
          </G>
        );
      })}
    </Svg>
  );
}

// -------------------------------------------------------- dimension bars

export interface DimensionBar {
  label: string;
  /** Null where the dimension could not be measured at all. */
  score: number | null;
  basis: string;
}

/** Bands match the on-screen score ring, so the two never disagree. */
function bandColour(score: number): string {
  if (score >= 70) return GREEN;
  if (score >= 40) return GOLD;
  return RED;
}

/**
 * Each score dimension as a horizontal bar.
 *
 * The radar shows the shape; this shows the ranking, which is what a reader
 * actually acts on. An unmeasured dimension gets an EMPTY TRACK and the word
 * "no data" rather than a zero-length bar — a zero-length bar and a zero score
 * look identical, and they mean opposite things.
 */
export function DimensionBars({
  dimensions,
  width = 500,
  rowHeight = 22,
}: {
  dimensions: DimensionBar[];
  width?: number;
  rowHeight?: number;
}) {
  if (dimensions.length === 0) return null;

  const labelW = 132;
  const valueW = 26;
  const trackX = labelW + 6;
  const trackW = width - trackX - valueW - 6;
  const height = dimensions.length * rowHeight + 4;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {dimensions.map((dimension, i) => {
        const y = i * rowHeight + 4;
        const mid = y + rowHeight / 2 - 4;
        const measured = dimension.score !== null;
        const fraction = measured ? Math.max(0, Math.min(100, dimension.score!)) / 100 : 0;

        return (
          <G key={dimension.label}>
            <Text x={0} y={mid + 3} style={{ fontSize: 7.5, fill: INK_2 }}>
              {dimension.label}
            </Text>

            <Rect x={trackX} y={mid - 4} width={trackW} height={9} fill={SURFACE} />

            {measured ? (
              <Rect
                x={trackX}
                y={mid - 4}
                width={Math.max(1.5, trackW * fraction)}
                height={9}
                fill={bandColour(dimension.score!)}
              />
            ) : (
              <Text
                x={trackX + 5}
                y={mid + 3}
                style={{ fontSize: 6.5, fill: INK_3 }}
              >
                no data - excluded from the score, not counted as zero
              </Text>
            )}

            <Text
              x={width}
              y={mid + 3}
              style={{ fontSize: 8, fill: measured ? INK_2 : INK_3 }}
              textAnchor="end"
            >
              {measured ? String(Math.round(dimension.score!)) : "-"}
            </Text>
          </G>
        );
      })}
    </Svg>
  );
}

// ------------------------------------------------------------- age profile

/**
 * Age bands in the district.
 *
 * Drawn rather than tabulated because the SHAPE is the finding — a district
 * skewed to 20-34 supports a different concept to one skewed to 50+, and that
 * reads instantly as a profile and slowly as a column of numbers.
 */
export function AgeChart({
  bands,
  width = 500,
  height = 96,
}: {
  bands: { label: string; value: number }[];
  width?: number;
  height?: number;
}) {
  if (bands.length === 0) return null;

  const padBottom = 14;
  const padTop = 4;
  const plotH = height - padBottom - padTop;
  const max = Math.max(...bands.map((b) => b.value), 1);
  const slot = width / bands.length;
  const barW = Math.min(26, slot * 0.7);
  const baseline = padTop + plotH;

  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <Line x1={0} y1={baseline} x2={width} y2={baseline} stroke={LINE} strokeWidth={0.6} />
      {bands.map((band, i) => {
        const h = Math.max(1, (plotH * band.value) / max);
        const cx = slot * i + slot / 2;
        return (
          <G key={band.label}>
            <Rect x={cx - barW / 2} y={baseline - h} width={barW} height={h} fill={NAVY} />
            <Text x={cx} y={height - 4} style={{ fontSize: 6, fill: INK_3 }} textAnchor="middle">
              {band.label}
            </Text>
          </G>
        );
      })}
    </Svg>
  );
}

/** Small colour key for the overlaid radar. */
export function Legend({ labels }: { labels: string[] }) {
  return (
    <Svg width={500} height={14} viewBox="0 0 500 14">
      {labels.map((label, i) => (
        <G key={label}>
          <Rect
            x={i * 150}
            y={3}
            width={8}
            height={8}
            fill={SERIES_COLOURS[i % SERIES_COLOURS.length] as string}
          />
          <Text x={i * 150 + 12} y={10} style={{ fontSize: 8, fill: INK_2 }}>
            {label}
          </Text>
        </G>
      ))}
    </Svg>
  );
}

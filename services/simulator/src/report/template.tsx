import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import { AgeChart, BarChart, CashCurve, DimensionBars, Legend, RadarChart } from "./charts.js";
import type { ReportModel, Table } from "./model.js";

/**
 * The PDF document — Feature 4.
 *
 * This is a REPORT, not a printout of the app. It carries a cover block, its
 * own layout, page numbers, and a disclosures page that cannot be scrolled
 * past. The PDF is the copy that gets forwarded to a landlord or a bank, so
 * every caveat that is on screen has to travel with it.
 *
 * react-pdf supports a flexbox subset; there is no grid and no cascade.
 */

/**
 * react-pdf's built-in Helvetica is WinAnsi-encoded and silently DROPS glyphs
 * it does not have, rather than substituting anything visible. En and em
 * dashes disappear, which turned "Working age (15–64)" into "(1564)" — a
 * number that reads as real and is wrong. Fold typographic punctuation to
 * ASCII instead of shipping a 200KB font for four characters.
 */
export function ascii(value: string): string {
  return value
    .replace(/[–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    .replace(/×/g, "x")
    .replace(/[≤]/g, "<=")
    .replace(/[≥]/g, ">=")
    .replace(/²/g, "2");
}

const NAVY = "#003087";
const GOLD = "#f2a900";
const INK = "#101828";
const INK_2 = "#475467";
const INK_3 = "#98a2b3";
const LINE = "#e4e7ec";
const SURFACE = "#f9fafb";

const s = StyleSheet.create({
  page: {
    paddingTop: 40,
    paddingBottom: 48,
    paddingHorizontal: 44,
    fontSize: 9,
    color: INK,
    fontFamily: "Helvetica",
  },

  brand: { fontSize: 8, letterSpacing: 1.2, color: NAVY, fontFamily: "Helvetica-Bold" },
  rule: { height: 2, backgroundColor: GOLD, width: 40, marginTop: 4, marginBottom: 14 },
  title: { fontSize: 19, fontFamily: "Helvetica-Bold", color: INK, lineHeight: 1.25 },
  subtitle: { fontSize: 9, color: INK_2, marginTop: 5 },

  figures: { flexDirection: "row", marginTop: 18, marginBottom: 4 },
  figure: {
    flex: 1,
    borderLeftWidth: 2,
    borderLeftColor: LINE,
    paddingLeft: 8,
    marginRight: 8,
  },
  figureLabel: { fontSize: 7, color: INK_2, textTransform: "uppercase", letterSpacing: 0.5 },
  figureValue: { fontSize: 15, fontFamily: "Helvetica-Bold", marginTop: 3 },
  figureNote: { fontSize: 7, color: INK_3, marginTop: 2 },

  section: { marginTop: 18 },
  sectionTitle: { fontSize: 11, fontFamily: "Helvetica-Bold", marginBottom: 7, color: NAVY },

  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4 },
  headRow: { flexDirection: "row", backgroundColor: SURFACE, paddingVertical: 5 },
  cell: { flex: 1, paddingHorizontal: 5, fontSize: 8 },
  headCell: { flex: 1, paddingHorizontal: 5, fontSize: 7, color: INK_2, fontFamily: "Helvetica-Bold" },
  emphasis: { fontFamily: "Helvetica-Bold" },
  tableNote: { fontSize: 7, color: INK_3, marginTop: 5, lineHeight: 1.4 },

  map: { marginTop: 14, borderWidth: 0.5, borderColor: LINE },
  mapNote: { fontSize: 7, color: INK_3, marginTop: 4 },

  disclosure: { fontSize: 8, color: INK_2, marginBottom: 7, lineHeight: 1.5 },

  /* The short version. Set apart so it reads as the conclusion, not a caption. */
  summary: {
    marginTop: 16,
    padding: 12,
    backgroundColor: SURFACE,
    borderLeftWidth: 3,
    borderLeftColor: NAVY,
  },
  summaryHead: {
    fontSize: 7,
    letterSpacing: 0.6,
    color: NAVY,
    fontFamily: "Helvetica-Bold",
    marginBottom: 5,
  },
  summaryLine: { fontSize: 8.5, color: INK, lineHeight: 1.5, marginBottom: 4 },

  /* Page headers after the cover, so a printed page is identifiable alone. */
  pageHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderBottomWidth: 0.5,
    borderBottomColor: LINE,
    paddingBottom: 6,
    marginBottom: 4,
  },
  pageTitle: { fontSize: 12, fontFamily: "Helvetica-Bold", color: NAVY },
  pageWhere: { fontSize: 7.5, color: INK_3 },
  lead: { fontSize: 8.5, color: INK_2, lineHeight: 1.5, marginTop: 10 },
  chartNote: { fontSize: 7, color: INK_3, marginTop: 4, lineHeight: 1.4 },

  footer: {
    position: "absolute",
    bottom: 24,
    left: 44,
    right: 44,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 0.5,
    borderTopColor: LINE,
    paddingTop: 6,
    fontSize: 7,
    color: INK_3,
  },
});

/**
 * First column carries the label and is usually the longest, so it gets extra
 * width. Everything else shares what is left.
 */
function columnFlex(index: number, count: number): number {
  if (count <= 2) return index === 0 ? 1 : 1;
  return index === 0 ? 1.6 : count > 4 && index === count - 1 ? 2.4 : 1;
}

function DataTable({ table, hideTitle = false }: { table: Table; hideTitle?: boolean }) {
  const columns = table.head.length;

  return (
    <View style={s.section} wrap={false}>
      {/* Suppressed where the page header already says it — a heading printed
          twice on one page reads as a mistake. */}
      {!hideTitle && <Text style={s.sectionTitle}>{ascii(table.title)}</Text>}

      <View style={s.headRow}>
        {table.head.map((head, i) => (
          <Text key={head + i} style={[s.headCell, { flex: columnFlex(i, columns) }]}>
            {ascii(head)}
          </Text>
        ))}
      </View>

      {table.rows.map((row, r) => (
        <View key={r} style={s.row}>
          {row.cells.map((value, i) => (
            <Text
              key={i}
              style={[
                s.cell,
                { flex: columnFlex(i, columns) },
                ...(row.emphasis ? [s.emphasis] : []),
              ]}
            >
              {ascii(value)}
            </Text>
          ))}
        </View>
      ))}

      {table.note ? <Text style={s.tableNote}>{ascii(table.note)}</Text> : null}
    </View>
  );
}

function Footer({ generatedOn }: { generatedOn: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>Spotential - generated {generatedOn} - not financial advice</Text>
      <Text
        render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`}
      />
    </View>
  );
}

/** A named table, or nothing. Sections vanish rather than printing dashes. */
function tableNamed(model: ReportModel, title: string): Table | null {
  return model.tables.find((t) => t.title === title) ?? null;
}

/** Every page after the cover names itself, so a printed sheet stands alone. */
function PageHead({ model, title }: { model: ReportModel; title: string }) {
  return (
    <View style={s.pageHead}>
      <Text style={s.pageTitle}>{ascii(title)}</Text>
      <Text style={s.pageWhere}>{ascii(model.title)}</Text>
    </View>
  );
}

export function ReportDocument({ model }: { model: ReportModel }) {
  const scoreTable = tableNamed(model, "Score breakdown");
  const competition = tableNamed(model, "Competition by distance");
  const rivals = tableNamed(model, "Who is already there");
  const catchment = tableNamed(model, "Catchment");
  const demographics = tableNamed(model, "Area demographics");
  const rent = tableNamed(model, "Rent and break-even") ?? tableNamed(model, "Rent");

  /**
   * Anything not claimed by a named page falls through to the detail page, so
   * a table added to the model can never silently vanish from the document.
   */
  const placed = new Set(
    [scoreTable, competition, rivals, catchment, demographics, rent]
      .filter((table): table is Table => table !== null)
      .map((table) => table.title),
  );
  const remaining = model.tables.filter((table) => !placed.has(table.title));

  const hasScorePage = model.dimensionBars.length > 0 || model.radarSeries.length > 0;
  const hasCompetitionPage = model.distanceBands.length > 0 || rivals !== null;
  const hasCatchmentPage =
    catchment !== null || demographics !== null || model.ageBands.length > 0;
  const hasDetailPage = rent !== null || remaining.length > 0 || model.cashCurve.length > 0;

  return (
    <Document
      title={ascii(model.title)}
      author="Spotential"
      subject={ascii(model.subtitle)}
      creator="Spotential"
    >
      {/* 1 - cover. The conclusion first, then the figures behind it. */}
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>SPOTENTIAL</Text>
        <View style={s.rule} />
        <Text style={s.title}>{ascii(model.title)}</Text>
        <Text style={s.subtitle}>{ascii(model.subtitle)}</Text>

        <View style={s.figures}>
          {model.figures.slice(0, 4).map((f) => (
            <View key={f.label} style={s.figure}>
              <Text style={s.figureLabel}>{ascii(f.label)}</Text>
              <Text style={s.figureValue}>{ascii(f.value)}</Text>
              {f.note ? <Text style={s.figureNote}>{ascii(f.note)}</Text> : null}
            </View>
          ))}
        </View>

        {model.summary.length > 0 && (
          <View style={s.summary}>
            <Text style={s.summaryHead}>THE SHORT VERSION</Text>
            {model.summary.map((line, i) => (
              <Text key={i} style={s.summaryLine}>
                {ascii(line)}
              </Text>
            ))}
          </View>
        )}

        {model.mapDataUri ? (
          <View>
            <Image src={model.mapDataUri} style={s.map} />
            {model.mapNote ? <Text style={s.mapNote}>{ascii(model.mapNote)}</Text> : null}
          </View>
        ) : model.mapNote ? (
          <Text style={s.mapNote}>{ascii(model.mapNote)}</Text>
        ) : null}

        <Footer generatedOn={model.generatedOn} />
      </Page>

      {/* 2 - how the score is built. */}
      {hasScorePage && (
        <Page size="A4" style={s.page}>
          <PageHead model={model} title="Score breakdown" />
          <Text style={s.lead}>
            Each dimension is scored independently and weighted by how far its signal can be
            trusted, not by how much it matters to a real business. Dimensions with no data are
            excluded and the rest renormalised, so a missing axis never counts as zero.
          </Text>

          {model.dimensionBars.length > 0 && (
            <View style={s.section} wrap={false}>
              <DimensionBars dimensions={model.dimensionBars} />
            </View>
          )}

          {model.radarSeries.length > 0 && (
            <View style={s.section} wrap={false}>
              <Text style={s.sectionTitle}>Profile shape</Text>
              <RadarChart axes={model.radarAxes.map(ascii)} series={model.radarSeries} />
              {model.radarSeries.length > 1 && (
                <Legend labels={model.radarSeries.map((series) => ascii(series.label))} />
              )}
              <Text style={s.chartNote}>
                A hollow dot at the centre marks a dimension with no data. It is plotted at zero so
                the gap stays visible, and excluded from the score rather than counted as zero.
              </Text>
            </View>
          )}

          {scoreTable && <DataTable table={scoreTable} hideTitle />}
          <Footer generatedOn={model.generatedOn} />
        </Page>
      )}

      {/* 3 - competition, and who it actually is. */}
      {hasCompetitionPage && (
        <Page size="A4" style={s.page}>
          <PageHead model={model} title="Competition" />

          {model.distanceBands.length > 0 && (
            <View style={s.section} wrap={false}>
              <Text style={s.sectionTitle}>Outlets by distance ring</Text>
              <BarChart bars={model.distanceBands} />
              <Text style={s.chartNote}>
                Rings are exclusive, not cumulative: each bar counts outlets between its inner and
                outer edge. A hatched ring was never searched - Google returns the nearest 20 and
                stops - so it is marked rather than drawn as zero. An unknown and an empty street
                are not the same finding.
              </Text>
            </View>
          )}

          {competition && <DataTable table={competition} />}
          {rivals && <DataTable table={rivals} />}
          <Footer generatedOn={model.generatedOn} />
        </Page>
      )}

      {/* 4 - who lives here. */}
      {hasCatchmentPage && (
        <Page size="A4" style={s.page}>
          <PageHead model={model} title="Catchment and demographics" />
          {catchment && <DataTable table={catchment} hideTitle />}

          {model.ageBands.length > 0 && (
            <View style={s.section} wrap={false}>
              <Text style={s.sectionTitle}>Age profile of the district</Text>
              <AgeChart bands={model.ageBands} />
              <Text style={s.chartNote}>
                The shape is the finding: a district weighted to 20-34 supports a different concept
                to one weighted to 50+. These are district proportions, not catchment counts.
              </Text>
            </View>
          )}

          {demographics && <DataTable table={demographics} />}
          <Footer generatedOn={model.generatedOn} />
        </Page>
      )}

      {/* 5 - rent, cash, and anything else the model produced. */}
      {hasDetailPage && (
        <Page size="A4" style={s.page}>
          <PageHead model={model} title={rent ? "Rent and break-even" : "Detail"} />

          {model.cashCurve.length > 0 && (
            <View style={s.section} wrap={false}>
              <Text style={s.sectionTitle}>Cash position over 24 months</Text>
              <CashCurve cash={model.cashCurve} />
              <Text style={s.chartNote}>
                The shaded band is the period funded out of pocket. The marked low point is the
                cash you must have available before opening.
              </Text>
            </View>
          )}

          {rent && <DataTable table={rent} hideTitle />}
          {remaining.map((table) => (
            <DataTable key={table.title} table={table} />
          ))}
          <Footer generatedOn={model.generatedOn} />
        </Page>
      )}

      {/* 6 - disclosures are a page, not a footnote. The PDF outlives the
          screen it came from, so the caveats have to be impossible to detach. */}
      <Page size="A4" style={s.page}>
        <Text style={s.brand}>SPOTENTIAL</Text>
        <View style={s.rule} />
        <Text style={s.title}>How to read this report</Text>

        <View style={s.section}>
          {model.disclosures.map((line, i) => (
            <Text key={i} style={s.disclosure}>
              - {ascii(line)}
            </Text>
          ))}
        </View>

        <Footer generatedOn={model.generatedOn} />
      </Page>
    </Document>
  );
}


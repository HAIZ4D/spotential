import type { DistrictId } from "../types.js";
import { distanceMetres, type LatLng } from "../geo.js";

/**
 * Commercial rent benchmarks — SPEC §5, extended by Feature 1e.
 *
 * A lookup table keyed by trading area, NOT a spatial query, and NOT DOSM's
 * administrative districts. Rent varies at the trading-area scale: Bangsar and
 * Cheras sit in the same federal territory and differ by more than 2x, so a
 * federal-territory median would be worse than useless. This is also exactly
 * why Cloud SQL + PostGIS is deferred — there is no radius search, no grid and
 * no geometry here, only a nearest-of-22 scan.
 *
 * WHY CURATED CONSTANTS AND NOT A FEED (researched 2026-08-13):
 *
 *   - NAPIC holds the authoritative transacted rents, including retail, at
 *     district level. There is no API and no CSV: access is a paid E-Data
 *     request, and the public output is a twice-yearly PDF.
 *   - DOSM runs a quarterly Rent Survey but publishes only a STATE-level CPI
 *     index. An index is not a price, and it covers residential, not retail.
 *   - Listing portals are granular but quote ASKING rents, forbid scraping in
 *     their terms, and are extremely noisy — one PJ development was found
 *     quoting RM5.50 to RM12.50 psf within a single building.
 *
 * So there is no automatable source of transacted Malaysian retail rent, and
 * these follow the house rule for reference values: versioned constants in
 * code, each with a source note and a review date. They are ESTIMATES, and
 * every consumer must surface them as inferred rather than measured.
 *
 * Coverage is deliberately partial. A pin outside every applicable radius
 * resolves to nothing, and the rent dimension goes unavailable — inventing a
 * national average to fill the axis would be the false precision this app
 * exists to avoid.
 */

export interface DistrictPreset {
  id: DistrictId;
  label: string;
  /** Median asking rent, RM per square foot per month, ground-floor F&B. */
  rentMedianPsf: number;
  /** Typical F&B unit size in the area, used with rentMedianPsf to seed monthlyRent. */
  typicalUnitSqft: number;
  /** Approximate centre of the trading area. */
  centre: LatLng;
  /**
   * How far this benchmark plausibly holds.
   *
   * Per-entry rather than one global threshold, because it genuinely differs:
   * KLCC rents collapse within a kilometre or two of the towers, while
   * Cyberjaya is uniform over a much wider area. A single 4km rule would
   * quietly apply KLCC pricing to Kampung Baru.
   */
  applicableRadiusMetres: number;
  source: string;
  reviewed: string;
}

const REVIEWED = "2026-08-13";
const SOURCE = "Researched estimate — ground-floor F&B asking rents";

export const DISTRICT_PRESETS: Record<DistrictId, DistrictPreset> = {
  // ---- Kuala Lumpur ----
  klcc: {
    id: "klcc",
    label: "KLCC, KL",
    rentMedianPsf: 15,
    typicalUnitSqft: 1000,
    centre: { lat: 3.1578, lng: 101.7123 },
    applicableRadiusMetres: 1500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  bukit_bintang: {
    id: "bukit_bintang",
    label: "Bukit Bintang, KL",
    rentMedianPsf: 14,
    typicalUnitSqft: 900,
    centre: { lat: 3.1468, lng: 101.7113 },
    applicableRadiusMetres: 1500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  /**
   * The older commercial core between KLCC, Bukit Bintang and KL Sentral.
   *
   * Added after the first pass left a hole here: a pin on Jalan Sultan Ismail
   * fell outside all three of its neighbours' radii and resolved to nothing,
   * despite sitting on one of KL's densest F&B strips. Priced below Bukit
   * Bintang and the towers — older stock, heavy footfall, weaker frontage.
   */
  jalan_tar_dang_wangi: {
    id: "jalan_tar_dang_wangi",
    label: "Jalan TAR / Dang Wangi, KL",
    rentMedianPsf: 8,
    typicalUnitSqft: 1000,
    centre: { lat: 3.155, lng: 101.695 },
    applicableRadiusMetres: 2000,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  kl_sentral: {
    id: "kl_sentral",
    label: "KL Sentral, KL",
    rentMedianPsf: 12,
    typicalUnitSqft: 900,
    centre: { lat: 3.1339, lng: 101.6869 },
    applicableRadiusMetres: 1500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  bangsar: {
    id: "bangsar",
    label: "Bangsar, KL",
    rentMedianPsf: 11,
    typicalUnitSqft: 1100,
    centre: { lat: 3.13, lng: 101.67 },
    applicableRadiusMetres: 2000,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  mont_kiara: {
    id: "mont_kiara",
    label: "Mont Kiara, KL",
    rentMedianPsf: 10,
    typicalUnitSqft: 1200,
    centre: { lat: 3.1725, lng: 101.6509 },
    applicableRadiusMetres: 2000,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  sri_hartamas: {
    id: "sri_hartamas",
    label: "Sri Hartamas, KL",
    rentMedianPsf: 9.5,
    typicalUnitSqft: 1100,
    centre: { lat: 3.1642, lng: 101.6516 },
    applicableRadiusMetres: 1500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  ttdi: {
    id: "ttdi",
    label: "TTDI, KL",
    rentMedianPsf: 9,
    typicalUnitSqft: 1100,
    centre: { lat: 3.1478, lng: 101.63 },
    applicableRadiusMetres: 2000,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  sri_petaling: {
    id: "sri_petaling",
    label: "Sri Petaling, KL",
    rentMedianPsf: 6.5,
    typicalUnitSqft: 1200,
    centre: { lat: 3.068, lng: 101.689 },
    applicableRadiusMetres: 2500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  cheras: {
    id: "cheras",
    label: "Cheras, KL",
    rentMedianPsf: 6,
    typicalUnitSqft: 1000,
    centre: { lat: 3.105, lng: 101.74 },
    applicableRadiusMetres: 3000,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  wangsa_maju: {
    id: "wangsa_maju",
    label: "Wangsa Maju, KL",
    rentMedianPsf: 5.5,
    typicalUnitSqft: 1100,
    centre: { lat: 3.205, lng: 101.737 },
    applicableRadiusMetres: 2500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  setapak: {
    id: "setapak",
    label: "Setapak, KL",
    rentMedianPsf: 5,
    typicalUnitSqft: 1100,
    centre: { lat: 3.2018, lng: 101.7212 },
    applicableRadiusMetres: 2500,
    source: SOURCE,
    reviewed: REVIEWED,
  },

  // ---- Selangor ----
  damansara_uptown: {
    id: "damansara_uptown",
    label: "Damansara Uptown, PJ",
    rentMedianPsf: 9,
    typicalUnitSqft: 1100,
    centre: { lat: 3.1345, lng: 101.6215 },
    applicableRadiusMetres: 1500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  ss2_pj: {
    id: "ss2_pj",
    label: "SS2, Petaling Jaya",
    rentMedianPsf: 8.5,
    typicalUnitSqft: 1100,
    centre: { lat: 3.116, lng: 101.623 },
    applicableRadiusMetres: 1500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  ss15_subang: {
    id: "ss15_subang",
    label: "SS15 Subang Jaya",
    rentMedianPsf: 8,
    typicalUnitSqft: 900,
    centre: { lat: 3.0745, lng: 101.586 },
    applicableRadiusMetres: 1500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  pj_section_14: {
    id: "pj_section_14",
    label: "PJ Section 14",
    rentMedianPsf: 7.5,
    typicalUnitSqft: 1200,
    centre: { lat: 3.105, lng: 101.642 },
    applicableRadiusMetres: 2000,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  kota_damansara: {
    id: "kota_damansara",
    label: "Kota Damansara, PJ",
    rentMedianPsf: 7,
    typicalUnitSqft: 1200,
    centre: { lat: 3.152, lng: 101.592 },
    applicableRadiusMetres: 2500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  puchong_bandar_puteri: {
    id: "puchong_bandar_puteri",
    label: "Bandar Puteri Puchong",
    rentMedianPsf: 6,
    typicalUnitSqft: 1200,
    centre: { lat: 3.03, lng: 101.618 },
    applicableRadiusMetres: 2500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  shah_alam_seksyen_13: {
    id: "shah_alam_seksyen_13",
    label: "Shah Alam Seksyen 13",
    rentMedianPsf: 5.5,
    typicalUnitSqft: 1300,
    centre: { lat: 3.0733, lng: 101.5185 },
    applicableRadiusMetres: 3000,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  cyberjaya: {
    id: "cyberjaya",
    label: "Cyberjaya",
    rentMedianPsf: 5,
    typicalUnitSqft: 1200,
    // Low-density and uniformly priced, so the benchmark travels further than
    // it would in a dense core.
    centre: { lat: 2.9213, lng: 101.6559 },
    applicableRadiusMetres: 4000,
    source: SOURCE,
    reviewed: REVIEWED,
  },

  // ---- Penang ----
  georgetown: {
    id: "georgetown",
    label: "George Town, Penang",
    rentMedianPsf: 7,
    typicalUnitSqft: 1000,
    centre: { lat: 5.4141, lng: 100.3288 },
    applicableRadiusMetres: 2500,
    source: SOURCE,
    reviewed: REVIEWED,
  },
  bayan_lepas: {
    id: "bayan_lepas",
    label: "Bayan Lepas, Penang",
    rentMedianPsf: 5.5,
    typicalUnitSqft: 1200,
    centre: { lat: 5.2945, lng: 100.265 },
    applicableRadiusMetres: 3500,
    source: SOURCE,
    reviewed: REVIEWED,
  },

  // ---- Johor ----
  jb_city_centre: {
    id: "jb_city_centre",
    label: "Johor Bahru city centre",
    rentMedianPsf: 6.5,
    typicalUnitSqft: 1100,
    centre: { lat: 1.4655, lng: 103.7578 },
    applicableRadiusMetres: 3000,
    source: SOURCE,
    reviewed: REVIEWED,
  },
};

export function listDistricts(): DistrictPreset[] {
  return Object.values(DISTRICT_PRESETS);
}

export interface NearestDistrict {
  district: DistrictPreset;
  distanceMetres: number;
}

/**
 * The benchmark that applies at a point, or null if none does.
 *
 * Null is a real answer, not a failure. Coverage is 22 trading areas out of a
 * whole country, and the honest response to a pin in Kuantan is an empty rent
 * axis rather than a number borrowed from somewhere it does not apply.
 *
 * Ties are broken by declaration order, which is stable because the table is a
 * literal — two benchmarks at exactly equal distance always resolve the same
 * way rather than depending on iteration luck.
 */
export function nearestDistrict(point: LatLng): NearestDistrict | null {
  let best: NearestDistrict | null = null;

  for (const district of listDistricts()) {
    const metres = distanceMetres(point, district.centre);
    if (metres > district.applicableRadiusMetres) continue;
    if (best === null || metres < best.distanceMetres) {
      best = { district, distanceMetres: metres };
    }
  }

  return best;
}

/** Seed monthly rent from the district median and the unit size actually being taken. */
export function seedMonthlyRent(district: DistrictId, unitSqft?: number): number {
  const d = DISTRICT_PRESETS[district];
  const sqft = unitSqft ?? d.typicalUnitSqft;
  return Math.round(d.rentMedianPsf * sqft);
}

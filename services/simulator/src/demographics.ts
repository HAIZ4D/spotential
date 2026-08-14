import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  boundingBoxOf,
  inBoundingBox,
  pointInPolygon,
  type BoundingBox,
  type LatLng,
  type Ring,
} from "@spotential/sim-engine";

/**
 * District demographics — Feature 1c.
 *
 * Costs nothing per call: no Places, no Gemini, no external anything. Two
 * static files are loaded once per instance and every lookup after that is
 * pure computation.
 *
 * Google cannot help here. Malaysia returns no administrative_area_level_2
 * from reverse geocoding — only state — so the district has to come from
 * point-in-polygon against boundary data.
 */

export interface DistrictDemographics {
  district: string;
  state: string;
  /** People, already converted from DOSM's thousands. */
  total: number;
  age: Record<string, number>;
  ethnicity: Record<string, number>;
}

export interface DemographicsResult {
  matched: boolean;
  /** "district" when a polygon contained the point, "none" when nothing did. */
  resolution: "district" | "none";
  demographics: DistrictDemographics | null;
  vintage: string;
  reviewed: string;
  sourceNote: string;
}

interface PopulationFile {
  $vintage: string;
  $reviewed: string;
  $licence: string;
  districts: Record<string, DistrictDemographics>;
}

interface BoundaryFeature {
  properties: { name: string; district: string | null };
  geometry:
    | { type: "Polygon"; coordinates: Ring[] }
    | { type: "MultiPolygon"; coordinates: Ring[][] };
}

/** Pre-computed once at load: bbox first, exact test only on candidates. */
interface IndexedDistrict {
  district: string;
  polygons: Ring[][];
  bbox: BoundingBox;
}

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "data");

export class DemographicsLookup {
  private constructor(
    private readonly population: PopulationFile,
    private readonly index: IndexedDistrict[],
  ) {}

  /**
   * Data files are read from disk rather than bundled: the boundaries are
   * ~1 MB and inlining them would bloat server.js for something parsed once.
   */
  static async load(dataDir = DATA_DIR): Promise<DemographicsLookup> {
    const [populationRaw, boundariesRaw] = await Promise.all([
      readFile(join(dataDir, "population-districts.json"), "utf8"),
      readFile(join(dataDir, "district-boundaries.geojson"), "utf8"),
    ]);

    const population = JSON.parse(populationRaw) as PopulationFile;
    const boundaries = JSON.parse(boundariesRaw) as { features: BoundaryFeature[] };

    const index: IndexedDistrict[] = [];
    for (const feature of boundaries.features) {
      if (!feature.properties.district) continue;

      const polygons =
        feature.geometry.type === "Polygon"
          ? [feature.geometry.coordinates]
          : feature.geometry.coordinates;

      index.push({
        district: feature.properties.district,
        polygons,
        bbox: boundingBoxOf(polygons.flat()),
      });
    }

    return new DemographicsLookup(population, index);
  }

  get vintage(): string {
    return this.population.$vintage;
  }

  get districtCount(): number {
    return Object.keys(this.population.districts).length;
  }

  find(point: LatLng): DemographicsResult {
    const base = {
      vintage: this.population.$vintage,
      reviewed: this.population.$reviewed,
      sourceNote: this.population.$licence,
    };

    for (const candidate of this.index) {
      // Bounding box first: rejects ~158 of 159 districts with four
      // comparisons before any ray casting happens.
      if (!inBoundingBox(point, candidate.bbox)) continue;
      if (!candidate.polygons.some((rings) => pointInPolygon(point, rings))) continue;

      const demographics = this.population.districts[candidate.district];
      if (!demographics) continue;

      return { matched: true, resolution: "district", demographics, ...base };
    }

    // Offshore, or outside Malaysia. Saying "no match" is the honest answer;
    // guessing the nearest district would invent a catchment.
    return { matched: false, resolution: "none", demographics: null, ...base };
  }
}

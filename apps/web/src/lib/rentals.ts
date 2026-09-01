import photo_jalan_p_ramlee_pilates from "../../img/rentals/jalan-p-ramlee-pilates.webp";
import photo_four_seasons_shoppes from "../../img/rentals/four-seasons-shoppes.webp";
import photo_klcc_large_floor_plate from "../../img/rentals/klcc-large-floor-plate.webp";
import photo_jalan_ampang_intercontinental from "../../img/rentals/jalan-ampang-intercontinental.webp";
import photo_trx_pavilion_24000 from "../../img/rentals/trx-pavilion-24000.webp";
import photo_trx_pavilion_14500 from "../../img/rentals/trx-pavilion-14500.webp";
import photo_klcc_rooftop_bar from "../../img/rentals/klcc-rooftop-bar.webp";
import photo_bukit_bintang_wellness from "../../img/rentals/bukit-bintang-wellness.webp";
import photo_jalan_ipoh_lrt_balcony from "../../img/rentals/jalan-ipoh-lrt-balcony.webp";
import photo_jalan_raja_laut_shop_office from "../../img/rentals/jalan-raja-laut-shop-office.webp";
import photo_bandar_menjalara_ground_floor from "../../img/rentals/bandar-menjalara-ground-floor.webp";
import photo_desa_jaya_kepong from "../../img/rentals/desa-jaya-kepong.webp";
import photo_pandan_jaya_shop_lot from "../../img/rentals/pandan-jaya-shop-lot.webp";
import photo_taman_permata_setapak from "../../img/rentals/taman-permata-setapak.webp";

/**
 * A curated shortlist of KL commercial units for rent.
 *
 * WHY THIS EXISTS AS A FILE. PropertyGuru serves this app a 403 from Cloud
 * Run, and iProperty's terms forbid automated access in as many words, so
 * there is no live source of listings we are entitled to use. These fourteen
 * were compiled by hand from property portals on 1 September 2026 and are
 * versioned here exactly like the rent benchmarks and the event catalogue:
 * constants with a source note and a date, not a feed.
 *
 * THEY GO STALE, and the UI says so with the compile date on every view. A
 * benchmark holds for a year; a listing is gone in weeks. That is the honest
 * trade for having real units with real photographs.
 *
 * THEY DO NOT REACH THE SCORE. This module lives in the web app rather than
 * the engine, and that is deliberate rather than incidental: the scoring code
 * cannot import it, so an asking price can never leak into a dimension. The
 * rent axis keeps using the dated, sourced benchmarks in `presets/districts`.
 *
 * Each `note` is the compiler's own read of the listing, kept verbatim,
 * including the sceptical ones. "The billboard says 12,000 sqft but the
 * listing says 10,000" is the single most useful sentence in the report and
 * exactly the kind of thing a portal will never tell you.
 */

import type { LatLng } from "@spotential/sim-engine";

export interface CuratedRental {
  id: string;
  title: string;
  /** Trading area, used to group and to match a pin. */
  area: string;
  /** The location string exactly as the listing gave it. */
  addressLine: string | null;
  monthlyRent: number;
  sizeSqft: number;
  /** Rent per square foot. Cross-checked against rent / size on import. */
  psf: number;
  transit: string | null;
  features: string | null;
  /** Who advertised it. Contact context, not an endorsement. */
  agent: string | null;
  posted: string | null;
  note: string | null;
  point: LatLng;
  photo: string;
}

/** When this shortlist was compiled. Shown wherever the listings are. */
export const RENTALS_COMPILED = "1 September 2026";
export const RENTALS_SOURCE = "Compiled by hand from Malaysian property portals";

export const CURATED_RENTALS: CuratedRental[] = [
  {
    id: "jalan-p-ramlee-pilates",
    title: "Pilates / F&B Retail Unit - Jalan P. Ramlee",
    area: "KLCC",
    addressLine: "KLCC, KL City Centre",
    monthlyRent: 21000,
    sizeSqft: 2460,
    psf: 8.54,
    transit: "LRT - 4 min (310 m) from KLCC",
    features: null,
    agent: "Janie Wai",
    posted: "26 Aug 2026",
    note: "Marketed as a KLCC retail space in the Jalan P. Ramlee F&B hub. Photos show a fitted-out pilates studio, so the unit is likely handed over with some existing fit-out.",
    point: { lat: 3.1554, lng: 101.7095 },
    photo: photo_jalan_p_ramlee_pilates,
  },
  {
    id: "four-seasons-shoppes",
    title: "The Shoppes @ Four Seasons Place",
    area: "KLCC",
    addressLine: "KLCC, KL City Centre",
    monthlyRent: 60000,
    sizeSqft: 2000,
    psf: 30.0,
    transit: "MRT - 4 min (330 m) from Persiaran KLCC",
    features: "2 bathrooms",
    agent: "Winnie Chow",
    posted: "26 Aug 2026",
    note: "THE MOST EXPENSIVE PER SQ FT in this whole list - RM 30.00 psf. That is prime mall frontage pricing, next to Decathlon in a luxury mall attached to a 5-star hotel.",
    point: { lat: 3.157, lng: 101.7135 },
    photo: photo_four_seasons_shoppes,
  },
  {
    id: "klcc-large-floor-plate",
    title: "KLCC Commercial Space (large floor plate)",
    area: "KLCC",
    addressLine: "KLCC, KL City Centre",
    monthlyRent: 70000,
    sizeSqft: 10000,
    psf: 7.0,
    transit: "MRT - 4 min (330 m) from Persiaran KLCC",
    features: "2 bathrooms · 10 parking bays",
    agent: "Eddie Chai",
    posted: "21 Aug 2026",
    note: "WATCH OUT: the advertising billboard in the photo says 12,000 sqft, but the listing data says 10,000 sqft. Confirm the actual lettable area before you negotiate.",
    point: { lat: 3.1578, lng: 101.7123 },
    photo: photo_klcc_large_floor_plate,
  },
  {
    id: "jalan-ampang-intercontinental",
    title: "Jalan Ampang - InterContinental KL block",
    area: "Jalan Ampang",
    addressLine: "Jalan Ampang, KLCC, KL City Centre",
    monthlyRent: 28440,
    sizeSqft: 2370,
    psf: 12.0,
    transit: "LRT - 4 min (340 m) from Ampang Park",
    features: "2 bathrooms",
    agent: "STEVE KI",
    posted: "10 Aug 2026",
    note: "Hotel-attached retail on Jalan Ampang. Second-highest psf on the list after Four Seasons - you pay for the address and the hotel footfall.",
    point: { lat: 3.1595, lng: 101.7175 },
    photo: photo_jalan_ampang_intercontinental,
  },
  {
    id: "trx-pavilion-24000",
    title: "TRX / Pavilion - Jalan Tun Razak (24,000 sqft)",
    area: "TRX",
    addressLine: "Jalan Tun Razak, TRX Pavilion, KL City Centre",
    monthlyRent: 180000,
    sizeSqft: 24000,
    psf: 7.5,
    transit: "TRX precinct",
    features: "8 bathrooms",
    agent: "Kelvin Guee",
    posted: "6 Aug 2026",
    note: "BIGGEST AND MOST EXPENSIVE unit in the list. Bare shell / raw concrete condition, so budget a large fit-out cost on top of rent.",
    point: { lat: 3.142, lng: 101.719 },
    photo: photo_trx_pavilion_24000,
  },
  {
    id: "trx-pavilion-14500",
    title: "TRX / Pavilion - Jalan Tun Razak (14,500 sqft)",
    area: "TRX",
    addressLine: "Jalan Tun Razak, TRX, Pavilion, KL City Centre",
    monthlyRent: 108750,
    sizeSqft: 14500,
    psf: 7.5,
    transit: "TRX precinct",
    features: "8 bathrooms",
    agent: "Kelvin Guee",
    posted: "6 Aug 2026",
    note: "Same agent, same building and same RM 7.50 psf as listing #5 - this is simply a smaller floor plate. High floor with a full-height window line and city views.",
    point: { lat: 3.142, lng: 101.719 },
    photo: photo_trx_pavilion_14500,
  },
  {
    id: "klcc-rooftop-bar",
    title: "Rooftop F&B / Bar - Twin Towers view",
    area: "KLCC",
    addressLine: "KLCC, KL City Centre",
    monthlyRent: 55000,
    sizeSqft: 6950,
    psf: 7.91,
    transit: "LRT - 4 min (310 m) from KLCC",
    features: "4 bathrooms · 3 parking bays",
    agent: "Rex Tham",
    posted: "5 Aug 2026",
    note: "Already fitted out as a rooftop bar/lounge with a direct Petronas Twin Towers view. The best ready-to-trade F&B option here - very little build-out needed.",
    point: { lat: 3.156, lng: 101.711 },
    photo: photo_klcc_rooftop_bar,
  },
  {
    id: "bukit-bintang-wellness",
    title: "Walk to Pavilion - Gym / Wellness space",
    area: "Bukit Bintang",
    addressLine: "Bukit Bintang, KL City Centre",
    monthlyRent: 47160,
    sizeSqft: 8575,
    psf: 5.5,
    transit: "Walking distance to Pavilion & KLCC",
    features: "Splittable: 2,000 - 12,300 sqft",
    agent: "Elaine Chong (Elle)",
    posted: "26 Aug 2026",
    note: "FLEXIBLE SIZE. The advertiser will split from 2,000 sqft up to 12,300 sqft, so the RM 47,160 figure is only for the 8,575 sqft configuration. Good psf for a Bukit Bintang address.",
    point: { lat: 3.1468, lng: 101.7113 },
    photo: photo_bukit_bintang_wellness,
  },
  {
    id: "jalan-ipoh-lrt-balcony",
    title: "LRT-linked unit with balcony (KLCC & TRX view)",
    area: "TRX / Jalan Tun Razak",
    addressLine: "Jalan Ipoh / Sentul / Jalan Tun Razak, KL City Centre",
    monthlyRent: 26800,
    sizeSqft: 7653,
    psf: 3.5,
    transit: "7 min (550 m) from Tun Razak Exchange",
    features: "Private balcony",
    agent: "Elaine Chong (Elle)",
    posted: "29 Aug 2026",
    note: "BEST VALUE IN THE CITY-CENTRE GROUP - RM 3.50 psf for 7,653 sqft with a balcony and skyline views. Trade-off: it is bare and unfinished, so fit-out cost is on you.",
    point: { lat: 3.1425, lng: 101.718 },
    photo: photo_jalan_ipoh_lrt_balcony,
  },
  {
    id: "jalan-raja-laut-shop-office",
    title: "Jalan Raja Laut Shop Office (1st & 2nd floor)",
    area: "Jalan Raja Laut",
    addressLine: "No. 46 & 48, Jalan Raja Laut / Jalan Sultan Ismail, 50350 KL",
    monthlyRent: 11000,
    sizeSqft: 6800,
    psf: 1.62,
    transit: "Near Sunway Putra Mall & Hospital Kuala Lumpur",
    features: "Residence + business use allowed",
    agent: "Choo Heng Leong & Co. Sdn Bhd",
    posted: "Posted 3 hours ago",
    note: "UPFRONT COST IS PUBLISHED: RM 33,000 security deposit (3 months) + RM 11,000 utilities deposit + RM 11,000 advance rent = RM 55,000 total to move in. Price is stated as negotiable.",
    point: { lat: 3.166, lng: 101.6935 },
    photo: photo_jalan_raja_laut_shop_office,
  },
  {
    id: "bandar-menjalara-ground-floor",
    title: "Menjalara Ground Floor Shop Office",
    area: "Bandar Menjalara",
    addressLine: "Bandar Menjalara, Kuala Lumpur",
    monthlyRent: 7500,
    sizeSqft: 1800,
    psf: 4.17,
    transit: null,
    features: "Parking available",
    agent: "Yi Hao (private advertiser)",
    posted: "Posted 2 days ago",
    note: "Rental deposit stated as RM 28,500 - that is nearly 4 months of rent up front, unusually heavy for a suburban shop lot. Ask why before committing.",
    point: { lat: 3.193, lng: 101.632 },
    photo: photo_bandar_menjalara_ground_floor,
  },
  {
    id: "desa-jaya-kepong",
    title: "Shop Office (1st Floor) @ Desa Jaya Kepong",
    area: "Kepong",
    addressLine: "Kepong, Kuala Lumpur",
    monthlyRent: 3000,
    sizeSqft: 2000,
    psf: 1.5,
    transit: "3 min to MRT · 3 min to Kepong Sentral KTM · 10 min to AEON",
    features: "Access via MRR2, LDP, DUKE, NKVE",
    agent: "Kevin Ong - E-Trend Realty Sdn Bhd",
    posted: "Posted 2 days ago",
    note: "LOWEST PSF IN THE ENTIRE LIST at RM 1.50. Already renovated with partitioned rooms, a pantry and a bathroom, plus double rail access. Strongest value-for-money pick overall.",
    point: { lat: 3.205, lng: 101.636 },
    photo: photo_desa_jaya_kepong,
  },
  {
    id: "pandan-jaya-shop-lot",
    title: "Pandan Jaya Shop Lot Office (2nd floor)",
    area: "Pandan Jaya",
    addressLine: "Pandan Jaya, Kuala Lumpur",
    monthlyRent: 1300,
    sizeSqft: 800,
    psf: 1.63,
    transit: null,
    features: "Partly furnished · 2 air-cond units · 2 desks + chairs · carpeted",
    agent: "Kim - kimproperties",
    posted: "Posted 4 days ago",
    note: "CHEAPEST UNIT ON THE LIST at RM 1,300/month. Move-in condition and negotiable. Ideal for a small office or startup, not for retail - it is on the second floor with no street frontage.",
    point: { lat: 3.131, lng: 101.742 },
    photo: photo_pandan_jaya_shop_lot,
  },
  {
    id: "taman-permata-setapak",
    title: "Taman Permata Corner Shop-Office",
    area: "Setapak",
    addressLine: "Setapak, Kuala Lumpur",
    monthlyRent: 26000,
    sizeSqft: 4020,
    psf: 6.47,
    transit: null,
    features: "Corner lot",
    agent: "Andy Hui - IQI Realty Sdn. Bhd.",
    posted: "Posted 5 days ago",
    note: "EXPENSIVE FOR SETAPAK. RM 6.47 psf is close to TRX and KLCC pricing (RM 7.00-7.50) but in a much older suburban row of shops. The listing gives almost no detail - verify hard.",
    point: { lat: 3.21, lng: 101.725 },
    photo: photo_taman_permata_setapak,
  },
];

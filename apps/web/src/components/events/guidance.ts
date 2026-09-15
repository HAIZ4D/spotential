import {
  CATEGORY_PRESETS,
  entryPrice,
  eventDays,
  sectorOf,
  type BusinessCategory,
  type EventListing,
} from "@spotential/sim-engine";

/**
 * What a vendor needs to know before they commit, derived from the listing.
 *
 * THE ATTRIBUTION IS THE WHOLE DESIGN HERE, and it is the reason this is a
 * module rather than a paragraph in a component.
 *
 * An event page prints two kinds of rule and they must never blur together.
 * `vendorRequirements` is the ORGANIZER'S: a commitment they published and are
 * bound by, quoted verbatim. Everything in this file is OURS: ordinary advice
 * about trading a booth in Malaysia, which nobody has agreed to and which the
 * organizer has never seen. Printing the second in the voice of the first
 * would put words in an organizer's mouth on a page a vendor is using to
 * decide whether to pay them, which is the one thing this product has never
 * done. So the UI heads this block as Spotential's own and a test asserts the
 * line is there.
 *
 * DERIVED, NEVER GENERATED. Every item below is switched on by something in
 * the listing: the hours, the dates, the requirements text, the slot counts,
 * whether a price was published, and the category the reader picked. That is
 * the same call the event cards, the section ledes and the PDF cover already
 * make, and for the same three reasons: it costs nothing, it cannot fail, and
 * it cannot contradict a figure sitting an inch away from it.
 *
 * A STATIC LIST WOULD HAVE BEEN WORSE THAN NOTHING. "Bring your own lighting"
 * is useful at a bazaar that runs to 11pm and noise at a 9am-to-2pm morning
 * market; printing both to everybody teaches people to skip the section, which
 * is how a page ends up with advice nobody reads.
 */

export interface GuidanceItem {
  /** Short enough to scan in a two-column list. */
  title: string;
  /** One sentence. Why it matters, not a restatement of the title. */
  detail: string;
}

export interface EventGuidance {
  /** Questions to put to the organizer before paying anything. */
  askFirst: GuidanceItem[];
  doThis: GuidanceItem[];
  notThis: GuidanceItem[];
  /** What the derivation concluded about the venue, shown as context chips. */
  traits: string[];
}

/** "17:00 - 23:00" -> 23. Null when the string is not a range we understand. */
export function closingHour(dailyHours: string): number | null {
  const matches = dailyHours.match(/(\d{1,2})[:.](\d{2})/g);
  const last = matches?.at(-1);
  if (!last) return null;
  const hour = Number(last.split(/[:.]/)[0]);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

/** And the opening hour, which is what makes a 7am load-in worth mentioning. */
export function openingHour(dailyHours: string): number | null {
  const first = dailyHours.match(/(\d{1,2})[:.](\d{2})/)?.[0];
  if (!first) return null;
  const hour = Number(first.split(/[:.]/)[0]);
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null;
}

/**
 * Outdoors, inferred from what the organizer requires rather than asserted.
 *
 * There is no `indoor` field on a listing and inventing one would mean
 * guessing. A requirement to bring your own canopy or tent is the organizer
 * saying outdoors in the only place the data says anything about it, so that
 * is what this reads. When nothing says, nothing is claimed.
 */
export function looksOutdoor(event: EventListing): boolean | null {
  const text = `${event.vendorRequirements.join(" ")} ${event.venueName}`.toLowerCase();
  /**
   * `dataran` and `taman` are the two that matter and were missing: Dataran
   * Putrajaya is a public square, and the listing read as unknown, so a
   * genuinely outdoor event got no wet-weather guidance at all. Checked before
   * the indoor words on purpose, since "OSK Mori Park Sales Gallery" contains
   * both and the canopy requirement settles it.
   */
  if (/canopy|tent|khemah|outdoor|padang|dataran|taman|field|car park|carpark/.test(text)) {
    return true;
  }
  if (/mall|galleria|hall|centre|center|atrium|arena|gallery|indoor/.test(text)) return false;
  return null;
}

export function buildGuidance(
  event: EventListing,
  category: BusinessCategory,
): EventGuidance {
  const askFirst: GuidanceItem[] = [];
  const doThis: GuidanceItem[] = [];
  const notThis: GuidanceItem[] = [];
  const traits: string[] = [];

  const days = eventDays(event);
  const price = entryPrice(event);
  const outdoor = looksOutdoor(event);
  const closes = closingHour(event.dailyHours);
  const opens = openingHour(event.dailyHours);
  const sector = sectorOf(category);
  const taken = event.totalSlots - event.availableSlots;
  const nearlyFull = event.totalSlots > 0 && event.availableSlots / event.totalSlots <= 0.25;

  /* ---------------- Ask first ---------------- */

  // The binding constraint when it is missing. Nothing else on the page can be
  // worked out until this is answered, which is why it leads.
  if (price === null) {
    askFirst.push({
      title: "What does a booth actually cost?",
      detail:
        "No price is published for this event, so every cost figure on this page is waiting on it. Ask for the fee, what it includes, and whether there is a deposit.",
    });
  } else {
    askFirst.push({
      title: `What does the RM${price.toLocaleString("en-MY")} include?`,
      detail:
        "A table, power, lighting and a wall differ wildly between organizers, and anything not included is money you have not budgeted.",
    });
  }

  if (event.expectedVisitors === null) {
    askFirst.push({
      title: "How many people actually came last time?",
      detail:
        "No turnout figure is published here. Ask for the last edition's real count rather than a projection, and ask how it was counted.",
    });
  } else {
    askFirst.push({
      title: "Where does the visitor estimate come from?",
      detail:
        "The figure on this page is the organizer's own and nobody audits it. Ask what last year actually did, and whether that was the same venue.",
    });
  }

  askFirst.push({
    title: "What are the load-in and pack-down times?",
    detail:
      opens === null
        ? "Trading hours are not the same as the hours you are on site. Ask when you can get in and when you must be out."
        : `Trading opens at ${String(opens).padStart(2, "0")}:00, but setup usually starts well before that. Ask for the exact access window and whether a vehicle can reach your lot.`,
  });

  if (outdoor === true) {
    askFirst.push({
      title: "Who decides if it rains?",
      detail:
        "This is an outdoor event. Ask whether the organizer cancels, postpones or trades through, and whether a cancelled day is refunded.",
    });
  }

  if (nearlyFull && event.availableSlots > 0) {
    askFirst.push({
      title: "Which lots are actually left?",
      detail: `${taken} of ${event.totalSlots} are taken. What is still open is usually the back of the site, so ask to see the floor plan before you pay.`,
    });
  }

  /* ---------------- Do ---------------- */

  doThis.push({
    title: "Price for a crowd that is walking past",
    detail:
      "Event shoppers buy on impulse and compare with the stall next door. Round numbers and a visible price board sell more than a menu nobody stops to read.",
  });

  doThis.push({
    title: "Take cash and QR",
    detail:
      "DuitNow QR costs you nothing and catches everyone who did not bring notes. Bring a float of small change anyway; the first hour is all RM50s.",
  });

  if (outdoor === true) {
    traits.push("Outdoor");
    doThis.push({
      title: "Weight your canopy down",
      detail:
        "An unweighted canopy is the most common thing that ends a trading day early. Sandbags on every leg, and something waterproof over your stock.",
    });
  }
  if (outdoor === false) traits.push("Indoors");

  if (days > 1) {
    traits.push(`${days} days`);
    doThis.push({
      title: "Split your stock across the days",
      detail: `This runs ${days} days. Selling out on day one looks like a good problem and is not, because you paid for the whole run.`,
    });
  }

  if (closes !== null && closes >= 19) {
    traits.push("Evening trade");
    doThis.push({
      title: "Bring your own light",
      detail: `Trading runs to ${String(closes).padStart(2, "0")}:00. Venue lighting is for walkways, not for stalls, and a dark stall is invisible from three metres.`,
    });
  }

  if (opens !== null && closes !== null && closes - opens >= 10) {
    traits.push(`${closes - opens} hour days`);
    doThis.push({
      title: "Plan a relief shift",
      detail: `Trading runs ${closes - opens} hours a day here. Nobody sells well in hour eleven, and a stall left unattended for a break is a stall that is closed.`,
    });
  }

  if (sector === "fnb") {
    doThis.push({
      title: "Sort the food handling paperwork early",
      detail:
        "Many Malaysian organizers ask for a typhoid jab and a food handler card before they confirm a lot. It takes days to get and cannot be done on the morning.",
    });
    doThis.push({
      title: "Plan your ice and your waste",
      detail:
        "Both are usually yours to solve. Work out where ice comes from mid-afternoon and where rubbish goes at closing before you arrive.",
    });
  } else {
    doThis.push({
      title: "Bring more small stock than you think",
      detail:
        "At a market the impulse tier carries the day. The RM10 to RM30 items pay for the booth; the expensive pieces draw people in.",
    });
  }

  doThis.push({
    title: "Collect contacts, not just sales",
    detail:
      "A booth pays twice: once at the till and once in the people who follow you and buy later. A QR to your page costs nothing to put on the table.",
  });

  /* ---------------- Don't ---------------- */

  notThis.push({
    title: "Do not budget the booth fee alone",
    detail:
      "Staff, transport, stock, packaging and parking usually add up to more than the lot itself. The break-even below counts all of it.",
  });

  notThis.push({
    title: "Do not treat the turnout figure as buyers",
    detail:
      "Visitors are people walking past your stall, not people spending at it. A single-digit percentage of a crowd buying from any one booth is normal.",
  });

  notThis.push({
    title: "Do not arrive at opening time",
    detail:
      "Setup always takes longer than the plan, and a half-built stall in the first hour is an hour of trading you paid for and did not use.",
  });

  if (event.wantedCategories.length > 0 && !event.wantedCategories.includes(category)) {
    notThis.push({
      title: "Do not assume your category is wanted here",
      detail: `The organizer is recruiting ${event.wantedCategories
        .map((c) => CATEGORY_PRESETS[c]?.label ?? c)
        .slice(0, 3)
        .join(", ")}. Ask before you plan around a lot you may not be offered.`,
    });
  }

  if (outdoor === true) {
    notThis.push({
      title: "Do not leave stock on site overnight",
      detail:
        "Outdoor lots are rarely secured after hours, and an organizer's liability for what is left usually stops at the gate.",
    });
  }

  notThis.push({
    title: "Do not pay before you have it in writing",
    detail:
      "Lot number, size, hours, what is included and the refund position. Spotential is not a party to any of it and cannot confirm a booking.",
  });

  return { askFirst, doThis, notThis, traits };
}

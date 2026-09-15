import { formatNumber, resolveRent } from "@spotential/sim-engine";
import type { LocationReportInput } from "../report/model.js";
import type { AgentJob, AgentRoster } from "./agents.js";
import type { GapFacts } from "./facts.js";

/**
 * The four specialists on one location.
 *
 * WHAT THEY REPLACED. One Gemini call was asked to write a headline, three
 * observations, a watch-out, a next step and an opportunity verdict, all at
 * once. It read like a general assistant because that is what it was, and one
 * invented figure anywhere in it refused the lot. Four subject-scoped agents
 * each read a different section of the same fact sheet, each guard separately,
 * and each carry the rules that section's data actually invites you to break.
 *
 * THE RULES BELOW ARE NOT DECORATION. Every one of them is a mistake this data
 * invites, and NOT ONE of them is catchable by the numeric guard, because in
 * every case the figure itself is real and it is the claim about the figure
 * that would be wrong. "You need 71 customers a day to cover the rent" cites a
 * number the engine computed and is still false: that break-even covers every
 * fixed cost in the format, not rent alone.
 *
 * NO HEADLINE FOR THE PANEL. `deriveSummary` in the browser already says what
 * this place scores and which dimension carries it, computed from the score
 * object, and it renders whether or not any of this arrives. A model asked for
 * a headline here has already been caught describing the briefing instead of
 * the place.
 */

export type LocationAgentId = "opportunity" | "rivals" | "customers" | "money";

const LOCATION_COMMON = `You are part of Spotential AI, advising a Malaysian small business owner who is weighing up ONE specific shopfront location.

The page already states what this spot scores and which dimension carries it. Do NOT repeat that back. Say something the page has not already said.

You are one of four specialists reading the same fact sheet. Stay inside your own subject. Another specialist is covering each of the others, so do not stray into theirs and do not summarise the whole location.`;

const JOBS: Record<LocationAgentId, AgentJob> = {
  /**
   * The rules here are carried over VERBATIM from the single briefing this
   * replaced. They were arrived at one production failure at a time, and the
   * worst of them is the first: a model handed a ranking answers about the
   * category the OWNER picked rather than the one the ranking named, and the
   * result is internally consistent, entirely made of real figures, and
   * quietly answers a comparison nobody made.
   */
  opportunity: {
    role: "Opportunity",
    brief: `YOUR JOB: read the CATEGORY SATURATION NEARBY section and say what opening exists here, or plainly that none does.

- ANSWER THE QUESTION THE RANKING ASKED. If the fact sheet names a least crowded category, your headline must be about THAT category. Do not substitute the business type the owner is currently considering, even though it is the obvious thing to talk about: the ranking compared every category on this street, and quietly answering about a different one presents a comparison that was never made. If the owner's own type is worth a sentence, put it in a point.
- NEVER INVENT AN OPENING. If every category is saturated, say so plainly and spend your points on what that means for someone deciding here. A manufactured opportunity is far worse than an honest "there is no gap here", because somebody may sign a lease on it.
- A category with NO OUTLETS AT ALL IS NOT A GAP. It may mean untapped demand, or that there is no appetite for it here, and this data cannot tell the two apart. Never name one as the opening.
- The ranking is RELATIVE TO THIS STREET, not to Malaysia. Do not claim a category is underserved nationally.
- Reviews per outlet is a PROXY for how busy operators are, not a measurement of demand. Say "suggests" rather than "shows".

Good headline: "Every category on this street is already crowded, and that is the finding rather than a reason to keep looking."
Bad headline: "This analysis identifies opportunities in the local market." That describes the document, not the place.`,
  },

  rivals: {
    role: "Rivals",
    brief: `YOUR JOB: read the COMPETITORS section and say what the owner is actually up against.

Who is here, how close, how well regarded, and how tightly packed. Translate distance into trading terms: a rival 40m away shares the same doorway traffic, one 400m away does not.

- A CAPPED SEARCH IS A FLOOR, NOT A COUNT. If the sheet says the search returned the nearest 20 and stopped, never write or imply "there are 20". Write "at least 20".
- AN EMPTY DISTANCE BAND BEYOND THE COMPLETE RADIUS MEANS NOT SEARCHED, never "none there". Saying a ring is empty when nobody looked is the single most misleading thing you could write here.
- An average rating is a measure of how well incumbents are regarded, not of how busy they are. A weak average is an opening to compete on quality, and you may say so.

Good: "The nearest rival is 41m away and at least 20 trade inside 142m, so this is a fully worked pitch rather than an empty one."
Bad: "There are no competitors between 500m and 1,000m." Nobody searched there.`,
  },

  customers: {
    role: "Customers",
    brief: `YOUR JOB: read the AREA DEMOGRAPHICS section and say who is actually within reach.

- THE CATCHMENT IS THE FIGURE THAT MATTERS. It counts residents within the search radius and it is an estimate from a population grid, not a count of customers. Never multiply it by anything, never turn it into a revenue figure, and never call it footfall: it is who LIVES there, not who walks past.
- THE DISTRICT POPULATION IS NOT A CATCHMENT. It covers a whole administrative district, far larger than anything walkable, and it exists only as context for the age and ethnic mix. Never present it as a customer base and never multiply it by anything at all.
- The age mix describes the district, so describe it as the district's.
- There is NO footfall data, no time-of-day data and no seasonal data anywhere in this product. If the honest answer involves any of those, say it is not known.

Good: "About 6,457 people live within 500m, which is dense by Malaysian standards, but nothing here measures how many of them pass this door."
Bad: "With 2,074,100 residents in the district there is plenty of demand." That is a district, not a catchment.`,
  },

  money: {
    role: "Money",
    brief: `YOUR JOB: read the RENT section and say what this site costs to hold.

- THE BREAK-EVEN COVERS ALL FIXED COSTS, NOT RENT ALONE. The fact sheet gives a customers-per-day figure at which the business first covers its fixed costs: rent, staff, utilities and everything else. Writing "you need that many customers a day to cover the rent" cites a real number and states something false. Say it covers the fixed costs.
- AN INFERRED RENT IS A BENCHMARK, NOT A QUOTE. If the sheet says the rent is inferred, say so, say how far the benchmark sits from the pin, and say that a real quote would replace it. A researched estimate for a nearby trading area is not what this unit will actually cost.
- If no rent could be resolved at all, that is what you say. Never estimate one.
- Compare the break-even to the typical daily trade for this format, which the sheet states. That comparison is the useful one: it says whether the rent is demanding or comfortable for the kind of business being considered.

Good: "The benchmark rent puts fixed costs at 71 customers a day, which is 39% of a typical day for this format, so there is room but not much."
Bad: "You need 71 customers a day just to pay the rent." The rent is one part of that figure.`,
  },
};

/**
 * Each specialist asks for ONE ACTION alongside its reading.
 *
 * The single briefing had one `nextStep` for the whole location, and the gap
 * block had `moves`, which the owner said was the most useful part of it: not
 * more observations, but something they could do this week. Attaching one
 * action to each specialist keeps that and improves it, because the action now
 * sits directly on the evidence for it rather than at the end of everything.
 */
const MOVE_RULE = `ALSO GIVE ONE MOVE: a single thing the owner could start this week, on your subject, tied to a figure they can see on this page.

Good moves: negotiate the rent below a stated benchmark, visit at a stated trading hour to check something the data cannot, walk the distance to the nearest rival, get a written quote to replace an inferred figure, compete on an axis the incumbents rate poorly on.
Bad moves: "consider your options", "do more research", "understand your customers". Those are not actions.`;

export const LOCATION_AGENT_IDS: LocationAgentId[] = [
  "opportunity",
  "rivals",
  "customers",
  "money",
];

export const LOCATION_ROSTER: AgentRoster<LocationAgentId> = {
  ids: LOCATION_AGENT_IDS,
  jobs: Object.fromEntries(
    LOCATION_AGENT_IDS.map((id) => [
      id,
      { role: JOBS[id].role, brief: `${JOBS[id].brief}\n\n${MOVE_RULE}` },
    ]),
  ) as Record<LocationAgentId, AgentJob>,
  common: LOCATION_COMMON,
  wantsMove: true,
};

/** A specialist that was never asked, and the computed reason why. */
export interface SkippedAgent {
  id: LocationAgentId;
  role: string;
  /** Derived from the data, never generated. */
  reason: string;
}

/**
 * Which specialists have anything to read, decided BEFORE any call is made.
 *
 * THIS IS THE COST CONTROL AND THE QUALITY CONTROL AT ONCE. A model asked to
 * write about an absence writes filler, and filler sitting next to real
 * findings is worse than a stated gap: it teaches the reader that the cards
 * are decoration. So a specialist with no section to read is not called at
 * all, its card says plainly what is missing, and the location costs two or
 * three Gemini calls rather than four.
 *
 * Decided from the same inputs that build the fact sheet, so it cannot drift
 * from what the sheet actually contains. Recomputed on a cache hit rather than
 * stored, which costs nothing and can never go stale against the readings.
 */
export function locationRoster(
  input: LocationReportInput,
  gaps: GapFacts | null,
): { roster: AgentRoster<LocationAgentId>; skipped: SkippedAgent[] } {
  const rent = resolveRent(
    input.point,
    input.category,
    input.rentOverride && input.rentOverride > 0 ? { monthlyRent: input.rentOverride } : undefined,
  );

  /**
   * A CATCHMENT OF ZERO IS NOT A CATCHMENT TO READ.
   *
   * `typeof x === "number"` is true for 0, so a point the population grid
   * measured at nobody still ran the Customers specialist, and it wrote what a
   * model always writes when handed an absence: "about 0 residents live within
   * the 500m search radius". Verified live before this guard existed.
   *
   * Kontur covers MALAYSIA ONLY, so a zero out here usually means the pin is
   * off the grid rather than that the street is empty, and those are different
   * statements. The skip reason says so rather than letting a model guess.
   */
  const emptyCatchment = input.catchment === 0 && !input.demographics;

  const has: Record<LocationAgentId, boolean> = {
    opportunity: Boolean(gaps && gaps.ranked.length > 0),
    rivals: input.competitors.total > 0,
    customers:
      (typeof input.catchment === "number" && input.catchment > 0) || Boolean(input.demographics),
    money: rent !== null,
  };

  const reasons: Record<LocationAgentId, string> = {
    opportunity:
      "No category comparison has been run for this spot, so there is nothing to rank one business type against another.",
    rivals: `Nothing of this type was found within ${formatNumber(input.radiusMetres)}m, so there are no rivals to read. That is not the same as an opening.`,
    customers: emptyCatchment
      ? `The population grid measured nobody within ${formatNumber(input.radiusMetres)}m of this point. It covers Malaysia only, so this more often means the pin sits outside the grid than that the street is empty, and no district demographics resolved either.`
      : "Neither a population catchment nor district demographics resolved for this point, so who lives within reach is not known.",
    money:
      "No rent benchmark covers this point and none was entered, so there is nothing to judge the cost of holding this site against.",
  };

  const ids = LOCATION_AGENT_IDS.filter((id) => has[id]);
  const skipped = LOCATION_AGENT_IDS.filter((id) => !has[id]).map((id) => ({
    id,
    role: LOCATION_ROSTER.jobs[id].role,
    reason: reasons[id],
  }));

  return { roster: { ...LOCATION_ROSTER, ids }, skipped };
}

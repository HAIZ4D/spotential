/**
 * The numeric guard — Feature 3.
 *
 * THE RULE: Gemini never does arithmetic. A deterministic engine computes
 * every number and the model only narrates. Chat answers must never be able to
 * disagree with the panel next to them.
 *
 * In the simulator that is guaranteed by shape — the model emits a parameter
 * patch and never a figure. A prose chatbot has no such shape. It will write
 * "that is roughly 60% more than average" if the only thing stopping it is a
 * sentence in a prompt, and the result looks exactly as authoritative as the
 * real figures beside it.
 *
 * So the rule gets a mechanism. Every number in an answer must already appear
 * in the facts the model was given, in the user's own question, or be a small
 * ordinal. Anything else means the model computed something, and the answer is
 * REFUSED rather than shown. A refusal is a bad answer; an invented figure
 * presented as a measurement is a wrong one, and this product cannot afford
 * the second.
 */

/**
 * Counting words and positions — "one of the five dimensions", "the top 3".
 * Small enough that no figure in this product is expressible here without
 * also appearing in the facts.
 */
const MAX_ORDINAL = 12;

export interface GuardResult {
  ok: boolean;
  /** Numbers the model used that nothing accounts for. */
  unsupported: number[];
}

/**
 * Every number in a string, normalised.
 *
 * Handles the shapes the fact sheet emits — "RM 9,600", "40 / 100", "142m",
 * "76%", "4.23" — so a thousands separator or a currency prefix never makes
 * the same figure look like a different one.
 */
export function numbersIn(text: string): number[] {
  const found: number[] = [];

  // Digits, optional thousands groups, optional decimals. The surrounding
  // currency, percent or unit characters are deliberately not captured: the
  // guard compares magnitudes, not formatting.
  for (const match of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const value = Number(match[0].replace(/,/g, ""));
    if (Number.isFinite(value)) found.push(value);
  }

  return found;
}

/**
 * Numbers an answer is allowed to contain.
 *
 * Built from the facts and the question together. Both matter: refusing a
 * figure the user themselves typed would make the assistant unable to repeat
 * a question back.
 */
export function allowedNumbers(facts: string, question: string): Set<number> {
  const allowed = new Set<number>();

  for (const value of numbersIn(facts)) allowed.add(value);
  for (const value of numbersIn(question)) allowed.add(value);
  for (let i = 0; i <= MAX_ORDINAL; i += 1) allowed.add(i);

  return allowed;
}

/**
 * Does this answer only cite numbers it was given?
 *
 * A figure is also accepted when it is the facts' value rounded to a whole
 * number: the fact sheet may carry 4.23 while the model writes "4.2", which is
 * a rendering of a real measurement rather than a new claim. Rounding UP the
 * model's precision is not allowed — "4.23" from a fact of "4" would be
 * inventing precision that was never measured.
 */
export function checkNumbers(answer: string, facts: string, question: string): GuardResult {
  const allowed = allowedNumbers(facts, question);
  const rounded = new Set<number>();
  for (const value of allowed) {
    rounded.add(Math.round(value));
    rounded.add(Math.round(value * 10) / 10);
  }

  const unsupported = numbersIn(answer).filter(
    (value) => !allowed.has(value) && !rounded.has(value),
  );

  return { ok: unsupported.length === 0, unsupported };
}

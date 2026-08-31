/**
 * Validating a booth application.
 *
 * Same posture as `parseScenarioInputs`: the body is untrusted, one definition
 * of valid, and errors come back as a list a form can render field by field.
 *
 * What is different here is WHAT is being validated. A scenario is numbers,
 * and a bad one produces a wrong chart. This is a person's contact details
 * being forwarded to a stranger who will act on them, so the checks lean
 * toward refusing rather than coercing — a silently truncated phone number is
 * worse than a rejected form, because the vendor believes they applied and
 * the organizer can never reach them.
 */

export interface ApplyRequest {
  eventId: string;
  packageId: string | null;
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  productDescription: string;
  /** The vendor has read what gets shared with the organizer. */
  consentToShare: boolean;
}

export type ApplyParse =
  | { ok: true; value: ApplyRequest }
  | { ok: false; errors: string[] };

/** Generous caps: long enough for any real answer, short enough to bound a write. */
const LIMITS = {
  businessName: 120,
  contactName: 120,
  contactEmail: 254,
  contactPhone: 30,
  productDescription: 600,
} as const;

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/**
 * Malaysian mobile and landline numbers, with or without country code.
 * Deliberately loose on spacing and dashes, strict on digit count — the point
 * is to catch a mistyped number, not to enforce a format on the vendor.
 */
const PHONE = /^(\+?60|0)[\d\s-]{8,14}$/;

/** Not RFC 5322. It only has to catch a typo before an organizer cannot reply. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function parseApplyRequest(body: unknown): ApplyParse {
  const errors: string[] = [];
  const raw = (body ?? {}) as Record<string, unknown>;

  const eventId = str(raw["eventId"]);
  if (!eventId) errors.push("eventId is required.");

  const businessName = str(raw["businessName"]);
  if (businessName.length < 2) errors.push("Enter your business name.");
  if (businessName.length > LIMITS.businessName) {
    errors.push(`Business name must be ${LIMITS.businessName} characters or fewer.`);
  }

  const contactName = str(raw["contactName"]);
  if (contactName.length < 2) errors.push("Enter a contact name.");
  if (contactName.length > LIMITS.contactName) {
    errors.push(`Contact name must be ${LIMITS.contactName} characters or fewer.`);
  }

  const contactEmail = str(raw["contactEmail"]);
  if (!EMAIL.test(contactEmail)) errors.push("Enter an email address the organizer can reply to.");
  if (contactEmail.length > LIMITS.contactEmail) errors.push("That email address is too long.");

  const contactPhone = str(raw["contactPhone"]);
  if (!PHONE.test(contactPhone)) {
    errors.push("Enter a Malaysian phone number, for example 012-345 6789.");
  }

  const productDescription = str(raw["productDescription"]);
  if (productDescription.length < 10) {
    errors.push("Describe what you would sell, so the organizer can judge the fit.");
  }
  if (productDescription.length > LIMITS.productDescription) {
    errors.push(`Keep the description under ${LIMITS.productDescription} characters.`);
  }

  /**
   * Consent is a hard requirement, not a default.
   *
   * This is the moment a vendor's contact details leave Spotential for a third
   * party. Defaulting it to true, or accepting a missing field as agreement,
   * would make the checkbox decorative.
   */
  const consentToShare = raw["consentToShare"] === true;
  if (!consentToShare) {
    errors.push("Tick the box to confirm your details may be shared with the organizer.");
  }

  const packageValue = str(raw["packageId"]);

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      eventId,
      packageId: packageValue || null,
      businessName,
      contactName,
      contactEmail,
      contactPhone,
      productDescription,
      consentToShare,
    },
  };
}

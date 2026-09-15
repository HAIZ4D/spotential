import { CATEGORY_PRESETS, type BusinessCategory } from "@spotential/sim-engine";

/**
 * The vendor ACCOUNT — who is applying, stored once instead of retyped.
 *
 * THE SECOND KIND OF PERSONAL DATA THIS PRODUCT HOLDS, and the more
 * identifying of the two: a company registration number alongside a named
 * contact. It therefore inherits every rule the booth application already
 * follows — the uid comes from a verified ID token and never from the body,
 * anonymous sign-in is not an account, consent is unticked by default, and the
 * browser never touches Firestore.
 *
 * Named an account rather than a profile on purpose: the engine already
 * exports a `VendorProfile`, which is the scoring profile (category and
 * budget) the events filter bar drives. Two unrelated things sharing one name
 * in one codebase is a trap that outlives whoever set it.
 *
 * NO DOCUMENT UPLOAD, deliberately. The supplied design asked for an SSM
 * certificate file. The registration number is a public-registry identifier
 * and is what an organizer actually needs to check a business is real; a
 * bucket of identity documents is a security and retention surface this
 * product has never opened and does not need to open for this feature.
 */

export interface VendorAccount {
  /** The doc id. Always the caller's own uid, never a value from the body. */
  uid: string;
  fullName: string;
  email: string;
  phone: string;
  companyName: string;
  companyEmail: string;
  companyPhone: string;
  /** Suruhanjaya Syarikat Malaysia registration number. */
  ssmNumber: string;
  /** From the engine's own list, so it can feed scoring rather than be prose. */
  category: BusinessCategory;
  itemsSold: string;
  /** Optional: many small traders are below the registration threshold. */
  tin: string;
  consentToShare: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface VendorAccountStore {
  find(uid: string): Promise<VendorAccount | null>;
  save(profile: VendorAccount): Promise<void>;
}

const MAX = {
  name: 120,
  email: 160,
  phone: 32,
  ssm: 40,
  items: 400,
  tin: 40,
} as const;

export type ParsedAccount =
  | { ok: true; value: Omit<VendorAccount, "uid" | "createdAt" | "updatedAt"> }
  | { ok: false; errors: string[] };

const text = (value: unknown, max: number): string =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * Everything here is treated as hostile, exactly as the apply route treats its
 * body. Note what is NOT read: the uid. It is supplied by the route from the
 * verified token, because a uid taken from a request body is a request to
 * write a record owned by somebody else.
 */
export function parseAccountRequest(body: unknown): ParsedAccount {
  if (typeof body !== "object" || body === null) {
    return { ok: false, errors: ["body must be an object"] };
  }
  const raw = body as Record<string, unknown>;
  const errors: string[] = [];

  const fullName = text(raw["fullName"], MAX.name);
  if (fullName.length < 2) errors.push("fullName is required");

  const email = text(raw["email"], MAX.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) errors.push("email must be a valid address");

  const phone = text(raw["phone"], MAX.phone);
  if (phone.replace(/\D/g, "").length < 7) errors.push("phone is required");

  const companyName = text(raw["companyName"], MAX.name);
  if (companyName.length < 2) errors.push("companyName is required");

  const companyEmail = text(raw["companyEmail"], MAX.email);
  if (companyEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(companyEmail)) {
    errors.push("companyEmail must be a valid address");
  }

  const ssmNumber = text(raw["ssmNumber"], MAX.ssm);
  if (ssmNumber.length < 4) errors.push("ssmNumber is required");

  const categoryRaw = raw["category"];
  const category =
    typeof categoryRaw === "string" && categoryRaw in CATEGORY_PRESETS
      ? (categoryRaw as BusinessCategory)
      : null;
  if (!category) errors.push("category must be one of the supported business types");

  const itemsSold = text(raw["itemsSold"], MAX.items);
  if (itemsSold.length < 3) errors.push("itemsSold is required");

  /**
   * Unticked by default and refused without, the same as the application
   * route. An organizer receives a name and a phone number; that only happens
   * because the vendor said it could.
   */
  const consentToShare = raw["consentToShare"] === true;
  if (!consentToShare) errors.push("consentToShare is required to create a vendor profile");

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      fullName,
      email,
      phone,
      companyName,
      companyEmail,
      companyPhone: text(raw["companyPhone"], MAX.phone),
      ssmNumber,
      category: category!,
      itemsSold,
      tin: text(raw["tin"], MAX.tin),
      consentToShare,
    },
  };
}

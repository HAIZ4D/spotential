import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { EventListing } from "@spotential/sim-engine";
import {
  applyForBooth,
  getVendorAccount,
  myApplications,
  type ApplyResult,
  type SentApplication,
  type VendorAccount,
} from "../../lib/api.js";
import { currentAccount, onAccountChange, signOutAccount } from "../../lib/firebase.js";

/**
 * Applying for a booth: the one place Spotential asks who you are, and the one
 * place it sends something on a person's behalf.
 *
 * IT REALLY SENDS NOW. This route used to refuse every listing in the
 * catalogue with a 409, because all of them are curated rather than published
 * by their organizer, and the rule existed so nobody could believe they had
 * applied to an event that did not exist. The owner changed that, and the
 * reasoning holds: these events are real, and what is curated is the booth
 * pricing and slot counts.
 *
 * So the honesty moved out of the refusal and into the copy. Three things it
 * has to keep saying, and all three are load-bearing:
 *
 *   1. WHAT ACTUALLY HAPPENS NEXT. Spotential receives the application and
 *      passes it to the organizer, who replies directly. Not "the organizer
 *      has your details", which would not be true at the moment of sending.
 *   2. WHOSE PRICE THIS IS. On a curated listing the fee beside the booth is
 *      our estimate, and the vendor is agreeing to it. That belongs in the
 *      form, next to the number, not in a banner they scroll past.
 *   3. WHAT LEAVES SPOTENTIAL, AND WHEN. The consent line names the fields. It
 *      is unticked by default and the server refuses without it.
 *
 * A PREFILLED FIELD IS STILL THE VENDOR'S ANSWER: the account fills the
 * contact half so applying is a pitch rather than a retyped registration, and
 * every value stays editable.
 */

export function ApplyPanel({ event, packageId }: { event: EventListing; packageId: string | null }) {
  const [account, setAccount] = useState(currentAccount());
  useEffect(() => onAccountChange(setAccount), []);

  const full = event.availableSlots <= 0;

  return (
    <section className="card apply" id="apply-panel">
      <header>
        <h2>Apply for a booth</h2>
        {full && <span className="pill red">Booths full</span>}
      </header>
      <div className="body stack">
        {account ? (
          <ApplyForm
            event={event}
            packageId={packageId}
            email={account.email ?? ""}
            onSignOut={signOutAccount}
          />
        ) : (
          <SignInPrompt />
        )}
      </div>
    </section>
  );
}

/**
 * Signed out.
 *
 * Says why an account is needed rather than simply demanding one, and says
 * what still works without it, because almost all of this product does.
 */
function SignInPrompt() {
  return (
    <div className="apply-gate">
      <p className="lede">An account first, then the form.</p>
      <p className="tiny muted">
        The organizer needs somebody to reply to, and your details should not have to be retyped
        for every event. Browsing, scoring and the cost workings never ask who you are.
      </p>
      <div className="apply-gate-actions">
        <Link className="btn-primary" to="/register">
          Join as a vendor
        </Link>
        <Link className="btn-quiet" to="/login">
          I already have an account
        </Link>
      </div>
    </div>
  );
}

interface FormState {
  packageId: string;
  businessName: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  productDescription: string;
  boothActivation: string;
  whyThisEvent: string;
  consentToShare: boolean;
}

function ApplyForm({
  event,
  packageId,
  email,
  onSignOut,
}: {
  event: EventListing;
  packageId: string | null;
  email: string;
  onSignOut: () => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>({
    packageId: packageId ?? event.packages[0]?.id ?? "",
    businessName: "",
    contactName: "",
    contactEmail: email,
    contactPhone: "",
    productDescription: "",
    boothActivation: "",
    whyThisEvent: "",
    consentToShare: false,
  });
  const [prefilled, setPrefilled] = useState(false);
  const [already, setAlready] = useState<SentApplication | null>(null);
  const [reopened, setReopened] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const set = (patch: Partial<FormState>) => setForm((current) => ({ ...current, ...patch }));

  /**
   * Prefill from the vendor account, ONCE and only into empty fields.
   *
   * Merging on every change would fight the typist: the account arrives a
   * moment after the form renders, and a vendor who started typing their
   * business name would watch it be replaced by the stored one.
   */
  useEffect(() => {
    let live = true;
    void getVendorAccount()
      .then((found: VendorAccount | null) => {
        if (!live || !found) return;
        setPrefilled(true);
        setForm((current) => ({
          ...current,
          businessName: current.businessName || found.companyName,
          contactName: current.contactName || found.fullName,
          contactEmail: current.contactEmail || found.companyEmail || found.email,
          contactPhone: current.contactPhone || found.companyPhone || found.phone,
          productDescription: current.productDescription || found.itemsSold,
        }));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  /**
   * Have they already applied to THIS event?
   *
   * The id is `uid__eventId`, so sending again replaces the first application
   * rather than adding a second. A blank form would hide that from somebody
   * about to retype everything, so the panel says so and makes reopening it a
   * deliberate act.
   */
  useEffect(() => {
    let live = true;
    void myApplications()
      .then((sent) => {
        if (!live) return;
        setAlready(sent.find((a) => a.eventId === event.id) ?? null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [event.id]);

  // The booth chosen up the page is the booth applied for. Two controls for
  // one decision is how a vendor costs one stall and applies for another.
  useEffect(() => {
    if (packageId) setForm((current) => ({ ...current, packageId }));
  }, [packageId]);

  if (result?.kind === "applied") {
    return <Sent event={event} form={form} />;
  }

  if (already && !reopened) {
    return (
      <div className="apply-done">
        <Ticket />
        <div>
          <h3>You have already applied to this event</h3>
          <p>
            Sent {new Date(already.submittedAt).toLocaleDateString("en-MY", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}{" "}
            as <strong>{already.businessName}</strong>, with {already.contactEmail} as the reply
            address.
          </p>
          <p className="tiny muted">
            Sending again replaces that application rather than adding a second one.
          </p>
          <button className="btn-quiet" onClick={() => setReopened(true)}>
            Edit and send again
          </button>
        </div>
      </div>
    );
  }

  const chosen = event.packages.find((p) => p.id === form.packageId) ?? null;
  const estimated = event.source === "seed";
  const ready =
    form.businessName.trim().length > 1 &&
    form.contactName.trim().length > 1 &&
    form.contactEmail.includes("@") &&
    form.contactPhone.replace(/\D/g, "").length > 6 &&
    form.productDescription.trim().length >= 10 &&
    form.consentToShare;

  const send = () => {
    setBusy(true);
    setFailed(null);
    void applyForBooth(event.id, { ...form, packageId: form.packageId || null })
      .then((outcome) => {
        setResult(outcome);
        // The errors render above the button; move to them rather than leaving
        // somebody staring at a button that did nothing visible.
        if (outcome.kind !== "applied") {
          errorRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
        }
      })
      .catch((e: Error) => setFailed(e.message))
      .finally(() => setBusy(false));
  };

  return (
    <form
      className="applyform"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !busy) send();
      }}
    >
      <p className="applyform-intro">
        {prefilled ? (
          <>
            Filled in from your vendor account. Change anything that should be different for this
            event. <Link to="/register">Update your account</Link>
          </>
        ) : (
          <>
            <Link to="/register">Save your business details</Link> once and every future
            application starts filled in.
          </>
        )}
      </p>

      <fieldset className="applyform-sec">
        <legend>Your stall</legend>

        {event.packages.length > 0 && (
          <label className="af" htmlFor="apply-package">
            <span className="af-label">Booth</span>
            <select
              id="apply-package"
              value={form.packageId}
              onChange={(e) => set({ packageId: e.target.value })}
            >
              {event.packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}, RM{p.priceRm.toLocaleString("en-MY")} ({p.sizeLabel})
                </option>
              ))}
            </select>
            {/* Material, so it sits beside the number rather than in a banner
                above the form. On a curated listing the vendor is agreeing to
                a fee that Spotential estimated. */}
            <span className="af-hint">
              {estimated
                ? `RM${(chosen?.priceRm ?? 0).toLocaleString("en-MY")} is Spotential's estimate for this event, not a quoted price. The organizer confirms the real fee before you pay anything.`
                : "Published by the organizer for the whole run, not per day."}
            </span>
          </label>
        )}

        <div className="applyform-grid">
          <label className="af" htmlFor="apply-business">
            <span className="af-label">Business name</span>
            <input
              id="apply-business"
              value={form.businessName}
              onChange={(e) => set({ businessName: e.target.value })}
              autoComplete="organization"
              required
            />
          </label>

          <label className="af" htmlFor="apply-contact">
            <span className="af-label">Contact name</span>
            <input
              id="apply-contact"
              value={form.contactName}
              onChange={(e) => set({ contactName: e.target.value })}
              autoComplete="name"
              required
            />
          </label>

          <label className="af" htmlFor="apply-reply">
            <span className="af-label">Email for the reply</span>
            <input
              id="apply-reply"
              type="email"
              value={form.contactEmail}
              onChange={(e) => set({ contactEmail: e.target.value })}
              autoComplete="email"
              required
            />
          </label>

          <label className="af" htmlFor="apply-phone">
            <span className="af-label">Phone</span>
            <input
              id="apply-phone"
              inputMode="tel"
              placeholder="012-345 6789"
              value={form.contactPhone}
              onChange={(e) => set({ contactPhone: e.target.value })}
              autoComplete="tel"
              required
            />
          </label>
        </div>
      </fieldset>

      {/**
       * The pitch: two fields rather than one longer box.
       *
       * An organizer reading fifty applications is sorting on two different
       * questions — does this stall suit the event, and what will it do on the
       * day. Folded together those arrive as a paragraph that has to be read
       * to be sorted; kept apart they can be skimmed. The last two are
       * optional, because requiring a pitch only teaches people to write
       * filler and filler is worse than a blank for whoever reads it.
       */}
      <fieldset className="applyform-sec pitch">
        <legend>Your pitch</legend>
        <p className="applyform-note">
          The part organizers actually read. Everything above is who you are; this is why they
          should pick your stall over the next one.
        </p>

        <label className="af" htmlFor="apply-products">
          <span className="af-label">What you would sell</span>
          <textarea
            id="apply-products"
            rows={3}
            value={form.productDescription}
            onChange={(e) => set({ productDescription: e.target.value })}
            required
          />
        </label>

        <label className="af" htmlFor="apply-activation">
          <span className="af-label">
            What you will run at the booth <em>optional</em>
          </span>
          <textarea
            id="apply-activation"
            rows={3}
            placeholder="Free tastings on the hour, a spin-the-wheel for a free drink, a live latte-art demo at 4pm."
            value={form.boothActivation}
            onChange={(e) => set({ boothActivation: e.target.value })}
          />
          <span className="af-hint">
            The draw, the giveaway, the demo. An organizer is buying a crowd as much as a stall.
          </span>
        </label>

        <label className="af" htmlFor="apply-why">
          <span className="af-label">
            Why you fit this event <em>optional</em>
          </span>
          <textarea
            id="apply-why"
            rows={2}
            placeholder={`Why ${event.name} in particular.`}
            value={form.whyThisEvent}
            onChange={(e) => set({ whyThisEvent: e.target.value })}
          />
        </label>
      </fieldset>

      {/* Unticked by default, and the server refuses without it. This is the
          moment a vendor's contact details leave Spotential, so it names
          exactly what is handed over and to whom. */}
      <label className="applyform-consent">
        <input
          type="checkbox"
          checked={form.consentToShare}
          onChange={(e) => set({ consentToShare: e.target.checked })}
        />
        <span>
          Share my business name, contact name, email, phone and pitch with{" "}
          <strong>{event.organizerName}</strong>.
        </span>
      </label>

      <div ref={errorRef}>
        {result?.kind === "invalid" && (
          <div className="notice danger">
            <span>
              <ul className="tight">
                {result.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </span>
          </div>
        )}
        {result?.kind === "signin" && (
          <div className="notice danger">
            <span>{result.message}</span>
          </div>
        )}
        {failed && (
          <div className="notice danger">
            <span>{failed}</span>
          </div>
        )}
      </div>

      <div className="applyform-send">
        <button type="submit" className="btn-send" disabled={busy || !ready}>
          {busy ? "Sending…" : "Send application"}
        </button>
        <p className="tiny muted">
          Spotential passes it to {event.organizerName}. We do not confirm booths or take payment.
        </p>
      </div>

      <button type="button" className="tiny ghost applyform-out" onClick={() => void onSignOut()}>
        Sign out
      </button>
    </form>
  );
}

/**
 * Sent.
 *
 * Says what happened, to whom, and what has NOT happened. "The organizer has
 * your details" would not be true at the moment of sending; Spotential has
 * them and passes them on, which is.
 */
function Sent({ event, form }: { event: EventListing; form: FormState }) {
  const chosen = event.packages.find((p) => p.id === form.packageId) ?? null;

  return (
    <div className="apply-done sent">
      <Ticket />
      <div>
        <h3>Application sent</h3>
        <p>
          Spotential has your application for <strong>{event.name}</strong> and will pass it to{" "}
          <strong>{event.organizerName}</strong>. They reply to you directly at{" "}
          {form.contactEmail}.
        </p>
        <dl className="apply-receipt">
          <div>
            <dt>Booth</dt>
            <dd>{chosen ? `${chosen.label}, ${chosen.sizeLabel}` : "not stated"}</dd>
          </div>
          <div>
            <dt>Business</dt>
            <dd>{form.businessName}</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>
              {form.contactName} · {form.contactPhone}
            </dd>
          </div>
        </dl>
        <p className="tiny muted">
          Spotential does not confirm booths or take payment, and the booth fee shown here is
          settled with the organizer rather than with us. Anything after this happens between you
          and them.
        </p>
      </div>
    </div>
  );
}

/* Inline SVG rather than an icon package or an emoji: one glyph does not
   justify a dependency, and emoji render differently on every platform. */
function Ticket() {
  return (
    <span className="apply-done-mark" aria-hidden="true">
      <svg viewBox="0 0 24 24" width="22" height="22" focusable="false">
        <path
          d="M4 12.5l5 5L20 6.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

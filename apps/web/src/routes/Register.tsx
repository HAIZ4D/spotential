import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { listCategories, type BusinessCategory } from "@spotential/sim-engine";
import { Masthead } from "../components/Masthead.js";
import { registerWithEmail, signInWithGoogle, currentAccount } from "../lib/firebase.js";
import { saveVendorAccount, type VendorAccountInput } from "../lib/api.js";

/**
 * Join as an event vendor.
 *
 * The fields come from the owner's supplied design; the styling does not. That
 * mockup is somebody else's product in somebody else's palette, and a
 * registration form is exactly where a reader decides whether they are dealing
 * with one company or three.
 *
 * NO SSM DOCUMENT UPLOAD, and its absence is deliberate rather than pending.
 * The design asked for a certificate file. The registration NUMBER is a
 * public-registry identifier and is what an organizer needs to check a
 * business is real; storing scans of identity documents means a bucket to
 * secure, a retention policy to honour and a deletion obligation to answer —
 * a surface this product has never opened and does not need for this feature.
 *
 * TWO STEPS IN ONE SUBMIT: create the Firebase account, then write the vendor
 * details under the uid that account produced. If the second fails, the first
 * still happened, so the form says so rather than pretending nothing occurred.
 */

const CATEGORIES = listCategories();

interface FormState extends VendorAccountInput {
  password: string;
  confirmPassword: string;
}

const EMPTY: FormState = {
  fullName: "",
  email: "",
  phone: "",
  password: "",
  confirmPassword: "",
  companyName: "",
  companyEmail: "",
  companyPhone: "",
  ssmNumber: "",
  category: "cafe_coffee_shop",
  itemsSold: "",
  tin: "",
  consentToShare: false,
};

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  /**
   * Checked before the request, so the obvious mistakes are caught where the
   * reader made them rather than as a server round trip. The server validates
   * all of this again regardless: a form is a courtesy, never a guarantee.
   */
  const mismatch = form.confirmPassword.length > 0 && form.password !== form.confirmPassword;
  const complete =
    form.fullName.trim().length > 1 &&
    form.email.includes("@") &&
    form.phone.replace(/\D/g, "").length > 6 &&
    form.password.length >= 8 &&
    form.password === form.confirmPassword &&
    form.companyName.trim().length > 1 &&
    form.ssmNumber.trim().length > 3 &&
    form.itemsSold.trim().length > 2 &&
    form.consentToShare;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!complete || busy) return;

    setBusy(true);
    setError(null);
    setDetails([]);

    const { password, confirmPassword: _confirm, ...account } = form;

    try {
      // `currentAccount()` already excludes the anonymous session every
      // visitor holds for the quota hint, so a truthy value here is a real
      // account and there is nothing to create.
      if (!currentAccount()) {
        await registerWithEmail(form.email, password);
      }

      const result = await saveVendorAccount(account);

      if (result.kind === "saved") {
        navigate("/events");
        return;
      }

      // The Firebase account exists at this point even though the details did
      // not save, so the message says which half succeeded.
      setError(
        result.kind === "invalid"
          ? `${result.message} Your sign-in was created, so you can fix these and save again.`
          : result.message,
      );
      setDetails(result.kind === "invalid" ? result.details : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Masthead subtitle="Join as event vendor" />

      <div className="authpage">
        <header className="auth-head">
          <h1>Join as an event vendor</h1>
          <p>
            One account, then apply to any listed event without retyping your details. Organizers
            see your business name and contact only when you apply.
          </p>
        </header>

        <form className="authcard" onSubmit={submit}>
          <section className="auth-sec">
            <h2>Your details</h2>

            <div className="auth-grid">
              <Field id="reg-name" label="Full name" hint="As shown on your IC or passport" required>
                <input
                  id="reg-name"
                  aria-describedby="reg-name-note"
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  autoComplete="name"
                  required
                />
              </Field>

              <Field id="reg-email" label="Email address" required>
                <input
                  id="reg-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  autoComplete="email"
                  required
                />
              </Field>

              <Field id="reg-phone" label="Phone number" required>
                <input
                  id="reg-phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  placeholder="+60"
                  autoComplete="tel"
                  required
                />
              </Field>

              <Field id="reg-password" label="Password" hint="At least 8 characters" required>
                <input
                  id="reg-password"
                  aria-describedby="reg-password-note"
                  type="password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                />
              </Field>

              <Field
                id="reg-confirm"
                label="Confirm password"
                required
                {...(mismatch ? { error: "Those two passwords do not match." } : {})}
              >
                <input
                  id="reg-confirm"
                  {...(mismatch ? { "aria-describedby": "reg-confirm-note" } : {})}
                  aria-invalid={mismatch}
                  type="password"
                  value={form.confirmPassword}
                  onChange={(e) => set("confirmPassword", e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </Field>
            </div>
          </section>

          <section className="auth-sec">
            <h2>Your business</h2>

            <div className="auth-grid">
              <Field id="reg-company" label="Company name" required>
                <input
                  id="reg-company"
                  value={form.companyName}
                  onChange={(e) => set("companyName", e.target.value)}
                  autoComplete="organization"
                  required
                />
              </Field>

              <Field id="reg-company-email" label="Company email">
                <input
                  id="reg-company-email"
                  type="email"
                  value={form.companyEmail}
                  onChange={(e) => set("companyEmail", e.target.value)}
                />
              </Field>

              <Field id="reg-company-phone" label="Company phone">
                <input
                  id="reg-company-phone"
                  type="tel"
                  value={form.companyPhone}
                  onChange={(e) => set("companyPhone", e.target.value)}
                  placeholder="+60"
                />
              </Field>

              <Field
                id="reg-ssm"
                label="SSM registration number"
                hint="Your Suruhanjaya Syarikat Malaysia number. We store the number, never a copy of the certificate."
                required
              >
                <input
                  id="reg-ssm"
                  aria-describedby="reg-ssm-note"
                  value={form.ssmNumber}
                  onChange={(e) => set("ssmNumber", e.target.value)}
                  placeholder="202501234567"
                  required
                />
              </Field>

              <Field
                id="reg-category"
                label="What kind of business"
                hint="This decides which events you are scored against"
                required
              >
                <select
                  id="reg-category"
                  aria-describedby="reg-category-note"
                  value={form.category}
                  onChange={(e) => set("category", e.target.value as BusinessCategory)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field id="reg-tin" label="TIN" hint="Tax identification number, if you have one">
                <input
                  id="reg-tin"
                  aria-describedby="reg-tin-note"
                  value={form.tin}
                  onChange={(e) => set("tin", e.target.value)}
                />
              </Field>
            </div>

            <Field id="reg-items" label="What you sell" hint="Organizers read this first" required>
              <textarea
                id="reg-items"
                aria-describedby="reg-items-note"
                rows={3}
                value={form.itemsSold}
                onChange={(e) => set("itemsSold", e.target.value)}
                placeholder="Sourdough loaves, pastries and filter coffee, all baked the same morning."
                required
              />
            </Field>
          </section>

          {/* Unticked by default, and the server refuses without it. */}
          <label className="auth-consent">
            <input
              type="checkbox"
              checked={form.consentToShare}
              onChange={(e) => set("consentToShare", e.target.checked)}
            />
            <span>
              I agree that my business name and contact details may be shared with an organizer
              when I apply to their event.
            </span>
          </label>

          {error && (
            <div className="notice warn">
              <span>
                {error}
                {details.length > 0 && ` (${details.join("; ")})`}
              </span>
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={!complete || busy}>
            {busy ? "Creating your account…" : "Create vendor account"}
          </button>

          <div className="auth-alt">
            <button type="button" onClick={() => void signInWithGoogle()} disabled={busy}>
              Continue with Google
            </button>
            <p>
              Already have an account? <Link to="/login">Log in</Link>
            </p>
          </div>
        </form>
      </div>
    </>
  );
}

/**
 * One field, with its hint DESCRIBING the control rather than naming it.
 *
 * The first version wrapped everything in a single `<label>`, which is the
 * usual shorthand and was wrong here: an implicit label takes its name from
 * its whole text content, so the password field announced itself as "Password
 * At least 8 characters" and the confirm field, once it disagreed, as "Confirm
 * password Those two passwords do not match." Same family as the tab state
 * dots that announced "Data could not be loaded Rent": text that belongs
 * beside a control had been absorbed into its name.
 *
 * So the label is explicit and carries only the label, and the hint or error
 * is attached with `aria-describedby`, which is announced after the name
 * rather than as part of it. The asterisk is `aria-hidden` because the control
 * already carries `required`.
 */
function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const note = error ?? hint;
  return (
    <div className="auth-field">
      {/* The required star is a CSS `::after`, not an element. Written into the
          markup it joined the label's text, so the field announced itself as
          "Password star" and no name-based lookup could match it exactly. A
          decoration that changes an accessible name is not a decoration. The
          control carries `required` either way, which is what actually tells
          a screen reader. */}
      <label className={`auth-label${required ? " req" : ""}`} htmlFor={id}>
        {label}
      </label>
      {children}
      {note && (
        <span id={`${id}-note`} className={error ? "auth-error" : "auth-hint"}>
          {note}
        </span>
      )}
    </div>
  );
}

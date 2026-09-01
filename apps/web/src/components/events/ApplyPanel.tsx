import { useEffect, useState } from "react";
import type { EventListing } from "@spotential/sim-engine";
import { applyForBooth, type ApplyResult } from "../../lib/api.js";
import {
  currentAccount,
  onAccountChange,
  registerWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOutAccount,
} from "../../lib/firebase.js";

/**
 * Applying for a booth — the one place Spotential asks who you are.
 *
 * Everything else in this app is a shareable URL with nothing kept per person.
 * An application is different: it carries a business name and a phone number,
 * it goes to a stranger who will act on it, and it has to belong to exactly one
 * vendor. That is why this is the only feature behind a real account.
 *
 * Two things the UI must be honest about, and both are load-bearing:
 *
 *   1. A SAMPLE LISTING IS NOT BOOKABLE. Letting someone believe they applied
 *      to an event that does not exist would be the most harmful thing this
 *      feature could do, so the sample case is stated before the form rather
 *      than discovered after submitting.
 *   2. WHAT LEAVES SPOTENTIAL, AND WHEN. The consent line names the fields
 *      being handed over. It is unticked by default and the server refuses
 *      without it, so it cannot decay into decoration.
 */

export function ApplyPanel({ event }: { event: EventListing }) {
  const [account, setAccount] = useState(currentAccount());
  useEffect(() => onAccountChange(setAccount), []);

  const sample = event.source === "seed";
  const full = event.availableSlots <= 0;

  if (sample) {
    return (
      <section className="card">
        {/* The header tag is gone at the owner's request; the notice below
            still carries the whole explanation, and the apply route refuses a
            seeded listing server-side regardless of what this panel shows. */}
        <header>
          <h2>Apply for a booth</h2>
        </header>
        <div className="body">
          <div className="notice warn">
            <span>
              <strong>Applications are not open for this event yet.</strong> Booth pricing and
              slot counts here are curated estimates rather than an organizer's published terms,
              so there is nothing to apply to. Contact the organizer directly if you have found
              this event elsewhere. Applying opens when organizers publish their events here.
            </span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="card">
      <header>
        <h2>Apply for a booth</h2>
        {full && <span className="pill red">Booths full</span>}
      </header>
      <div className="body">
        {account ? (
          <ApplyForm event={event} email={account.email ?? ""} onSignOut={signOutAccount} />
        ) : (
          <SignIn />
        )}
      </div>
    </section>
  );
}

function SignIn() {
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      // Firebase error codes are not reader-facing. Say the useful thing.
      const code = (e as { code?: string }).code ?? "";
      setError(
        code.includes("wrong-password") || code.includes("invalid-credential")
          ? "That email and password do not match."
          : code.includes("email-already-in-use")
            ? "That email already has an account. Sign in instead."
            : code.includes("weak-password")
              ? "Use a password of at least six characters."
              : code.includes("popup-closed")
                ? "The Google sign-in window was closed."
                : "Could not sign in. Try again in a moment.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <p className="tiny muted">
        Applying needs an account so the organizer has someone to reply to. Browsing, scoring and
        the cost workings never do.
      </p>

      <button disabled={busy} onClick={() => void run(signInWithGoogle)}>
        Continue with Google
      </button>

      <div className="signin-or">
        <span>or</span>
      </div>

      <div className="field">
        <label htmlFor="apply-email">Email</label>
        <input
          id="apply-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor="apply-password">Password</label>
        <input
          id="apply-password"
          type="password"
          autoComplete={mode === "in" ? "current-password" : "new-password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      {error && (
        <div className="notice danger">
          <span>{error}</span>
        </div>
      )}

      <button
        className="primary"
        disabled={busy || !email || !password}
        onClick={() =>
          void run(() =>
            mode === "in" ? signInWithEmail(email, password) : registerWithEmail(email, password),
          )
        }
      >
        {mode === "in" ? "Sign in" : "Create account"}
      </button>

      <button className="tiny ghost" onClick={() => setMode(mode === "in" ? "up" : "in")}>
        {mode === "in" ? "No account yet? Create one" : "Already have an account? Sign in"}
      </button>
    </div>
  );
}

function ApplyForm({
  event,
  email,
  onSignOut,
}: {
  event: EventListing;
  email: string;
  onSignOut: () => Promise<void>;
}) {
  const [form, setForm] = useState({
    packageId: event.packages[0]?.id ?? "",
    businessName: "",
    contactName: "",
    contactEmail: email,
    contactPhone: "",
    productDescription: "",
    consentToShare: false,
  });
  const [result, setResult] = useState<ApplyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch });

  if (result?.kind === "applied") {
    return (
      <div className="stack">
        <div className="notice info">
          <span>
            <strong>Application sent.</strong> {event.organizerName} has your details and will
            reply directly. Spotential does not confirm booths or take payment. Anything after
            this happens between you and the organizer.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      {event.packages.length > 0 && (
        <div className="field">
          <label htmlFor="apply-package">Booth</label>
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
        </div>
      )}

      <div className="field">
        <label htmlFor="apply-business">Business name</label>
        <input
          id="apply-business"
          value={form.businessName}
          onChange={(e) => set({ businessName: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="apply-contact">Contact name</label>
        <input
          id="apply-contact"
          value={form.contactName}
          onChange={(e) => set({ contactName: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="apply-reply">Email for the organizer to reply to</label>
        <input
          id="apply-reply"
          type="email"
          value={form.contactEmail}
          onChange={(e) => set({ contactEmail: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="apply-phone">Phone</label>
        <input
          id="apply-phone"
          inputMode="tel"
          placeholder="012-345 6789"
          value={form.contactPhone}
          onChange={(e) => set({ contactPhone: e.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="apply-products">What you would sell</label>
        <textarea
          id="apply-products"
          rows={3}
          value={form.productDescription}
          onChange={(e) => set({ productDescription: e.target.value })}
        />
      </div>

      {/* Unticked by default, and the server refuses without it. This is the
          moment a vendor's contact details leave Spotential for a third party,
          so it names exactly what is handed over. */}
      <label className="checkline">
        <input
          type="checkbox"
          checked={form.consentToShare}
          onChange={(e) => set({ consentToShare: e.target.checked })}
        />
        <span>
          Share my business name, contact name, email, phone and product description with{" "}
          {event.organizerName}.
        </span>
      </label>

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
      {result?.kind === "sample" && (
        <div className="notice warn">
          <span>{result.message}</span>
        </div>
      )}
      {failed && (
        <div className="notice danger">
          <span>{failed}</span>
        </div>
      )}

      <button
        className="primary"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setFailed(null);
          void applyForBooth(event.id, { ...form, packageId: form.packageId || null })
            .then(setResult)
            .catch((e: Error) => setFailed(e.message))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Sending…" : "Send application"}
      </button>

      <button className="tiny ghost" onClick={() => void onSignOut()}>
        Sign out
      </button>
    </div>
  );
}

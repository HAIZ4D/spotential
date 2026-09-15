import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Masthead } from "../components/Masthead.js";
import { signInWithEmail, signInWithGoogle } from "../lib/firebase.js";

/**
 * Vendor log in.
 *
 * Deliberately thin: an account exists so an organizer has someone to reply
 * to, not so the product can hold anything. Everything on this site except
 * applying works signed out, and this page says so rather than implying a wall.
 */
export default function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      navigate("/events");
    } catch (caught) {
      /**
       * Firebase's own message is shown rather than a friendly rewrite. When a
       * provider is switched off it says so — `auth/operation-not-allowed` —
       * and swallowing that would leave a reader staring at "something went
       * wrong" while the fix is one toggle in a console.
       */
      setError(caught instanceof Error ? caught.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Masthead subtitle="Vendor log in" />

      <div className="authpage">
        <header className="auth-head">
          <h1>Log in</h1>
          <p>
            You only need an account to apply for a booth. Browsing events, scoring them and
            working out booth economics all stay open.
          </p>
        </header>

        <form
          className="authcard narrow"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => signInWithEmail(email, password));
          }}
        >
          <label className="auth-field">
            <span className="auth-label">Email address</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className="auth-field">
            <span className="auth-label">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {error && (
            <div className="notice warn">
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="auth-submit"
            disabled={busy || !email.includes("@") || password.length === 0}
          >
            {busy ? "Signing in…" : "Log in"}
          </button>

          <div className="auth-alt">
            <button type="button" onClick={() => void run(signInWithGoogle)} disabled={busy}>
              Continue with Google
            </button>
            <p>
              New here? <Link to="/register">Create a vendor account</Link>
            </p>
          </div>
        </form>
      </div>
    </>
  );
}

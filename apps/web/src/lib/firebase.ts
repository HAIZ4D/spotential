import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  getToken,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from "firebase/auth";

/**
 * Firebase App Check and anonymous sign-in.
 *
 * App Check attests that a request came from this app on an allowed domain,
 * which is what stops someone pointing a script at the public API and spending
 * the Gemini and Places budget. It gates the three paid endpoints; the
 * simulator's own maths runs entirely in the browser and never needs it.
 *
 * Every value here is PUBLIC by design — the Firebase web config and the
 * reCAPTCHA site key both ship in the bundle, exactly like the Maps browser
 * key. The protection is the domain restriction plus server-side verification,
 * not secrecy.
 */

const firebaseConfig = {
  apiKey: import.meta.env["VITE_FIREBASE_API_KEY"] ?? "",
  authDomain: import.meta.env["VITE_FIREBASE_AUTH_DOMAIN"] ?? "",
  projectId: import.meta.env["VITE_FIREBASE_PROJECT_ID"] ?? "",
  appId: import.meta.env["VITE_FIREBASE_APP_ID"] ?? "",
  messagingSenderId: import.meta.env["VITE_FIREBASE_SENDER_ID"] ?? "",
};

const RECAPTCHA_SITE_KEY: string = import.meta.env["VITE_RECAPTCHA_SITE_KEY"] ?? "";

let app: FirebaseApp | null = null;
let appCheck: AppCheck | null = null;
let auth: Auth | null = null;
let uid: string | null = null;

/**
 * The signed-in user, which is a DIFFERENT thing from `uid` above.
 *
 * `uid` is the anonymous quota hint every visitor gets. This is a real account,
 * and only ever set by an explicit sign-in. Keeping them apart matters: the
 * server rejects anonymous ID tokens for applications precisely so that a
 * visitor is never handed an "account" that evaporates when they clear storage.
 */
let account: User | null = null;
const accountListeners = new Set<(user: User | null) => void>();

/** Set once so a failed init is not retried on every request. */
let initialised = false;

function configured(): boolean {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.appId && RECAPTCHA_SITE_KEY);
}

/**
 * Start App Check and sign in anonymously.
 *
 * Failure is survivable and deliberately non-fatal: the simulator computes
 * locally, so a browser that cannot run reCAPTCHA loses the paid analysis
 * panels and nothing else. Those panels already have "could not load" states.
 */
export function initFirebase(): void {
  if (initialised || !configured()) return;
  initialised = true;

  try {
    app = initializeApp(firebaseConfig);

    // Lets `npm run dev` work on localhost without a live reCAPTCHA
    // assessment. Only read in dev; never set in a production build.
    const debugToken = import.meta.env["VITE_APPCHECK_DEBUG_TOKEN"];
    if (import.meta.env.DEV && debugToken) {
      (self as unknown as Record<string, unknown>)["FIREBASE_APPCHECK_DEBUG_TOKEN"] = debugToken;
    }

    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaEnterpriseProvider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });

    auth = getAuth(app);

    onAuthStateChanged(auth, (user) => {
      // Anonymous sessions are not accounts. Treating them as one here would
      // show a signed-in header to every visitor and let them start an
      // application the server would then refuse.
      account = user && !user.isAnonymous ? user : null;
      for (const listener of accountListeners) listener(account);
    });

    void signInAnonymously(auth)
      .then((credential) => {
        uid = credential.user.uid;
      })
      .catch(() => {
        // Only affects quota fairness, not access. See below.
      });
  } catch {
    app = null;
    appCheck = null;
  }
}

/**
 * Headers for a call to one of the paid endpoints.
 *
 * The UID is a quota FAIRNESS HINT, not authentication — the server treats it
 * as such. App Check is the actual boundary; without the UID a caller simply
 * shares an IP-derived bucket.
 */
export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  if (appCheck) {
    try {
      const { token } = await getToken(appCheck, /* forceRefresh */ false);
      headers["X-Firebase-AppCheck"] = token;
    } catch {
      // Leave the header off. The server will 401 and the panel shows its
      // existing failure state, which is better than a blank screen.
    }
  }

  if (uid) headers["X-Spotential-Uid"] = uid;
  return headers;
}

/** For the health/debug surface, so a misconfigured build is visible. */
export function appCheckReady(): boolean {
  return appCheck !== null;
}

/**
 * Real accounts, used only by the Events feature.
 *
 * Everything else in Spotential is a shareable URL with nothing persisted per
 * person. Applying for a booth is the one action that needs to know who is
 * asking, because an organizer will act on it and it carries contact details.
 */

export function currentAccount(): User | null {
  return account;
}

/** Subscribe to sign-in changes. Returns an unsubscribe. */
export function onAccountChange(listener: (user: User | null) => void): () => void {
  accountListeners.add(listener);
  listener(account);
  return () => accountListeners.delete(listener);
}

export async function signInWithGoogle(): Promise<void> {
  if (!auth) throw new Error("Sign-in is not configured in this build.");
  await signInWithPopup(auth, new GoogleAuthProvider());
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  if (!auth) throw new Error("Sign-in is not configured in this build.");
  await signInWithEmailAndPassword(auth, email, password);
}

export async function registerWithEmail(email: string, password: string): Promise<void> {
  if (!auth) throw new Error("Sign-in is not configured in this build.");
  await createUserWithEmailAndPassword(auth, email, password);
}

/**
 * Sign out, then return to an anonymous session.
 *
 * Without the second step the visitor would be left with no session at all and
 * the quota hint would fall back to a shared IP bucket — signing out of an
 * account should not quietly change how the rest of the app is rate-limited.
 */
export async function signOutAccount(): Promise<void> {
  if (!auth) return;
  await signOut(auth);
  await signInAnonymously(auth).catch(() => undefined);
}

/**
 * Bearer token for a route that needs a real identity.
 *
 * Separate from `authHeaders()`, which carries App Check and the quota hint.
 * The two answer different questions — "is this our app?" and "who is this?" —
 * and the apply route asks both.
 */
export async function accountHeaders(): Promise<Record<string, string>> {
  if (!account) return {};
  try {
    const token = await account.getIdToken();
    return { Authorization: `Bearer ${token}` };
  } catch {
    // Expired and unrefreshable. The server will answer 401 and the form shows
    // its sign-in prompt, which is the honest outcome.
    return {};
  }
}

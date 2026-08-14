import { initializeApp, type FirebaseApp } from "firebase/app";
import {
  initializeAppCheck,
  getToken,
  ReCaptchaEnterpriseProvider,
  type AppCheck,
} from "firebase/app-check";
import { getAuth, signInAnonymously, type Auth } from "firebase/auth";

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

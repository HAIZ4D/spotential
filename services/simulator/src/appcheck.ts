import { createRemoteJWKSet, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Firebase App Check verification.
 *
 * App Check attests that a request came from OUR web app on an allowed domain,
 * rather than from a script someone pointed at the public URL. That is the
 * whole point here: there is no private data in this product, but there are
 * Gemini and Places bills.
 *
 * Verified with `jose` rather than firebase-admin deliberately. The Admin SDK
 * drags in gRPC and its own Firestore — the exact combination that already
 * cost a day to "__dirname is not defined" and a silently in-memory cache. An
 * App Check token is an ordinary JWT; this needs a JWT library, nothing more.
 */

const JWKS_URL = new URL("https://firebaseappcheck.googleapis.com/v1/jwks");
const ISSUER_PREFIX = "https://firebaseappcheck.googleapis.com/";

export interface AppCheckConfig {
  /** Numeric project number, e.g. "388936868171". The token audience. */
  projectNumber: string;
  /**
   * Lets CI reach the protected routes. Bypasses APP CHECK ONLY — never the
   * quota, never the spend ceiling. Single documented purpose; not a general
   * back door.
   */
  smokeKey?: string | undefined;
}

export class AppCheckVerifier {
  // createRemoteJWKSet caches keys and refetches on rotation, so this is one
  // network call every few hours rather than one per request.
  private readonly jwks = createRemoteJWKSet(JWKS_URL);

  constructor(private readonly config: AppCheckConfig) {}

  async verify(token: string): Promise<boolean> {
    try {
      await jwtVerify(token, this.jwks, {
        issuer: `${ISSUER_PREFIX}${this.config.projectNumber}`,
        audience: `projects/${this.config.projectNumber}`,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fastify preHandler for the routes that cost money.
   *
   * There is deliberately NO fail-open. If verification cannot run, the route
   * refuses — a gate that waves everything through when it breaks is not a
   * gate, which is the same lesson the in-memory cache regression taught.
   */
  guard() {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const smoke = request.headers["x-smoke-key"];
      if (this.config.smokeKey && smoke === this.config.smokeKey) return;

      const header = request.headers["x-firebase-appcheck"];
      const token = Array.isArray(header) ? header[0] : header;

      if (!token || !(await this.verify(token))) {
        await reply.status(401).send({
          error: "app_check_required",
          message:
            "This endpoint is only available to the Spotential web app. Open it at " +
            "https://spotential-app.web.app rather than calling it directly.",
        });
      }
    };
  }
}

/**
 * Identify the caller for quota bucketing.
 *
 * The anonymous Firebase UID the client sends is a FAIRNESS HINT, NOT AUTH.
 * It is unverified and someone could rotate it. That is acceptable because
 * App Check is the actual boundary and the global circuit breaker bounds the
 * damage — but it must not be mistaken for an identity check.
 *
 * Falls back to the forwarded IP, which is what this used to be and which
 * treats everyone behind one mobile carrier NAT as a single caller.
 */
export function callerIdOf(request: FastifyRequest): string {
  const uidHeader = request.headers["x-spotential-uid"];
  const uid = Array.isArray(uidHeader) ? uidHeader[0] : uidHeader;
  if (uid && /^[A-Za-z0-9_-]{8,128}$/.test(uid)) return `uid:${uid}`;

  const forwarded = request.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return `ip:${(raw?.split(",")[0] ?? request.ip ?? "unknown").trim()}`;
}

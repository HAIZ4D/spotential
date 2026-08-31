import { createRemoteJWKSet, jwtVerify } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Firebase Authentication — verifying a real signed-in user.
 *
 * WHY THIS EXISTS AT ALL, given the product has managed without accounts. Up
 * to now every view was a shareable URL and nothing persisted per person, so
 * the anonymous UID was only ever a quota hint and App Check was the real
 * boundary. Applying for a booth breaks that: an application is a commitment
 * carrying a business name and contact details, it belongs to exactly one
 * vendor, and an organizer will act on it. That needs an identity that cannot
 * be rotated by clearing browser storage.
 *
 * VERIFIED WITH `jose`, NOT firebase-admin — the same decision, for the same
 * reason, as appcheck.ts. The Admin SDK drags in gRPC and its own Firestore
 * client, which is precisely the combination that once produced
 * "__dirname is not defined" and a silently in-memory cache in production. A
 * Firebase ID token is an ordinary RS256 JWT signed by Google; this needs a
 * JWT library and nothing more.
 *
 * THIS IS A SEPARATE GATE FROM APP CHECK, and both apply to the apply route.
 * They answer different questions: App Check asks "did this come from our
 * app?", which protects the bill; auth asks "who is this?", which protects
 * the data. Neither substitutes for the other.
 */

/**
 * Google's public keys for Firebase ID tokens. A different issuer and a
 * different JWKS from App Check — reusing that one would verify nothing.
 */
const JWKS_URL = new URL(
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
);

const ISSUER_PREFIX = "https://securetoken.google.com/";

export interface AuthConfig {
  /** Firebase project id, e.g. "spotential-app". Audience and issuer suffix. */
  projectId: string;
}

export interface AuthedUser {
  uid: string;
  email: string | null;
  name: string | null;
  /** True for anonymous sign-in, which must NOT be treated as an account. */
  anonymous: boolean;
}

export class AuthVerifier {
  // Caches keys and refetches on rotation: one network call every few hours
  // rather than one per request.
  private readonly jwks = createRemoteJWKSet(JWKS_URL);

  constructor(private readonly config: AuthConfig) {}

  async verify(token: string): Promise<AuthedUser | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: `${ISSUER_PREFIX}${this.config.projectId}`,
        audience: this.config.projectId,
      });

      // `sub` is the uid. Without it there is no owner to attribute anything
      // to, so the token is useless to us even if cryptographically valid.
      const uid = typeof payload.sub === "string" ? payload.sub : null;
      if (!uid) return null;

      /**
       * Anonymous sessions are rejected as identity.
       *
       * The client signs in anonymously on every page for the quota hint, so
       * a valid anonymous ID token is always available and would sail through
       * a naive check — handing every visitor an "account" that vanishes when
       * they clear storage, and attaching real applications to it.
       */
      const provider = (payload["firebase"] as { sign_in_provider?: string } | undefined)
        ?.sign_in_provider;
      const anonymous = provider === "anonymous";

      return {
        uid,
        email: typeof payload["email"] === "string" ? payload["email"] : null,
        name: typeof payload["name"] === "string" ? payload["name"] : null,
        anonymous,
      };
    } catch {
      return null;
    }
  }

  /**
   * Fastify preHandler for routes that read or write a person's own data.
   *
   * No fail-open, and no smoke-key bypass. App Check has one because CI must
   * reach the paid routes without a browser; this must not, because a key
   * that skips authentication is not a test affordance, it is a way to write
   * records owned by nobody.
   */
  guard() {
    return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      const header = request.headers["authorization"];
      const raw = Array.isArray(header) ? header[0] : header;
      const token = raw?.startsWith("Bearer ") ? raw.slice(7).trim() : null;

      if (!token) {
        await reply.status(401).send({
          error: "sign_in_required",
          message: "Sign in to apply for a booth.",
        });
        return;
      }

      const user = await this.verify(token);

      if (!user) {
        await reply.status(401).send({
          error: "sign_in_required",
          message: "That sign-in has expired. Sign in again to continue.",
        });
        return;
      }

      if (user.anonymous) {
        await reply.status(403).send({
          error: "account_required",
          message:
            "Applying for a booth needs a real account so the organizer can reach you. " +
            "Sign in with Google or an email address.",
        });
        return;
      }

      // Handed to the route body. Fastify carries this through the request.
      (request as FastifyRequest & { user?: AuthedUser }).user = user;
    };
  }
}

/** The verified user attached by the guard. Never trust a uid from the body. */
export function userOf(request: FastifyRequest): AuthedUser | null {
  return (request as FastifyRequest & { user?: AuthedUser }).user ?? null;
}

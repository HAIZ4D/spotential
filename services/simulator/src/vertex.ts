/**
 * Vertex AI transport — the production auth path.
 *
 * No API key. Cloud Run's own service identity is used, via the metadata
 * server, so there is no bearer credential to leak, rotate, or accidentally
 * commit. Gemini spend also lands inside the same GCP project as everything
 * else, which means one budget and one usage graph rather than two.
 *
 * Deliberately dependency-free: the metadata server is a plain HTTP endpoint,
 * and google-auth-library would be another package to bundle around (see the
 * Firestore gRPC bundling problem in the Dockerfile).
 */

import type { GeminiTransport } from "./gemini.js";

const METADATA_ROOT = "http://metadata.google.internal/computeMetadata/v1";
const METADATA_HEADERS = { "Metadata-Flavor": "Google" };

/**
 * Newest Gemini Flash available on Vertex in asia-southeast1. Probed rather
 * than assumed: gemini-3.6-flash exists on AI Studio but 404s here, and Vertex
 * model availability is region-specific. Re-probe before bumping.
 */
export const VERTEX_DEFAULT_MODEL = "gemini-3.5-flash";

/** Matches Cloud Run's region, which keeps inference in-country. */
export const VERTEX_DEFAULT_LOCATION = "asia-southeast1";

interface CachedToken {
  value: string;
  expiresAt: number;
}

export interface VertexConfig {
  projectId: string;
  location: string;
  model: string;
}

export class VertexAuth {
  private token: CachedToken | null = null;

  /** Tokens last about an hour; a 60s margin avoids racing the expiry. */
  async accessToken(now = Date.now()): Promise<string> {
    if (this.token && now < this.token.expiresAt - 60_000) return this.token.value;

    const response = await fetch(`${METADATA_ROOT}/instance/service-accounts/default/token`, {
      headers: METADATA_HEADERS,
    });
    if (!response.ok) {
      throw new Error(`Metadata server returned ${response.status} for an access token`);
    }

    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.token = {
      value: body.access_token,
      expiresAt: now + body.expires_in * 1000,
    };
    return this.token.value;
  }
}

export async function detectProjectId(): Promise<string | null> {
  const explicit = process.env["GOOGLE_CLOUD_PROJECT"] ?? process.env["GCP_PROJECT"];
  if (explicit) return explicit;

  try {
    const response = await fetch(`${METADATA_ROOT}/project/project-id`, {
      headers: METADATA_HEADERS,
    });
    return response.ok ? (await response.text()).trim() : null;
  } catch {
    return null;
  }
}

export function vertexUrl(config: VertexConfig, model = config.model): string {
  return (
    `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.projectId}` +
    `/locations/${config.location}/publishers/google/models/${model}:generateContent`
  );
}

/**
 * The production transport. Vertex accepts the same generateContent body as
 * AI Studio — contents, systemInstruction, tools, generationConfig — so only
 * the URL and the auth header differ.
 */
export function vertexTransport(config: VertexConfig): GeminiTransport {
  const auth = new VertexAuth();
  return {
    name: "vertex",
    model: config.model,
    async request(override?: string) {
      const token = await auth.accessToken();
      return {
        // Model availability on Vertex is region-specific — re-probe before
        // relying on any override here.
        url: vertexUrl(config, override ?? config.model),
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      };
    },
  };
}

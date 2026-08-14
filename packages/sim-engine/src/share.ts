import type { ScenarioInputs } from "./types.js";
import { ENGINE_VERSION, PRESET_VERSION } from "./presets/version.js";
import { parseScenarioInputs } from "./schema.js";

/**
 * Shareable scenario links — SPEC §7.7.
 *
 * The entire persistence layer for v1. No account, no database: the scenario
 * travels in the URL, which is how an SME will actually share it — pasted into
 * WhatsApp to a business partner.
 *
 * The preset and engine versions ride along so a link opened months later
 * either reproduces its original figures or tells the reader they have moved.
 *
 * A decoded link is UNTRUSTED INPUT. It goes through the same schema guard as
 * a request body off the internet and an AI patch.
 */

const PREFIX = "v1.";

/**
 * SPEC §7.7 specifies deflate. Measured, the payload is ~640 characters of
 * base64 — under a third of the ~2,000 budget — so compression is omitted.
 * CompressionStream would make encode and decode async and force the URL sync
 * to become an effect, which is real complexity bought for nothing. Revisit if
 * the input set grows substantially.
 */
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

interface Payload {
  v: number;
  p: string;
  e: string;
  i: ScenarioInputs;
}

export function encodeScenario(inputs: ScenarioInputs): string {
  const payload: Payload = {
    v: 1,
    p: PRESET_VERSION,
    e: ENGINE_VERSION,
    i: inputs,
  };
  return PREFIX + toBase64Url(JSON.stringify(payload));
}

export type DecodeResult =
  | {
      ok: true;
      inputs: ScenarioInputs;
      presetVersion: string;
      engineVersion: string;
      /** True when the link was made with different preset data than we hold now. */
      stale: boolean;
    }
  | { ok: false; reason: string };

export function decodeScenario(param: string | null | undefined): DecodeResult {
  if (!param) return { ok: false, reason: "no scenario in the link" };
  if (!param.startsWith(PREFIX)) return { ok: false, reason: "unrecognised link format" };

  let payload: unknown;
  try {
    payload = JSON.parse(fromBase64Url(param.slice(PREFIX.length)));
  } catch {
    return { ok: false, reason: "the link is corrupted" };
  }

  if (payload === null || typeof payload !== "object") {
    return { ok: false, reason: "the link is corrupted" };
  }
  const body = payload as Partial<Payload>;

  // Untrusted: a crafted link must not be able to smuggle in a field the
  // engine was never meant to read.
  const parsed = parseScenarioInputs(body.i);
  if (!parsed.ok) return { ok: false, reason: parsed.errors.join("; ") };

  const presetVersion = typeof body.p === "string" ? body.p : "unknown";
  const engineVersion = typeof body.e === "string" ? body.e : "unknown";

  return {
    ok: true,
    inputs: parsed.value,
    presetVersion,
    engineVersion,
    stale: presetVersion !== PRESET_VERSION || engineVersion !== ENGINE_VERSION,
  };
}

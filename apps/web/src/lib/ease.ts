import gsap from "gsap";
import { CustomEase } from "gsap/CustomEase";

/**
 * The signature curve, registered once for the whole app.
 *
 * `cubic-bezier(0.4, 0, 0.2, 1)` — the Premium archetype: elegant, minimal, no
 * overshoot. One curve carries most of the motion in this product so it reads
 * as designed rather than assembled, which was the single most valuable thing
 * the motion-design audit surfaced.
 *
 * THIS MODULE EXISTS BECAUSE THE FAILURE IS SILENT. GSAP's core does NOT parse
 * a `cubic-bezier(...)` string, and passing one falls back to a default ease
 * with no warning; a named ease that was never registered does the same. It
 * lived inside the simulator's thinking component, which only the simulator
 * loads, so the first other page to ask for `spotential-premium` would have
 * animated on the wrong curve and looked fine. Importing this module is what
 * makes the name real.
 *
 * `CustomEase` is free from GSAP 3.11 and already ships inside the installed
 * package. Verified rather than assumed: sampled at quarter points the
 * registered curve agrees with the CSS bezier to three decimals, and the CSS
 * side is `--ease-premium`.
 */

gsap.registerPlugin(CustomEase);
CustomEase.create("spotential-premium", "M0,0 C0.4,0 0.2,1 1,1");

export const PREMIUM = "spotential-premium";

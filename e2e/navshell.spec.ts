import { expect, test, type Page } from "@playwright/test";

/**
 * The navy chrome — navbar and footer — measured from the PAINTED PIXELS.
 *
 * The capsule is navy and the mobile drawer directly below it is deliberately
 * white, so every colour in this one component has two possible grounds. Two
 * bugs shipped from exactly that, and neither was visible in the stylesheet:
 *
 *   - the drawer's "Log in" inherited the capsule's white and rendered at
 *     1.00:1 on the white panel;
 *   - the app-wide `button:hover` (0,1,1) outranked `.nav-burger` (0,1,0) and
 *     painted the near-white `--surface` behind three white bars, so the close
 *     affordance vanished in the state a phone leaves it in after a tap.
 *
 * Reading `getComputedStyle` catches neither reliably: the capsule's ground is
 * a gradient, which reports `backgroundColor: rgba(0,0,0,0)`, so a walk up the
 * ancestors sails past the navy and reports white. So this screenshots each
 * control and measures the luminance range actually on screen. Both bugs were
 * reinstated behind an injected stylesheet to confirm this file fails on them
 * — 7.69 -> 1.00 and 7.49 -> 1.05 — because a guard that would not have caught
 * the bug it was written for is worth nothing.
 */

const AA_TEXT = 4.5;
/** WCAG's floor for a meaningful non-text graphic, which is what the bars are. */
const AA_GRAPHIC = 3;

/** Decodes a screenshot in the page and returns its p1-to-p99 contrast range. */
function inkRange(dataUrl: string): Promise<number> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(-1);
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const channel = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      const lums: number[] = [];
      for (let i = 0; i < data.length; i += 4) {
        lums.push(
          0.2126 * channel(data[i]!) + 0.7152 * channel(data[i + 1]!) + 0.0722 * channel(data[i + 2]!),
        );
      }
      lums.sort((a, b) => a - b);
      // p1/p99 rather than min/max: a single stray edge pixel should not stand
      // in for the ink, but real text is far more than 1% of a content box.
      const at = (p: number) => lums[Math.min(lums.length - 1, Math.floor(p * (lums.length - 1)))]!;
      resolve(Math.round(((at(0.99) + 0.05) / (at(0.01) + 0.05)) * 100) / 100);
    };
    img.onerror = () => resolve(-1);
    img.src = dataUrl;
  });
}

/**
 * Measures one control.
 *
 * `inset` shrinks the sample toward the centre. A round button's content box
 * still includes corners showing whatever sits behind it, and that dark
 * capsule was enough to mask a white-on-white burger entirely — 0.18 keeps the
 * sample inside the circle so it reports the button's own fill.
 */
async function ink(page: Page, selector: string, inset = 0): Promise<number> {
  // The clip is viewport-relative, so the subject has to be ON screen before
  // its rect is read — a footer column measured from below the fold crops a
  // blank region and reports it as a uniform patch with no contrast.
  await page.locator(selector).first().scrollIntoViewIfNeeded();

  const clip = await page.evaluate(
    ([sel, pad]) => {
      const el = document.querySelector(sel as string);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const n = (v: string) => parseFloat(v) || 0;
      let box: { x: number; y: number; width: number; height: number };

      /**
       * Where the ink actually is.
       *
       * A short label in a wide row is a tiny fraction of its own content box
       * — "Events" is about 1.4% of a 348x44 drawer row — so a 1% tail lands
       * in the antialiasing rather than on the glyph and reports 3.08 for
       * text that is plainly readable. A Range over the element's contents
       * gives the tight text rect; padding it by 3px keeps enough background
       * in the sample for the other end of the range to be the ground.
       */
      const text = (el.textContent ?? "").trim();
      if (text) {
        const range = document.createRange();
        range.selectNodeContents(el);
        const t = range.getBoundingClientRect();
        range.detach();
        const pad = 3;
        box = { x: t.x - pad, y: t.y - pad, width: t.width + 2 * pad, height: t.height + 2 * pad };
      } else {
        const r = el.getBoundingClientRect();
        const left = n(cs.paddingLeft) + n(cs.borderLeftWidth);
        const right = n(cs.paddingRight) + n(cs.borderRightWidth);
        const top = n(cs.paddingTop) + n(cs.borderTopWidth);
        const bottom = n(cs.paddingBottom) + n(cs.borderBottomWidth);
        box = {
          x: r.x + left,
          y: r.y + top,
          width: r.width - left - right,
          height: r.height - top - bottom,
        };
      }
      const p = pad as number;
      if (p > 0) {
        const ix = box.width * p;
        const iy = box.height * p;
        box = { x: box.x + ix, y: box.y + iy, width: box.width - 2 * ix, height: box.height - 2 * iy };
      }
      const onScreen =
        box.y >= 0 &&
        box.x >= 0 &&
        box.y + box.height <= window.innerHeight &&
        box.x + box.width <= window.innerWidth;
      return box.width > 1 && box.height > 1 && onScreen ? box : null;
    },
    [selector, inset] as const,
  );

  expect(clip, `${selector} is not fully on screen, so nothing can be measured`).not.toBeNull();
  const shot = await page.screenshot({ clip: clip! });
  return page.evaluate(inkRange, `data:image/png;base64,${shot.toString("base64")}`);
}

/**
 * Waits for an element and every ancestor to finish animating.
 *
 * Both surfaces here enter under GSAP — the capsule on mount, the footer on
 * an IntersectionObserver — so a screenshot taken on arrival catches them at
 * opacity 0 and reports a uniform patch of page background as "no contrast".
 * Polling the resolved state says what it is waiting for, which a fixed
 * timeout against an animation does not.
 */
async function settled(page: Page, selector: string) {
  await expect
    .poll(
      () =>
        page.evaluate((sel) => {
          const targets = [...document.querySelectorAll(sel)];
          if (!targets.length) return `${sel} matched nothing`;

          const blocking: string[] = [];
          for (const target of targets) {
            let node: Element | null = target;
            while (node && node !== document.documentElement) {
              const cs = getComputedStyle(node);
              const moving =
                cs.transform !== "none" && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(cs.transform);
              if (parseFloat(cs.opacity) < 0.999 || moving) {
                blocking.push(
                  `${node.tagName.toLowerCase()}.${String(node.className).split(" ")[0]}` +
                    ` opacity=${cs.opacity} transform=${cs.transform}`,
                );
              }
                node = node.parentElement;
            }
          }

          /**
           * CSS transitions count as "in flight" too, and they are easy to
           * miss because nothing about the element looks animated.
           * `.ft-col ul a` carries `transition: color 0.18s`, so switching to
           * print media does not repaint the links black — it TWEENS them
           * from white to black, and a read taken partway through reports
           * rgba(228,228,228,0.8), which is neither value and fails every
           * assertion written against either.
           */
          for (const anim of document.getAnimations()) {
            if (anim.playState !== "running") continue;
            const el = (anim as unknown as { effect?: { target?: Element } }).effect?.target;
            if (el && targets.some((t) => t === el || t.contains(el) || el.contains(t))) {
              blocking.push(`transition on ${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`);
            }
          }

          // Reported rather than reduced to a boolean: "never settled" gave no
          // way to tell a stuck tween from a selector that matched nothing.
          return blocking.length ? [...new Set(blocking)].join(" | ") : "settled";
        }, selector),
      { message: `${selector} kept animating`, timeout: 8000 },
    )
    .toBe("settled");
}

async function open(page: Page, path: string, width: number) {
  await page.route("https://maps.googleapis.com/**", (route) => route.abort());
  await page.setViewportSize({ width, height: 900 });
  await page.goto(path);
  await page.locator(".navbar").waitFor();
}

test.describe("the navy capsule", () => {
  test("every label on it stays legible against the navy", async ({ page }) => {
    await open(page, "/simulator", 1280);

    for (const sel of [
      ".nav-wordmark",
      ".nav-link[data-active='true']",
      ".navbar .nav-login",
      ".navbar .nav-signup",
    ]) {
      await settled(page, sel);
      expect(await ink(page, sel), sel).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  test("the burger stays visible in the state a tap leaves it in", async ({ page }) => {
    await open(page, "/simulator", 420);
    const burger = page.locator(".nav-burger");
    await burger.waitFor();

    await settled(page, ".nav-burger");
    expect(await ink(page, ".nav-burger", 0.18), "at rest").toBeGreaterThanOrEqual(AA_GRAPHIC);

    // A tap on a phone leaves the control hovered, so this is the state it
    // spends most of its visible life in — and the one that broke.
    await burger.hover();
    await settled(page, ".nav-burger");
    expect(await ink(page, ".nav-burger", 0.18), "while hovered").toBeGreaterThanOrEqual(AA_GRAPHIC);
  });

  test("the white drawer does not inherit the capsule's white text", async ({ page }) => {
    await open(page, "/simulator", 420);
    await page.getByRole("button", { name: /menu/i }).click();
    await page.locator(".nav-collapse .nav-login").waitFor({ state: "visible" });
    // The panel animates open; measure it settled, not mid-tween.
    await expect
      .poll(async () => (await page.locator(".nav-collapse").boundingBox())?.height ?? 0)
      .toBeGreaterThan(200);

    /**
     * The whole panel settles before anything is measured.
     *
     * Its links and buttons ride one staggered timeline, so waiting on the
     * first of them proves nothing about the last — and interleaving a
     * screenshot between the two left the trailing button reported at
     * opacity 0.818 for the rest of the test. Verified separately against a
     * production build that the animation does complete on its own in ~700ms
     * with nothing interrupting it, so this is the measurement getting in the
     * way of the animation rather than a defect in the drawer.
     */
    await settled(page, ".nav-collapse .nav-link, .nav-collapse .nav-actions > *");

    for (const sel of [
      ".nav-collapse .nav-link",
      ".nav-collapse .nav-login",
      ".nav-collapse .nav-signup",
    ]) {
      expect(await ink(page, sel), `${sel} on the white panel`).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });
});

test("the footer's own text stays legible on navy", async ({ page }) => {
  await open(page, "/simulator", 1280);
  await page.locator("footer.footer").scrollIntoViewIfNeeded();

  for (const sel of [".ft-blurb", ".ft-col h2", ".ft-col ul a", ".ft-sources li", ".ft-base p"]) {
    await settled(page, sel);
    expect(await ink(page, sel), sel).toBeGreaterThanOrEqual(AA_TEXT);
  }
});

test("the printed attribution is readable ink, not white on white", async ({ page }) => {
  await open(page, "/simulator", 1280);
  await page.emulateMedia({ media: "print" });

  /**
   * Wait for the switch to actually land in the renderer.
   *
   * `emulateMedia` returns before styles are recalculated, and evaluating
   * straight after it reads the SCREEN values — `matchMedia("print")` already
   * answers true while `getComputedStyle` still reports the navy. That gap is
   * what made this test claim the printed links were white on white when a
   * render taken a moment later shows them black on white. Poll a value only
   * the print block sets, rather than trusting the call to have taken effect.
   */
  await expect
    .poll(() =>
      page.evaluate(
        () => getComputedStyle(document.querySelector("footer.footer")!).backgroundColor,
      ),
    )
    .toMatch(/rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)/);

  await settled(page, ".ft-sources a, .ft-sources li, .ft-data h2, .ft-base p");

  /**
   * Computed colours here, pixels everywhere else in this file — and the
   * difference is principled rather than convenient.
   *
   * The pixel measurement exists because the capsule's ground is a GRADIENT,
   * which reports `backgroundColor: rgba(0,0,0,0)` and makes a computed-style
   * walk useless. Print removes that ground entirely: the footer is plain ink
   * on plain paper by construction, so the two colours are exactly what
   * `getComputedStyle` reports. The test asserts that construction too — if
   * the navy background ever survives into print, `ground` stops being white
   * and the ratios move with it.
   *
   * (Playwright's own screenshot of this subtree under print emulation comes
   * back blank even though the DOM, the computed colours and a screenshot
   * taken outside the runner are all correct, so pixels are not available
   * here regardless.)
   *
   * The bug this guards: `.ft-col ul a` is (0,1,2) and outranked the print
   * block's `.footer a` (0,1,1), so both licence links printed white on
   * white — present in the DOM, and absent from the paper.
   */
  const seen = await page.evaluate(() => {
    const lum = (c: string) =>
      (c.match(/[\d.]+/g) || [])
        .slice(0, 3)
        .map(Number)
        .map((v) => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        })
        .reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i]!, 0);
    const ratio = (fg: string, bg: string) => {
      const a = lum(fg);
      const b = lum(bg);
      return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100;
    };

    const footer = document.querySelector("footer.footer")!;
    const ground = getComputedStyle(footer).backgroundColor;
    const out: Record<string, number | string> = { ground };
    for (const sel of [".ft-data h2", ".ft-sources li", ".ft-sources a", ".ft-base p"]) {
      const el = document.querySelector(sel);
      out[sel] = el ? ratio(getComputedStyle(el).color, "rgb(255,255,255)") : "MISSING";
    }
    return out;
  });

  // The navy has to be gone, or none of the ratios below mean anything.
  expect(seen["ground"]).toMatch(/rgba\(0, 0, 0, 0\)|rgb\(255, 255, 255\)/);

  for (const [sel, ratio] of Object.entries(seen)) {
    if (sel === "ground") continue;
    expect(ratio, `${sel} in print`).not.toBe("MISSING");
    expect(ratio as number, `${sel} in print`).toBeGreaterThanOrEqual(AA_TEXT);
  }

  // And the decoration is gone, so the credits are what actually prints.
  await expect(page.locator("footer.footer").getByRole("link", { name: "Find events" })).toBeHidden();
  await expect(page.locator(".ft-logo")).toBeHidden();
});

test.describe("what follows the scroll", () => {
  /**
   * `position: sticky` sticks only inside its CONTAINING BLOCK, and the shell's
   * is `#root`. With `html, body, #root { height: 100% }` that box was exactly
   * one viewport tall while the document ran far past it, so the navbar pinned
   * for the first screenful and then scrolled away — indistinguishable, to
   * anyone using the page, from not being sticky at all. Reading the
   * stylesheet would not have caught it: the rule said `sticky` and meant it.
   */
  /**
   * `/compare` is empty until it is given somewhere to compare, and an empty
   * page cannot answer a question about scrolling — so it is loaded the way a
   * shared link would arrive, with two real locations in it.
   */
  const ROUTES = [
    "/events",
    "/simulator",
    "/analysis",
    "/compare?c=korean_restaurant&r=500&p=3.1478,101.6953,Central+KL&p=3.1073,101.6067,Suburban+PJ",
    "/heatmap",
  ];

  for (const route of ROUTES) {
    const label = route.split("?")[0];
    test(`the navbar stays pinned all the way down ${label}`, async ({ page }) => {
      await page.route("https://maps.googleapis.com/**", (r) => r.abort());
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(route);
      await page.locator(".navbar-shell").waitFor();

      // POLL for the page to grow, do not read it once. Every one of these
      // routes fetches after first paint, and measuring the moment the header
      // exists reported /events as a single screenful — which would have
      // skipped the page the report was actually about.
      await expect
        .poll(
          () => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight),
          { message: `${label} never became scrollable`, timeout: 10000 },
        )
        .toBeGreaterThan(200);

      // Well past one viewport — the point the old containing block gave out.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight - window.innerHeight - 40));
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
      );

      const top = await page.evaluate(
        () => Math.round(document.querySelector(".navbar-shell")!.getBoundingClientRect().top),
      );
      expect(top, `navbar left the top of ${label}`).toBe(0);
    });
  }

  test("the events control band scrolls away with the page", async ({ page }) => {
    await page.route("https://maps.googleapis.com/**", (r) => r.abort());
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/events");
    await page.locator(".filterbar").waitFor();

    // Wait for the list, or the page is too short to scroll far enough to
    // tell a pinned bar from one that simply has not moved yet.
    await page.locator(".evc").first().waitFor();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
      .toBeGreaterThan(600);

    // It used to pin under the navbar. Two bars competing for the top of the
    // screen cost the results the room the bar exists to give them.
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight - window.innerHeight),
    );
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null)))),
    );

    const [bar, navbar] = await page.evaluate(() => [
      Math.round(document.querySelector(".filterbar")!.getBoundingClientRect().bottom),
      Math.round(document.querySelector(".navbar-shell")!.getBoundingClientRect().top),
    ]);

    // Off the top of the screen entirely — not merely lower down.
    expect(bar, "the control band is still on screen").toBeLessThan(0);
    // And the header it used to sit under is still there, which is the point.
    expect(navbar, "the navbar did not stay pinned").toBe(0);
  });

  test("an open filter dropdown still paints above the cards below it", async ({ page }) => {
    await page.route("https://maps.googleapis.com/**", (r) => r.abort());
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/events");
    await page.locator(".sel-trigger").first().waitFor();

    /**
     * Dropping `sticky` also drops the positioning context, and with it the
     * z-index that lifts the bar over cards that come AFTER it in the DOM —
     * grid items paint in DOM order, so a plain `static` bar would put every
     * panel underneath the results. The bar stays `relative` for that reason.
     */
    const count = await page.locator(".sel-trigger").count();
    for (let i = 0; i < count; i++) {
      await page.locator(".sel-trigger").nth(i).click();
      await page.locator(".sel.is-open .sel-panel").waitFor();
      await expect
        .poll(() =>
          page.evaluate(() => {
            const panel = document.querySelector(".sel.is-open .sel-panel");
            if (!panel) return "no panel";
            const r = panel.getBoundingClientRect();
            const hit = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height - 4, 40));
            return panel.contains(hit) ? "on top" : `covered by ${hit?.className || hit?.tagName}`;
          }),
        )
        .toBe("on top");
      await page.keyboard.press("Escape");
    }
  });
});

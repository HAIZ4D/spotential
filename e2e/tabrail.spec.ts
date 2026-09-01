import { expect, test, type Page } from "@playwright/test";
import { openSection } from "./sections.js";

/**
 * The Location page's tab rail.
 *
 * Written after a bug the whole existing suite was blind to. The rail is
 * `display: flex` with `overflow-x: auto`, and the tabs carried a `min-width`
 * — so the default `flex-shrink: 1` squashed EVERY tab to that minimum, and
 * the widest label plus its badge overflowed its own button and painted over
 * the next tab's first letter. "People" rendered as "eople".
 *
 * Nothing caught it because every assertion in the suite is name-based, and an
 * accessible name is unaffected by a label being covered by a sibling. Only
 * geometry sees this, so these tests measure boxes.
 */

const MAPS = "https://maps.googleapis.com/**";

async function stub(page: Page) {
  await page.route(MAPS, (route) => route.abort());
  await page.route("**/v1/competitors", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        competitors: [],
        summary: {
          total: 20,
          averageRating: 4.3,
          ratedCount: 18,
          totalReviews: 5600,
          nearestMetres: 40,
          operational: 19,
        },
        density: [{ upToMetres: 500, count: 20 }],
        fromCache: true,
        fetchedAt: Date.now(),
        radiusMetres: 500,
        // A truncated search gives the widest possible badge ("20+"), which is
        // the case that actually overflowed.
        truncated: true,
        completeToMetres: 421,
        searchSkipped: false,
        placesConfigured: true,
      }),
    }),
  );
  for (const path of ["**/v1/opportunity-gaps", "**/v1/demographics"]) {
    await page.route(path, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
  }

  /**
   * Settle the AI panel, which sits directly ABOVE the rail.
   *
   * Left to reach the real service it resolves at its own pace, and the panel
   * grows when it does — which moves the rail after a `boundingBox()` has been
   * taken and leaves `mouse.move()` hovering whatever slid into that spot.
   * That is a real page behaviour, but it is not what these tests are about,
   * so it is made deterministic rather than waited out.
   */
  await page.route("**/v1/location/brief", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "ai_unavailable", message: "Not configured here." }),
    }),
  );
}

const AT_KL = "/analysis?lat=3.1478&lng=101.6953&q=Kuala%20Lumpur";

test("no tab's content overflows its own button", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);
  await expect(page.getByRole("tab", { name: /^Competition/ })).toBeVisible();

  /**
   * Measured against the CHILDREN's boxes, not `scrollWidth`.
   *
   * `scrollWidth` was the obvious check and it is the wrong one: a button with
   * `overflow: visible` is not a scroll container, so it reports no horizontal
   * overflow no matter how far its content spills. Reinstating the bug proved
   * that — the assertion passed while the label was visibly covering its
   * neighbour. Child rectangles are what actually paint.
   */
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".tab")]
      .map((el) => {
        const box = el.getBoundingClientRect();
        const spill = [...el.children]
          .map((child) => child.getBoundingClientRect())
          .filter((r) => r.width > 0)
          .reduce((worst, r) => Math.max(worst, r.right - box.right, box.left - r.left), 0);
        return { label: el.textContent?.trim() ?? "", spill: Math.round(spill) };
      })
      .filter((t) => t.spill > 1)
      .map((t) => `${t.label} spills ${t.spill}px past its own button`),
  );
  expect(overflowing).toEqual([]);
});

test("the sliding thumb lands on the active tab, not near it", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);

  for (const section of ["Competition", "Rent", "Overview"] as const) {
    await openSection(page, section);

    /**
     * The thumb is measured off the live element rather than computed from an
     * assumed equal-width grid — badges make these tabs genuinely different
     * widths. A 1px tolerance covers sub-pixel layout and the tween's final
     * frame; anything larger means it is tracking something else.
     */
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const thumb = document.querySelector(".tab-thumb")?.getBoundingClientRect();
            const active = document
              .querySelector('.tab[aria-selected="true"]')
              ?.getBoundingClientRect();
            if (!thumb || !active) return null;
            return Math.max(Math.abs(thumb.x - active.x), Math.abs(thumb.width - active.width)) < 1;
          }),
        { message: `thumb did not settle on ${section}` },
      )
      .toBe(true);
  }
});

test("exactly one tab is selected, and its badge stays legible", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);
  await openSection(page, "Competition");

  await expect(page.locator('.tab[aria-selected="true"]')).toHaveCount(1);

  /**
   * Wait for the badge to EXIST before measuring it.
   *
   * The first version measured straight after the click and read a transient
   * mid-load state — the competitors response had not landed, so the tab
   * carried no figure yet and the reading was of something else entirely.
   * Same class as the debounce race already written up in the gotchas: poll
   * for the value, never sleep towards it.
   */
  const badge = page.locator('.tab[aria-selected="true"] .tab-badge');
  await expect(badge).toHaveText("20+");

  /**
   * Polled, because the badge CROSSFADES.
   *
   * Selecting a tab tweens the badge's text from navy to white while its
   * background tweens from the soft tint to navy, and for a few frames in the
   * middle those two are genuinely close — a single reading taken right after
   * the click measured 1.35:1 and called it a defect. 160ms of crossfade is
   * not a legibility failure; a badge that SETTLES illegible is. So this waits
   * for the value to stop moving, exactly as the debounce gotcha prescribes.
   *
   * Navy rather than gold, incidentally: gold is the CTA colour and Sign up
   * already owns it, so a gold badge here would put two "act on me" signals on
   * one screen. Same call the navbar pill made.
   */
  await expect
    .poll(() =>
      badge.evaluate((el) => {
        const style = getComputedStyle(el);
        const parse = (s: string) => (s.match(/\d+/g) ?? []).slice(0, 3).map(Number);
        const lum = ([r, g, b]: number[]) => {
          const f = (v: number) => {
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
        };
        const [hi, lo] = [lum(parse(style.color)), lum(parse(style.backgroundColor))].sort(
          (a, b) => b - a,
        );
        return (hi! + 0.05) / (lo! + 0.05);
      }),
    )
    .toBeGreaterThanOrEqual(4.5);
});

test("the tabs fill the capsule instead of bunching to one side", async ({ page }) => {
  await stub(page);
  // Every data route failing is the sparse case: no badges, so the labels are
  // at their narrowest and the row is most likely to leave dead space.
  for (const path of ["**/v1/competitors", "**/v1/demographics", "**/v1/opportunity-gaps"]) {
    await page.route(path, (route) =>
      route.fulfill({ status: 503, contentType: "application/json", body: "{}" }),
    );
  }
  await page.goto(AT_KL);
  await expect(page.getByRole("tab", { name: /^Overview/ })).toBeVisible();

  const fit = await page.evaluate(() => {
    const rail = document.querySelector(".tabs")!;
    const tabs = [...rail.querySelectorAll(".tab")];
    const box = rail.getBoundingClientRect();
    return {
      leftGap: tabs[0]!.getBoundingClientRect().left - box.left,
      rightGap: box.right - tabs.at(-1)!.getBoundingClientRect().right,
      overflows: rail.scrollWidth > rail.clientWidth + 1,
    };
  });

  /**
   * `flex-grow` spreads the spare width, so the last tab should finish at the
   * track's own padding rather than short of it. Skipped when the labels are
   * genuinely wider than the rail (a phone), where the rail scrolls instead —
   * `flex-shrink: 0` is what keeps that from squashing them back into the
   * overflow bug above.
   */
  if (!fit.overflows) {
    expect(Math.abs(fit.rightGap - fit.leftGap)).toBeLessThanOrEqual(2);
  }
});

test("the navy capsule keeps every label legible on its new ground", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);
  await openSection(page, "Competition");

  /**
   * Recolouring the track navy gave every colour inside it a NEW ground, which
   * is the trap that once rendered a white button on a white panel at 1.00:1.
   * The active label is dark-on-gold and the idle ones are white-on-navy, so
   * they fail in opposite directions and both need checking.
   *
   * Polled, because selecting a tab crossfades the label colour.
   */
  const contrast = (selector: string, ground: [number, number, number]) =>
    page.locator(selector).first().evaluate((el, bg) => {
      const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      const lum = ([r, g, b]: number[]) => {
        const f = (v: number) => {
          const c = v / 255;
          return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
      };
      const [hi, lo] = [lum(parse(getComputedStyle(el).color)), lum(bg)].sort((a, b) => b - a);
      return (hi! + 0.05) / (lo! + 0.05);
    }, ground);

  // The track's own navy, and the thumb's gold, sampled as the gradients paint.
  await expect.poll(() => contrast('.tab[aria-selected="false"]', [0, 47, 121])).toBeGreaterThanOrEqual(4.5);
  await expect.poll(() => contrast('.tab[aria-selected="true"]', [246, 174, 12])).toBeGreaterThanOrEqual(4.5);
});

test("a hovered tab keeps its label readable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "no hover on a touch device");
  await stub(page);
  await page.goto(AT_KL);

  const tab = page.getByRole("tab", { name: /^People/ });
  await expect(tab).toBeVisible();
  // The panel above has stopped growing once this renders.
  await expect(page.locator(".ai-unavailable")).toBeVisible();

  /**
   * SCROLL, then measure, then place the pointer, then capture. In that order.
   *
   * Two separate races live here. Hovering before measuring loses the hover,
   * because measuring can scroll and any scroll leaves the mouse somewhere
   * else — that version passed happily with the bug reinstated. And measuring
   * before scrolling yields viewport coordinates for an element below the
   * fold, so `mouse.move()` lands on nothing: the Spotential AI panel now sits
   * above this rail and pushed it off the first screen.
   */
  await tab.scrollIntoViewIfNeeded();
  const box = (await tab.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(tab).toHaveCSS("color", "rgb(255, 255, 255)");

  /**
   * INSET, because the tab is a pill on a navy rail.
   *
   * Its rounded ends show the capsule behind them, and those corner pixels are
   * dark enough to supply the whole luminance range on their own: the full box
   * reported a comfortable 13.37:1 for a hover state that was actually
   * rendering white text on a near-white panel. Sampling the pill's interior
   * reports the truth — 1.05:1 — which is the same correction the navbar spec
   * already had to make for its round buttons.
   */
  const sample = {
    x: box.x + box.width * 0.22,
    y: box.y + box.height * 0.18,
    width: box.width * 0.56,
    height: box.height * 0.64,
  };
  const shot = (await page.screenshot({ clip: sample })).toString("base64");

  /**
   * The bug this guards: the app-wide `button:hover` (0,1,1) sets
   * `background: var(--surface)`, and the tab's own hover rule set only
   * `color`. A light panel painted behind white text on a navy capsule and the
   * label vanished — the fourth control in this app to lose to that exact
   * selector, and on a phone it is worse still, because a tap leaves the
   * control hovered.
   */
  const contrast = await page.evaluate(
    (b64) =>
      new Promise<number>((resolve) => {
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
            const c = v / 255;
            return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
          };
          const lums: number[] = [];
          for (let i = 0; i < data.length; i += 4) {
            lums.push(
              0.2126 * channel(data[i]!) +
                0.7152 * channel(data[i + 1]!) +
                0.0722 * channel(data[i + 2]!),
            );
          }
          lums.sort((a, b) => a - b);
          const at = (q: number) => lums[Math.floor(q * (lums.length - 1))]!;
          resolve((at(0.99) + 0.05) / (at(0.01) + 0.05));
        };
        img.onerror = () => resolve(-1);
        img.src = "data:image/png;base64," + b64;
      }),
    shot,
  );

  expect(contrast).toBeGreaterThanOrEqual(4.5);
});

test("the thumb slides in one direction without being interrupted", async ({ page }) => {
  await stub(page);
  await page.goto(AT_KL);
  await expect(page.getByRole("tab", { name: /^Overview/ })).toBeVisible();

  await page.evaluate(() => {
    (window as never as Record<string, unknown>)["__f"] = [];
    const tick = () => {
      const t = document.querySelector(".tab-thumb");
      const rail = document.querySelector(".tabs");
      const w = window as never as Record<string, unknown>;
      /**
       * Position within the rail's CONTENT, not the viewport.
       *
       * On a narrow screen the rail also scrolls to centre the chosen tab, and
       * that carries the thumb the other way — so a viewport-relative reading
       * mixes two motions and reports reversals for a slide that is perfectly
       * smooth. Adding `scrollLeft` back isolates the tween itself.
       */
      if (t && rail) {
        (w["__f"] as number[]).push(
          t.getBoundingClientRect().x - rail.getBoundingClientRect().x + rail.scrollLeft,
        );
      }
      w["__r"] = requestAnimationFrame(tick);
    };
    tick();
  });

  // The furthest tab from Overview, which is what makes the travel worth
  // measuring. It was "Ask" until that tab moved into the page itself.
  await page.getByRole("tab", { name: /^Gaps/ }).click();
  await page.waitForTimeout(900);

  /**
   * A REVERSAL MEANS THE TWEEN WAS RESTARTED, which is what the stutter was.
   * The effect depended on `tabs`, an array rebuilt every render, so each
   * arriving figure re-ran it and `gsap.to` began again from wherever the
   * thumb had reached; the ResizeObserver then `gsap.set` it to the end
   * mid-flight. Neither is visible in a screenshot — only the per-frame path
   * shows it, so this samples every frame and asserts the travel is monotonic.
   */
  const path = await page.evaluate(() => {
    const w = window as never as Record<string, unknown>;
    cancelAnimationFrame(w["__r"] as number);
    const frames = w["__f"] as number[];
    const steps = frames
      .slice(1)
      .map((v, i) => v - frames[i]!)
      .filter((d) => Math.abs(d) > 0.01);
    const signs = steps.map(Math.sign);
    return {
      moved: Math.abs((frames.at(-1) ?? 0) - (frames[0] ?? 0)),
      reversals: signs.filter((sign, i) => i > 0 && sign !== signs[i - 1]).length,
    };
  });

  expect(path.moved).toBeGreaterThan(50);
  expect(path.reversals).toBe(0);
});

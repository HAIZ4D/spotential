import { expect, type Page } from "@playwright/test";

/**
 * The location page shows one section at a time.
 *
 * It used to stack every panel into one long scroll, which is why so many
 * tests could assert on any panel straight after navigating. Now the sections
 * live behind a tab bar, so a test has to open the one it is about — the same
 * click a user makes.
 *
 * Worth being explicit rather than hiding it in a fixture: a test that forgets
 * to open its section fails loudly instead of quietly asserting against a
 * panel that is simply not rendered.
 */
export type Section = "Overview" | "Competition" | "People" | "Rent" | "Gaps" | "Ask";

export async function openSection(page: Page, section: Section): Promise<void> {
  const tab = page.getByRole("tab", { name: new RegExp(`^${section}`) });
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Navigate to the location page and open a section in one step. */
export async function gotoSection(page: Page, url: string, section: Section): Promise<void> {
  await page.goto(url);
  await openSection(page, section);
}

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const NOW = new Date('2026-10-30T21:00:00Z');

async function open(page: Page, hash = '') {
  await page.clock.setFixedTime(NOW);
  await page.goto(`./${hash}`);
  await expect(page.getByRole('heading', { name: 'Feed' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Event feed' }).getByRole('listitem').first()).toBeVisible();
}

/** WCAG 2.2 A/AA rules; violations are reported with their targets so failures are actionable. */
async function audit(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}${v.nodes.length > 3 ? ` (+${v.nodes.length - 3})` : ''}`);
}

test('main view has no WCAG A/AA violations', async ({ page }) => {
  await open(page);
  expect(await audit(page)).toEqual([]);
});

test('investigation panel has no WCAG A/AA violations', async ({ page }) => {
  await open(page, '#/node/cve%3ACVE-2026-111357');
  await expect(page.getByRole('complementary', { name: 'Investigation' }).getByRole('group', { name: 'Relationship graph' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test('sources dialog has no WCAG A/AA violations', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: /Sources/ }).click();
  await expect(page.getByRole('dialog', { name: 'Data sources' }).getByRole('table')).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test('stories view has no WCAG A/AA violations', async ({ page }) => {
  await open(page);
  await page.getByRole('group', { name: 'Side panel view' }).getByRole('button', { name: 'Stories' }).click();
  await page.getByRole('region', { name: 'Story list' }).getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'How the story unfolded' })).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

test.describe('phone width', () => {
  test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

  test('has no horizontal scrolling and keeps feed and investigation usable', async ({ page }) => {
    await open(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    // The map must keep a usable size (it once collapsed to a thin strip at this width).
    const map = (await page.getByRole('group', { name: 'World map of geolocated events' }).boundingBox())!;
    expect(map.width).toBeGreaterThan(300);
    expect(map.height).toBeGreaterThan(150);
    await expect(page.getByRole('img', { name: /^Activity from/ })).toBeVisible();
    await page.getByRole('region', { name: 'Event feed' }).getByRole('listitem').first().getByRole('button').click();
    const panel = page.getByRole('complementary', { name: 'Investigation' });
    await expect(panel).toBeVisible();
    await expect(panel).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(await audit(page)).toEqual([]);
  });
});

test.describe('keyboard only', () => {
  test('skip link moves focus to the feed', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to feed' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#feed')).toBeFocused();
  });

  test('map markers are one Tab stop with arrow-key navigation', async ({ page }) => {
    await open(page);
    const markers = page.locator('g.point, g.vendor-hq');
    const count = await markers.count();
    expect(count).toBeGreaterThan(2);
    // Exactly one marker is in the Tab order.
    expect(await page.locator('g.point[tabindex="0"], g.vendor-hq[tabindex="0"]').count()).toBe(1);
    await page.locator('g.point[tabindex="0"], g.vendor-hq[tabindex="0"]').focus();
    const first = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    await page.keyboard.press('ArrowRight');
    const second = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    expect(second).not.toBe(first);
    await expect(page.getByRole('tooltip')).toBeVisible(); // focus shows the same tooltip as hover
    await page.keyboard.press('Enter');
    const panel = page.getByRole('complementary', { name: 'Investigation' });
    await expect(panel.getByRole('heading', { level: 2 })).toBeFocused();
    // Escape closes the panel and returns focus to the marker that opened it.
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toBe(second);
  });

  test('zoom controls work from the keyboard', async ({ page }) => {
    await open(page);
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    await expect(zoomOut).toBeDisabled();
    await page.getByRole('button', { name: 'Zoom in' }).press('Enter');
    await expect(zoomOut).toBeEnabled();
    await page.getByRole('button', { name: 'Reset map view' }).press('Enter');
    await expect(zoomOut).toBeDisabled();
  });

  test('graph neighbours are navigable with arrow keys', async ({ page }) => {
    await open(page, '#/node/cve%3ACVE-2026-111357');
    const panel = page.getByRole('complementary', { name: 'Investigation' });
    const nodes = panel.getByRole('group', { name: 'Relationship graph' }).getByRole('button');
    await expect(nodes.first()).toBeVisible();
    expect(await panel.locator('g.gnode[tabindex="0"]').count()).toBe(1);
    await panel.locator('g.gnode[tabindex="0"]').focus();
    await page.keyboard.press('End');
    const name = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText(name!.split(': ').slice(1).join(': '));
  });

  test('sources dialog traps focus and Escape returns to the opener', async ({ page }) => {
    await open(page);
    const opener = page.getByRole('button', { name: /Sources/ });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Data sources' });
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    for (let i = 0; i < 40; i++) await page.keyboard.press('Tab');
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });
});

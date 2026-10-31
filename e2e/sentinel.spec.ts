import { expect, test, type Page } from '@playwright/test';

/** The seeded fixtures are from 2026-10-30; freeze the browser clock so "last 7 days" covers them. */
const NOW = new Date('2026-10-30T21:00:00Z');
const IVANTI_CVE = 'Ivanti Connect Secure Missing Authentication for Critical Function Vulnerability';

async function open(page: Page, hash = '') {
  await page.clock.setFixedTime(NOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`./${hash}`);
  await expect(page.getByRole('heading', { name: 'Feed' })).toBeVisible();
  return errors;
}

const feed = (page: Page) => page.getByRole('region', { name: 'Event feed' });
const feedItems = (page: Page) => feed(page).getByRole('listitem');
const investigation = (page: Page) => page.getByRole('complementary', { name: 'Investigation' });
const category = (page: Page, name: RegExp) => page.getByRole('group', { name: 'Categories' }).getByRole('button', { name });

test('loads map, feed and timeline without errors', async ({ page }, info) => {
  const errors = await open(page);
  await expect(page.locator('.brand')).toContainText('SENTINEL');
  await expect(feedItems(page).first()).toBeVisible();
  expect(await feedItems(page).count()).toBeGreaterThan(5);
  // Earthquakes and EONET events sit at their source coordinates.
  expect(await page.locator('g.point').count()).toBeGreaterThan(0);
  await expect(page.getByRole('img', { name: /^Activity from/ })).toBeVisible();
  await expect(page.getByText('Vulnerabilities are not mapped', { exact: false }).or(page.getByText('vendor headquarters', { exact: false }))).toBeVisible();
  if (info.project.name === 'static') await expect(page.getByText(/snapshot · /)).toBeVisible();
  expect(errors).toEqual([]);
});

test('filters by category and search', async ({ page }) => {
  await open(page);
  await category(page, /Vulnerability/).click();
  await category(page, /News & tech/).click();
  await expect(category(page, /World event/)).toHaveAttribute('aria-pressed', 'true');
  await expect(category(page, /Vulnerability/)).toHaveAttribute('aria-pressed', 'false');
  await expect(feedItems(page).first()).toBeVisible();
  // Only world events remain.
  for (const pill of await feed(page).locator('.pill').allTextContents()) {
    expect(['EARTHQUAKE', 'WILDFIRE', 'SEVERE STORM', 'VOLCANO', 'FLOOD', 'DROUGHT']).toContain(pill.toUpperCase());
  }
  await category(page, /Vulnerability/).click();
  await category(page, /News & tech/).click();
  await page.getByLabel('Search').fill('ivanti');
  await expect(feed(page).getByText(IVANTI_CVE)).toBeVisible();
  await expect(feed(page).getByText(/M \d\.\d/)).toHaveCount(0);
});

test('switches feed order', async ({ page }) => {
  await open(page);
  const order = page.getByRole('group', { name: 'Feed order' });
  await expect(order.getByRole('button', { name: 'Mixed' })).toHaveAttribute('aria-pressed', 'true');
  // Mixed takes one item from each category in turn.
  const firstThree = async () => (await feed(page).locator('.feed-item').evaluateAll((els) => els.slice(0, 3).map((e) => e.className)));
  expect(new Set((await firstThree()).map((c) => /type-(\w+)/.exec(c)?.[1])).size).toBe(3);
  await order.getByRole('button', { name: 'Top' }).click();
  await expect(order.getByRole('button', { name: 'Top' })).toHaveAttribute('aria-pressed', 'true');
  // Top puts the KEV-listed CVE first among vulnerabilities.
  await expect(feed(page).locator('.feed-item.type-vulnerability').first()).toContainText(IVANTI_CVE);
});

test('investigates a vulnerability and follows the graph', async ({ page }) => {
  await open(page);
  await page.getByLabel('Search').fill('ivanti');
  await feed(page).getByText(IVANTI_CVE).click();
  const panel = investigation(page);
  await expect(panel.getByRole('heading', { name: IVANTI_CVE })).toBeVisible();
  await expect(panel.getByText('KEV', { exact: true })).toBeVisible();
  await expect(panel.getByText('No location reported by source')).toBeVisible();
  await expect(panel.getByText(/reported · cisa-kev/).first()).toBeVisible();
  await expect(panel.getByRole('link', { name: 'CISA Known Exploited Vulnerabilities' })).toBeVisible();
  await expect(page).toHaveURL(/#\/node\/cve%3ACVE-2026-111357$/);

  // Graph → product → vendor, then back.
  const graph = panel.getByRole('group', { name: 'Relationship graph' });
  await expect(graph).toBeVisible();
  await panel.getByRole('button', { name: /^Connect Secure — Product: Ivanti Connect Secure$/ }).press('Enter');
  await expect(panel.getByRole('heading', { name: 'Ivanti Connect Secure' })).toBeVisible();
  await panel.getByRole('button', { name: 'Ivanti — Vendor: Ivanti' }).press('Enter');
  await expect(panel.getByRole('heading', { name: 'Ivanti', exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Wikidata Q4042416' })).toBeVisible();
  await expect(panel.getByText('Headquarters: South Jordan, United States (Wikidata)')).toBeVisible();
  await panel.getByRole('button', { name: 'Back' }).click();
  await expect(panel.getByRole('heading', { name: 'Ivanti Connect Secure' })).toBeVisible();
  await panel.getByRole('button', { name: 'Close investigation' }).click();
  await expect(investigation(page)).toHaveCount(0);
});

test('deep links straight into an investigation', async ({ page }) => {
  await open(page, '#/node/cve%3ACVE-2026-111357');
  await expect(investigation(page).getByRole('heading', { name: IVANTI_CVE })).toBeVisible();
});

test('opens a map point and shows source coordinates', async ({ page }) => {
  await open(page);
  const point = page.locator('g.point[data-id^="quake:"]').first();
  await point.click();
  const panel = investigation(page);
  await expect(panel.getByText(/\(source coordinates\)/)).toBeVisible();
  await expect(panel.getByRole('link', { name: 'USGS Earthquake Hazards Program' })).toBeVisible();
});

test('shows vendor headquarters for vulnerabilities in the window', async ({ page }) => {
  await open(page);
  const diamond = page.locator('[data-vendor="vendor:ivanti"]');
  await expect(diamond).toHaveAttribute('aria-label', /Ivanti headquarters, South Jordan/);
  await diamond.hover();
  await expect(page.getByRole('tooltip')).toContainText('Vendor headquarters · Wikidata');
  await page.getByLabel('Vendor HQs').uncheck();
  await expect(page.locator('[data-vendor]')).toHaveCount(0);
});

test('brushes the timeline to narrow the window', async ({ page }) => {
  await open(page);
  const before = await feedItems(page).count();
  const box = (await page.getByRole('img', { name: /^Activity from/ }).boundingBox())!;
  // Select the last ~12% of the 7-day window (roughly the final day).
  await page.mouse.move(box.x + box.width * 0.88, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByText('Click the chart to clear the selection')).toBeVisible();
  await expect(page.getByText(/→/).first()).toBeVisible();
  await expect.poll(() => feedItems(page).count()).toBeLessThanOrEqual(before);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText('Drag across the chart to focus a time window')).toBeVisible();
});

test('lists sources with mode-appropriate actions', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: /Sources/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Data sources' });
  await expect(dialog.getByRole('link', { name: 'CISA Known Exploited Vulnerabilities' })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Wikidata (vendor headquarters)' })).toBeVisible();
  // The fixture router answers GDELT with HTTP 429, which must be visible, not hidden.
  await expect(dialog.getByText('HTTP 429', { exact: false }).first()).toBeVisible();
  if (info.project.name === 'static') {
    await expect(dialog.getByText(/Static snapshot generated/)).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Refresh all sources' })).toHaveCount(0);
  } else {
    await expect(dialog.getByRole('button', { name: 'Refresh all sources' })).toBeVisible();
  }
});

test('shows GitHub advisories with affected packages', async ({ page }) => {
  await open(page);
  await page.getByLabel('Search').fill('electrum');
  const item = feed(page).getByText(/Electrum: Malicious server/);
  await expect(item).toBeVisible();
  await expect(feed(page).locator('.badge', { hasText: 'GHSA' }).first()).toBeVisible();
  await item.click();
  const panel = investigation(page);
  await expect(panel.getByRole('link', { name: 'GHSA-6jp4-8v48-cc5v' })).toBeVisible();
  await expect(panel.getByText('pip electrum')).toBeVisible();
  await expect(panel.getByText(/fixed in 4\.8\.3/)).toBeVisible();
  await expect(panel.getByRole('group', { name: 'Relationship graph' }).getByRole('button', { name: /electrum \(pip\)/ })).toBeVisible();
});

test('shows GDACS alerts and does not pin multi-country droughts to a point', async ({ page }) => {
  await open(page, '');
  await page.getByRole('button', { name: '30d' }).click();
  await page.getByLabel('Search').fill('Drought in Andorra');
  await feed(page).getByText(/Drought in Andorra/).click();
  const panel = investigation(page);
  await expect(panel.getByText(/Not shown as a point: affects \d+ countries \(GDACS\)/)).toBeVisible();
  await expect(panel.getByText('GDACS Orange', { exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'GDACS report' })).toBeVisible();
  // It is in the feed but not on the map.
  await expect(page.locator('g.point[data-id^="gdacs:DR"]')).toHaveCount(0);
});

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/** Clusters, selection lines and timeline playback (the map features built on the chart redesign). */
const NOW = new Date('2026-10-30T21:00:00Z');
const IVANTI = '#/node/cve%3ACVE-2026-111357?w=30d';

async function open(page: Page, hash = '#/?w=30d') {
  await page.clock.setFixedTime(NOW);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(`./${hash}`);
  // With an item open on a phone the feed is hidden, so wait for the map instead.
  await expect(page.getByRole('group', { name: 'World map of geolocated events' })).toBeVisible();
  return errors;
}

async function audit(page: Page) {
  // Let entrance animations (dialog fade-in, line fade-in) finish so colours are sampled at rest; looping ones are ignored.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished.catch(() => {}))));
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
  return results.violations.map((v) => `${v.id} (${v.impact}): ${v.help} → ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
}

const map = (page: Page) => page.getByRole('group', { name: 'World map of geolocated events' });
const panel = (page: Page) => page.getByRole('complementary', { name: 'Investigation' });
const activeLabel = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null);

test.describe('clusters', () => {
  test('nearby events merge into a labelled ring that splits when zoomed in', async ({ page }) => {
    const errors = await open(page);
    const clusters = map(page).locator('g.cluster');
    await expect(clusters.first()).toBeVisible();
    const before = await clusters.count();
    await expect(clusters.first()).toHaveAttribute('aria-label', /^\d+ events near .+\(.+: \d+.*\)\. Zooms in/);
    await clusters.first().click();
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    // Fully zoomed out again, everything merges back.
    await page.getByRole('button', { name: 'Reset map view' }).click();
    await expect(clusters).toHaveCount(before);
    // At maximum zoom nothing merges.
    for (let i = 0; i < 8; i++) await page.getByRole('button', { name: 'Zoom in' }).click();
    await expect(clusters).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('clusters are in the roving focus, and Enter zooms in and focuses an event from it', async ({ page }) => {
    await open(page);
    const markers = map(page).locator('g.point, g.vendor-hq, g.cluster');
    expect(await map(page).locator('[data-key][tabindex="0"]').count()).toBe(1);
    await map(page).locator('[data-key][tabindex="0"]').focus();
    const total = await markers.count();
    let label: string | null = null;
    for (let i = 0; i < total; i++) {
      label = await activeLabel(page);
      if (label && /events near/.test(label)) break;
      await page.keyboard.press('ArrowRight');
    }
    expect(label).toMatch(/^\d+ events near/);
    await expect(page.getByRole('tooltip')).toContainText('nearby events');
    const members = Number(/^(\d+)/.exec(label!)![1]);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    // Focus moved to one of the cluster's events (or a smaller group of them), not lost to the page.
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('g.point, g.cluster') !== null)).toBe(true);
    const now = await activeLabel(page);
    if (now && /events near/.test(now)) expect(Number(/^(\d+)/.exec(now)![1])).toBeLessThan(members);
  });
});

test.describe('selection lines', () => {
  test('draw solid blue to vendor HQs and dashed magenta to reporting countries, with a text list and a switch', async ({ page }) => {
    const errors = await open(page, IVANTI);
    await expect(panel(page).getByRole('heading', { level: 2 })).toBeVisible();
    const lines = page.getByTestId('selection-lines');
    const reported = lines.locator('path.link-reported[data-link="vendor:ivanti"]');
    const inferred = lines.locator('path.link-inferred[data-link^="country:"]');
    await expect(reported).toHaveCount(1);
    await expect(inferred.first()).toBeAttached();
    expect(await reported.evaluate((el) => getComputedStyle(el).strokeDasharray)).toBe('none');
    expect(await inferred.first().evaluate((el) => getComputedStyle(el).strokeDasharray)).not.toBe('none');
    // Lines leave from a port on the panel's left edge, next to its heading.
    const port = (await lines.locator('.link-port').boundingBox())!;
    const box = (await panel(page).boundingBox())!;
    const heading = (await panel(page).getByRole('heading', { level: 2 }).boundingBox())!;
    expect(Math.abs(port.x + port.width / 2 - box.x)).toBeLessThan(3);
    expect(port.y).toBeGreaterThan(heading.y - 12);
    expect(port.y).toBeLessThan(heading.y + heading.height);
    await expect(page.getByTestId('links-note')).toContainText('headquarters of Ivanti');
    await expect(page.getByTestId('links-note')).toContainText('publisher countries');

    await page.getByRole('checkbox', { name: 'Selection links' }).uncheck();
    await expect(lines).toHaveCount(0);
    await expect(page).toHaveURL(/off=links/);
    await page.getByRole('checkbox', { name: 'Selection links' }).check();
    await expect(reported).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('a located event connects from its own point', async ({ page }, info) => {
    test.skip(info.project.name === 'static', 'Needs to intercept the live API to give an event coverage');
    await page.route('**/api/nodes/quake*', async (route) => {
      const res = await route.fetch();
      const body = await res.json();
      body.edges.push({
        src: 'news:fake', dst: body.node.id, rel: 'mentions', basis: 'inferred', confidence: 0.8, rationale: 'test', sourceId: 'test', observedAt: '',
        direction: 'in', other: { id: 'news:fake', type: 'article', title: 'Quake felt', occurredAt: body.node.occurredAt, category: 'news', publisherCountry: 'Japan', outlet: 'example' },
      });
      await route.fulfill({ response: res, json: body });
    });
    await page.clock.setFixedTime(NOW);
    const id = await page.request.get('/api/map').then(async (r) => ((await r.json()).points as { id: string }[]).find((p) => p.id.startsWith('quake:'))!.id);
    // Deep link to a quake (it may sit inside a cluster on the map); once open it is always its own point.
    await open(page, `#/node/${encodeURIComponent(id)}?w=30d`);
    await expect(panel(page).getByRole('heading', { level: 2 })).toBeVisible();
    const point = map(page).locator(`g.point[data-id="${id}"]`);
    await expect(point).toBeVisible();
    const lines = page.getByTestId('selection-lines');
    await expect(lines.locator('path.link-inferred[data-link="country:Japan"]')).toHaveCount(1);
    const port = (await lines.locator('.link-port-point').boundingBox())!;
    const p = (await point.boundingBox())!;
    expect(Math.abs(port.x + port.width / 2 - (p.x + p.width / 2))).toBeLessThan(3);
    expect(Math.abs(port.y + port.height / 2 - (p.y + p.height / 2))).toBeLessThan(3);
  });

  test.describe('phone width', () => {
    test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
    test('keeps the map above the investigation and draws lines from its bottom edge', async ({ page }) => {
      await open(page, IVANTI);
      await expect(panel(page).getByRole('heading', { level: 2 })).toBeVisible();
      await expect(map(page)).toBeVisible();
      const lines = page.getByTestId('selection-lines');
      await expect(lines.locator('path.link-reported')).toHaveCount(1);
      const m = (await map(page).boundingBox())!;
      const port = (await lines.locator('.link-port').boundingBox())!;
      expect(Math.abs(port.y + port.height / 2 - (m.y + m.height))).toBeLessThan(4);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
      expect(await audit(page)).toEqual([]);
    });
  });
});

test.describe('timeline playback', () => {
  const brushLabel = (page: Page) => page.locator('.view-bar .muted.small').textContent();

  test('plays the range forward from the keyboard and pauses', async ({ page }) => {
    await open(page);
    const play = page.getByRole('group', { name: 'Timeline playback' }).getByRole('button', { name: 'Play' });
    await play.focus();
    await page.keyboard.press('Enter');
    const pause = page.getByRole('button', { name: 'Pause playback' });
    await expect(pause).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Playing' })).toBeAttached();
    await expect(page.locator('.timeline rect.brush')).toBeVisible();
    const first = await brushLabel(page);
    expect(first).toContain('→');
    await expect.poll(() => brushLabel(page), { timeout: 5000 }).not.toBe(first);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'Playback paused' })).toBeAttached();
    // Step controls move one step at a time.
    const paused = await brushLabel(page);
    await page.getByRole('button', { name: 'Step forward' }).press('Enter');
    await expect.poll(() => brushLabel(page)).not.toBe(paused);
    // The step is its own history entry, but the whole playback run is just one: two Backs return to the unbrushed view.
    await page.goBack();
    await expect.poll(() => brushLabel(page)).toBe(paused);
    await page.goBack();
    await expect(page.locator('.timeline rect.brush')).toHaveCount(0);
  });

  test('under reduced motion the brush jumps instead of sliding', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await page.getByRole('button', { name: 'Play' }).click();
    const brush = page.locator('.timeline rect.brush');
    await expect(brush).toBeVisible();
    expect(await brush.evaluate((el) => getComputedStyle(el).transitionDuration)).toBe('0s');
    await page.getByRole('button', { name: 'Pause playback' }).click();
  });
});

test.describe('night chart', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.getItem('sentinel.theme') ?? localStorage.setItem('sentinel.theme', 'night'));
  });

  test('clusters, selection lines and playback controls have no WCAG A/AA violations', async ({ page }) => {
    await open(page, IVANTI);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
    await expect(page.getByTestId('selection-lines').locator('path.link-reported')).toHaveCount(1);
    await expect(map(page).locator('g.cluster').first()).toBeVisible();
    await page.getByRole('button', { name: 'Play' }).click();
    await expect(page.getByRole('button', { name: 'Pause playback' })).toBeVisible();
    expect(await audit(page)).toEqual([]);
    await page.getByRole('button', { name: 'Pause playback' }).click();
  });
});

test('day chart: clusters, selection lines and playback controls have no WCAG A/AA violations', async ({ page }) => {
  await open(page, IVANTI);
  await expect(page.getByTestId('selection-lines').locator('path.link-reported')).toHaveCount(1);
  await expect(map(page).locator('g.cluster').first()).toBeVisible();
  expect(await audit(page)).toEqual([]);
});

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFile } from 'node:fs/promises';

test('the tour exposes real phase results, complete diffs and downloadable provenance', async ({ page }) => {
  const errors = [],
    externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4198') externalRequests.push(request.url());
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Evolve the Harness,\s*Not the Model\./);
  await expect(page.locator('tfoot')).toContainText('56.25%');
  await page.getByRole('radio', { name: 'Independent validation', exact: true }).check();
  await expect(page.locator('caption')).toContainText('Independent validation');
  await expect(page.locator('tfoot')).toHaveText('Mean · full denominator81.25%100%');
  await page.getByRole('radio', { name: 'Original-package reuse', exact: true }).check();
  await expect(page.locator('tbody tr')).toHaveCount(4);
  await expect(page.locator('tfoot')).toHaveText('Mean · full denominator100%');
  await page.locator('.source-diff summary').click();
  await expect(page.locator('.source-diff')).toContainText("name: 'workbook_recalculate'");
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download case data' }).click();
  const download = await downloadPromise;
  const data = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(data.search.map((arm) => arm.mean)).toEqual([0.5625, 0.8125, 1]);
  expect(data.reuse.candidate).toBe(data.validation[1].candidate);
  expect(data.archiveHash).toBe('ac305a51e28c9f0d68c7f80df6b7e3c6eb9fc3fa3cacd25458a2ff2fdb3b12c7');
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

for (const width of [320, 390, 768, 1440]) {
  test(`readable at ${width}px with no page overflow or automated accessibility violations`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.locator('.source-diff summary').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(scan.violations).toEqual([]);
    await page.locator('.source-diff summary').click();
    await page.screenshot({ path: testInfo.outputPath('tour.png'), fullPage: true });
  });
}

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the recorded search results and evidence links remain readable', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('tfoot')).toContainText('56.25%');
    await expect(
      page.getByText(/Phase switching requires JavaScript\. All phases are available/),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download case data' })).toBeVisible();
  });
});

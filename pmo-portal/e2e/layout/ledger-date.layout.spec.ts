// @e2e-isolation: read-only — rewrites only the READ response of the procurement bundle in the browser (page.route); no seed row is written.
/**
 * #2290: a bill the ledger posted on another date shows that date in the Date cell; the entered date stays
 * reachable (a muted second line and the cell title) and no date wraps, at phone and desktop widths.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';

const PROC_SHOWCASE = '61000000-0000-0000-0000-000000000001';

function moveLedgerDates(node: unknown): void {
  if (Array.isArray(node)) { node.forEach(moveLedgerDates); return; }
  if (!node || typeof node !== 'object') return;
  const rec = node as Record<string, unknown>;
  // a bill (invoice_date) or a payment (pay_number + date): the ledger posts it two days later
  const d = typeof rec.invoice_date === 'string' ? rec.invoice_date : typeof rec.pay_number === 'string' && typeof rec.date === 'string' ? rec.date : null;
  if (d) rec.erp_posting_date = new Date(Date.parse(d.slice(0, 10)) + 2 * 86_400_000).toISOString().slice(0, 10);
  Object.values(rec).forEach(moveLedgerDates);
}

async function openLedger(page: Page) {
  await page.route('**/rest/v1/procurements?*', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch({ maxRetries: 2 });
    let body: unknown;
    try { body = await response.json(); } catch { return route.fulfill({ response }); }
    moveLedgerDates(body);
    await route.fulfill({ response, json: body });
  });
  await signIn(page, 'admin@acme.test');
  for (const tab of ['files', 'timeline']) {
    await page.goto(`/procurement/${PROC_SHOWCASE}/${tab}`);
    await waitForFonts(page);
    if (await page.getByTestId('ledger-date').first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false)) return;
  }
}

for (const width of [390, 1440] as const) {
  test(`@layout #2290: the entered date stays reachable and no ledger/entered date wraps at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openLedger(page);
    const cell = page.getByTestId('ledger-date').first();
    await expect(cell).toBeVisible();
    const entered = cell.getByTestId('ledger-date-entered');
    await expect(entered).toBeVisible();
    await expect(entered).toHaveText(/^(Entered|Dimasukkan) \S+/);
    await expect(cell).toHaveAttribute('title', /\S+/);
    // a date never breaks: each date line is one text line
    for (const id of ['ledger-date-value', 'ledger-date-entered']) {
      const line = cell.getByTestId(id);
      const oneLine = await line.evaluate((el) => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height;
        return el.getBoundingClientRect().height <= lh * 1.2;
      });
      expect(oneLine, `${id} is one line at ${width}px`).toBe(true);
    }
    const box = await cell.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
  });
}

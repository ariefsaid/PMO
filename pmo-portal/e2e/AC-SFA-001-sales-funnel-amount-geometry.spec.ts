// @e2e-isolation: read-only — reads the seeded Sales Pipeline summary and measures rendered boxes.
/**
 * AC-SFA-001 — Sales Pipeline summary amounts stay inside their stage at the 768px desktop
 * breakpoint. The summary is a read-only disclosure; only its named horizontal scroll region and
 * the disclosure control are keyboard stops.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

const LONG_AMOUNT_SHAPE = /\d{1,3}(?:[.,]\d{3})+/u;
const FUNNEL_VIEWPORT_WIDTH = 768;

async function openSummary(page: Page) {
  await page.getByText('Pipeline summary', { exact: true }).click();
  await expect(page.locator('[data-testid="sales-summary"]')).toHaveAttribute('open', '');
  await expect(page.locator('[data-funnel-stage]')).toHaveCount(5);
}

test.describe('AC-SFA-001 sales summary amount geometry at the 768px desktop breakpoint', () => {
  test('AC-SFA-001: stage amounts stay inside their own stage; the page does not pan at 768px', async ({ page }) => {
    await page.setViewportSize({ width: FUNNEL_VIEWPORT_WIDTH, height: 844 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/sales');
    await openSummary(page);
    await waitForFonts(page);

    const stageSummaries = await page.locator('[data-funnel-stage]').evaluateAll((stages) => stages.map((stage) => ({
      head: stage.querySelector(':scope > div')?.textContent ?? '',
      amount: stage.querySelector('[data-funnel-stage-amount]')?.textContent?.trim() ?? '',
    })));
    expect(
      stageSummaries.some(({ head, amount }) => (head.includes('IDR') || head.includes('USD')) && LONG_AMOUNT_SHAPE.test(amount)),
      `expected a single-currency stage head and grouped whole-unit amount, got: ${JSON.stringify(stageSummaries)}`,
    ).toBe(true);
    expect(
      stageSummaries.some(({ head, amount }) => !head.includes('IDR') && !head.includes('USD') && amount === '—'),
      `mixed-currency stage must remain unavailable, got: ${JSON.stringify(stageSummaries)}`,
    ).toBe(true);

    const idrProbeAmounts = await page.evaluate(() => {
      const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(1_250_000_000_000);
      const texts: string[] = [];
      document.querySelectorAll('[data-funnel-stage-amount]').forEach((el) => {
        el.textContent = idr;
        texts.push(idr);
      });
      return texts;
    });
    expect(idrProbeAmounts).toHaveLength(5);

    const containment = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-funnel-stage]'), (stage) => {
      const amount = stage.querySelector<HTMLElement>('[data-funnel-stage-amount]')!;
      return { stage: stage.getBoundingClientRect().toJSON(), amount: amount.getBoundingClientRect().toJSON() };
    }));
    for (const [index, { stage, amount }] of containment.entries()) {
      expect(amount.x, `stage ${index} amount starts outside its stage`).toBeGreaterThanOrEqual(stage.x - 1);
      expect(amount.x + amount.width, `stage ${index} amount ends outside its stage`).toBeLessThanOrEqual(stage.x + stage.width + 1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(FUNNEL_VIEWPORT_WIDTH + 2);
  });

  test('AC-SFA-005: keyboard users can reach overflowed summary values through its named scroll region', async ({ page }) => {
    await page.setViewportSize({ width: FUNNEL_VIEWPORT_WIDTH, height: 844 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/sales');
    await openSummary(page);
    await waitForFonts(page);
    await page.evaluate(() => {
      const idr = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR' }).format(1_250_000_000_000);
      document.querySelectorAll('[data-funnel-stage-amount]').forEach((amount) => { amount.textContent = idr; });
    });

    const scrollArea = page.getByRole('group', { name: 'Stage summary, scrollable horizontally' });
    const overflow = await scrollArea.evaluate((el) => (el as HTMLElement).scrollWidth - (el as HTMLElement).clientWidth);
    expect(overflow, 'long values overflow only the local summary viewport').toBeGreaterThan(0);
    await scrollArea.focus();
    await expect(scrollArea).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scrollArea.evaluate((el) => (el as HTMLElement).scrollLeft)).toBeGreaterThan(0);
  });

  test('AC-SFA-007: the summary disclosure has a visible keyboard focus indicator', async ({ page }) => {
    await page.setViewportSize({ width: FUNNEL_VIEWPORT_WIDTH, height: 844 });
    await signIn(page, 'admin@acme.test');
    await page.goto('/sales');
    const disclosure = page.locator('[data-testid="sales-summary"] > summary');
    await disclosure.focus();
    await page.keyboard.press('Enter');
    await expect(disclosure).toBeFocused();
    await expect(page.locator('[data-funnel-stage]')).toHaveCount(5);
    const focusStyle = await disclosure.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { style: computed.outlineStyle, width: parseFloat(computed.outlineWidth) || 0 };
    });
    expect(focusStyle.style).not.toBe('none');
    expect(focusStyle.width).toBeGreaterThan(0);
  });
});

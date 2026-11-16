// @e2e-isolation: read-only — the seeded project's budget reads are answered with eleven-digit rupiah
// figures at the route boundary and the geometry is measured; nothing is written to the database.
/**
 * #2426 — the Budget route with an eleven-digit rupiah figure in every money cell
 * (budget, spent, committed, left) at 390 and 1440, in English and Bahasa: no figure is cut off and
 * none leaves its row, its card or the page.
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';
import { expectNoHorizontalOverflow } from '../support/layout-oracles';
import { forceLocale } from '../support/financial-statement-fixtures';

test.setTimeout(120_000);

const MERIDIAN = '41000000-0000-0000-0000-000000000001';
const BUDGET_LINE = 98_765_432_101; // eleven digits
const SPENT_LINE = 49_382_716_050; // eleven digits
const COMMITTED = 32_921_810_700; // eleven digits

type Json = Record<string, unknown>;

/** Fetch the real response, then answer it with `patch` applied. */
async function patched(route: Route, patch: (body: any) => unknown) {
  const response = await route.fetch();
  const body: unknown = await response.json();
  await route.fulfill({ response, json: patch(body) as object });
}

function rupiahVersions(rows: Json[]) {
  return rows.map((row) => {
    const lines = (row.line_items as Json[]).map((line) => ({ ...line, budgeted_amount: BUDGET_LINE }));
    return { ...row, version_row: { ...(row.version_row as Json), currency: 'IDR' }, line_items: lines, total: lines.length * BUDGET_LINE };
  });
}

function rupiahFinances(body: Json) {
  const actuals = body.actuals as Json;
  const categories = (actuals.categories as Json[]).map((c) => (c.mapped ? { ...c, amount: String(SPENT_LINE), tagged_amount: String(SPENT_LINE) } : c));
  const total = String(categories.filter((c) => c.mapped).length * SPENT_LINE);
  const budget = body.budget as Json | null;
  return {
    ...body,
    budget: budget ? { ...budget, currency: 'IDR', amount: String(6 * BUDGET_LINE) } : budget,
    actuals: { ...actuals, currency: 'IDR', categories, total, tagged_total: total },
  };
}

async function answerInRupiah(page: Page) {
  await page.route('**/rest/v1/rpc/budget_version_read**', (route) => patched(route, (rows: Json[]) => rupiahVersions(rows)));
  await page.route('**/rest/v1/rpc/get_project_finances**', (route) => patched(route, (body: Json) => rupiahFinances(body)));
  await page.route('**/rest/v1/rpc/get_project_overview_read**', (route) => patched(route, (rows: Json[]) => rows.map((row) => ({
    ...row,
    finances: rupiahFinances(row.finances as Json),
    budget_versions: rupiahVersions(row.budget_versions as Json[]),
  }))));
  await page.route('**/rest/v1/rpc/project_budget_positions**', (route) => patched(route, (rows: Json[]) => rows.map((row) => ({
    ...row,
    currency: 'IDR',
    budget_currency: 'IDR',
    active_budget_amount: String(6 * BUDGET_LINE),
    spent: String(6 * SPENT_LINE),
    open_commitment: String(6 * COMMITTED),
    consumption: String(6 * SPENT_LINE),
  }))));
  await page.route('**/rest/v1/rpc/procurement_open_commitments**', (route) => patched(route, (rows: Json[]) => rows.map((row) => ({ ...row, amount: COMMITTED }))));
  // Spread the project's procurements over its six budget categories so every category has a committed figure.
  const categories = ['Materials', 'Equipment', 'Subcontractors', 'Labor', 'Permits & Fees', 'Contingency'];
  await page.route('**/rest/v1/procurements?**', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return patched(route, (rows: any) => (Array.isArray(rows) ? rows.map((row: Json, i: number) => (row.project_id === MERIDIAN
      ? { ...row, status: 'Ordered', currency: 'IDR', open_commitment: COMMITTED, budget_category: categories[i % categories.length] }
      : row)) : rows));
  });
  await page.route('**/rest/v1/rpc/get_project_budget**', (route) => route.fulfill({ json: 6 * BUDGET_LINE }));
  await page.route('**/rest/v1/projects?**', async (route) => {
    if (route.request().method() !== 'GET' || !route.request().url().includes(MERIDIAN)) return route.fallback();
    return patched(route, (body: any) => {
      const patch = (o: Json) => (o && o.id === MERIDIAN ? { ...o, currency: 'IDR' } : o);
      return Array.isArray(body) ? body.map(patch) : patch(body);
    });
  });
}

/** Every leaf element that prints eleven or more digits inside the budget table or its phone cards. */
async function measureFigures(page: Page, width: number) {
  return page.evaluate((viewport) => {
    const host = document.querySelector('main') ?? document.body;
    const out: { text: string; clipped: boolean; outsideRow: boolean; outsideViewport: boolean }[] = [];
    for (const el of host.querySelectorAll<HTMLElement>('td *, td, dd *, dd')) {
      if (el.children.length > 0) continue;
      const text = (el.textContent ?? '').trim();
      if ((text.match(/\d/g) ?? []).length < 11 || /%/.test(text)) continue;
      const box = el.getBoundingClientRect();
      const row = el.closest('tr, li, [data-testid="dt-card-branch"] > *') as HTMLElement | null;
      const rowBox = row?.getBoundingClientRect();
      out.push({
        text,
        clipped: el.scrollWidth > el.clientWidth + 1,
        outsideRow: Boolean(rowBox) && (box.left < rowBox!.left - 1 || box.right > rowBox!.right + 1),
        outsideViewport: box.left < -1 || box.right > viewport + 1,
      });
    }
    return out;
  }, width);
}

for (const width of [390, 1440] as const) {
  for (const locale of ['en', 'id'] as const) {
    test(`@layout #2426 budget: eleven-digit rupiah figures fit every money cell at ${width}px in ${locale}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      await answerInRupiah(page);
      await forceLocale(page, locale);
      await signIn(page, 'finance@acme.test');
      await page.goto(`/projects/${MERIDIAN}/budget`);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.getByText(/98[.,]765[.,]432[.,]101/).first()).toBeVisible();
      await waitForFonts(page);
      await expectNoHorizontalOverflow(page);
      const figures = await measureFigures(page, width);
      // Six categories × budget, spent, committed and left: every one of them is on the page.
      expect(figures.length, 'the four money cells of every category print their full figure').toBeGreaterThanOrEqual(24);
      expect(figures.filter((f) => f.clipped || f.outsideRow || f.outsideViewport), 'no figure is cut off or leaves its row').toEqual([]);
    });
  }
}

// @e2e-isolation: read-only — the work orders, their billing figures and the revenue ownership are answered in the
// browser (page.route) and the profile's locale is rewritten on READ only; nothing is written to the shared database.
/**
 * AC-BWO-004 (#785 Discover) — on the project's Work orders tab, beside the record panel, the Invoice action is inside
 * the visible box of the work-order list and nothing scrolls sideways, at 1024 / 1280 / 1440px, in English and Bahasa.
 *
 * WHAT BROKE. At 1024px the record column is ~350px; the four-column table needed ~530px, so it scrolled sideways
 * inside a clipped box — Invoice sat behind a scrollbar nobody saw and the billing words were cut mid-word at the clip.
 * The table now becomes the record cards below 576px (`@xl`) of its OWN width (DataTable `cardBelow`, AC-TBL-CARDS-001).
 *
 * ORACLE: geometry measured in the browser — every visible Invoice button lies within the list's box (table scroller
 * or card list), the table scroller (when there is one) has scrollWidth ≤ clientWidth, and the page itself does not
 * scroll sideways.
 */
import { test, expect, type Page } from '@playwright/test';
import { signIn, waitForFonts } from './helpers';

const PID = '40000000-0000-0000-0000-000000000013';
const ORG = '00000000-0000-0000-0000-000000000001';
const EPSILON = 1;

const wo = (n: number, status: 'Draft' | 'Issued' | 'Closed', value: number, title: string, extra: Record<string, unknown> = {}) => ({
  id: `aaaaaaaa-0000-0000-0000-00000000000${n}`, org_id: ORG, project_id: PID, wo_number: status === 'Draft' ? null : `WO-261007000${n}`,
  client_po_number: status === 'Draft' ? null : `MSW-PO-260${n + 1}`, title, description: null, status, order_value: value,
  currency: 'USD', tax_treatment: 'exclusive', tax_amount: 0, tax_rate: 11, tax_template: null, order_date: '2026-09-14',
  start_date: null, end_date: null, order_value_set_by: null, order_value_set_at: null, issued_by: null,
  issued_at: status === 'Draft' ? null : '2026-09-15T00:00:00Z', over_commit_ack_by: null, over_commit_ack_at: null,
  closed_at: status === 'Closed' ? '2026-10-04T00:00:00Z' : null, cancelled_at: null, created_at: '2026-09-14T00:00:00Z',
  tax_base_numerator: 1, tax_base_denominator: 1, ...extra,
});
const ROWS = [
  wo(5, 'Issued', 50_000, 'Additional string combiner boxes'),
  wo(6, 'Draft', 40_000, 'Variation — cable tray rerouting'),
  wo(3, 'Closed', 120_000, 'Commissioning support'),
  wo(2, 'Issued', 300_000, 'Inverter supply and installation'),
  wo(1, 'Issued', 555_000, 'Roof structural reinforcement, Bays 1–4', { tax_treatment: 'inclusive', tax_amount: 55_000 }),
];
const billing = (r: (typeof ROWS)[number], invoiced: number, pending: number, paid: number) => {
  const net = r.tax_treatment === 'inclusive' ? r.order_value - (r.tax_amount as number) : r.order_value;
  return {
    work_order_id: r.id, org_id: ORG, project_id: PID, status: r.status, currency: 'USD', order_net: net, invoiced, pending,
    paid, remaining: net - invoiced - pending, figures_complete: true, line_count: invoiced || pending ? 1 : 0,
    unpaid_count: invoiced > paid ? 1 : 0,
  };
};
const BILL = [billing(ROWS[0], 60_000, 0, 0), billing(ROWS[1], 0, 0, 0), billing(ROWS[2], 0, 0, 0), billing(ROWS[3], 0, 300_000, 0),
  billing(ROWS[4], 300_000, 50_000, 100_000)];

async function stub(page: Page, bahasa: boolean) {
  await page.route('**/rest/v1/work_orders?**', (r) => (r.request().method() === 'GET' ? r.fulfill({ json: ROWS }) : r.fallback()));
  await page.route('**/rest/v1/work_order_billing?**', (r) => r.fulfill({ json: BILL }));
  await page.route('**/rest/v1/external_domain_ownership?**', (r) =>
    r.fulfill({ json: [{ id: 'own-1', org_id: ORG, external_tier: 'erpnext', domain: 'revenue' }] }));
  // The Invoice action needs a project client; the seed project has one, this only guarantees it on READ.
  await page.route('**/rest/v1/projects?**', async (r) => {
    if (r.request().method() !== 'GET' || !r.request().url().includes(PID)) return r.fallback();
    const res = await r.fetch();
    let body = await res.json();
    const patch = (o: Record<string, unknown>) => (o && o.id === PID ? { ...o, currency: 'USD', client_id: o.client_id ?? '30000000-0000-0000-0000-000000000001' } : o);
    body = Array.isArray(body) ? body.map(patch) : patch(body);
    return r.fulfill({ response: res, json: body });
  });
  if (bahasa) {
    await page.route('**/rest/v1/profiles?*', async (r) => {
      if (r.request().method() !== 'GET' || !/[?&]id=eq\./.test(r.request().url())) return r.fallback();
      const res = await r.fetch();
      let body: unknown;
      try { body = await res.json(); } catch { return r.fulfill({ response: res }); }
      if (body && !Array.isArray(body) && typeof body === 'object' && 'locale' in body) {
        body = { ...(body as Record<string, unknown>), locale: 'id', number_locale: 'id-ID' };
      }
      return r.fulfill({ response: res, json: body });
    });
  }
}

const CASES = [
  { lang: 'English', bahasa: false, invoice: 'Invoice', widths: [1024, 1280, 1440] },
  { lang: 'Bahasa Indonesia', bahasa: true, invoice: 'Tagih', widths: [1024, 1440] },
] as const;

test.describe('AC-BWO-004 work-order billing geometry beside the record panel (#785)', () => {
  for (const { lang, bahasa, invoice, widths } of CASES) {
    for (const width of widths) {
      test(`AC-BWO-004: ${lang} at ${width}px — Invoice is inside the list's visible box and nothing scrolls sideways`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await stub(page, bahasa);
        await signIn(page, 'finance@acme.test');
        await page.goto(`/projects/${PID}/work-orders`);
        if (bahasa) await expect(page.locator('html')).toHaveAttribute('lang', 'id', { timeout: 60_000 });
        await expect(page.getByText('WO-2610070002').first()).toBeVisible({ timeout: 60_000 });
        await expect(page.getByRole('button', { name: invoice }).first()).toBeVisible();
        await waitForFonts(page);

        const m = await page.evaluate((label) => {
          const box = document.querySelector<HTMLElement>('[data-testid="dt-table-branch"], [data-testid="dt-card-branch"]');
          const b = box!.getBoundingClientRect();
          const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')]
            .filter((x) => x.textContent?.trim() === label && x.offsetParent !== null)
            .map((x) => { const r = x.getBoundingClientRect(); return { left: r.left, right: r.right }; });
          return {
            box: { left: b.left, right: b.right },
            buttons,
            scroller: box!.dataset.testid === 'dt-table-branch' ? { scroll: box!.scrollWidth, client: box!.clientWidth } : null,
            page: { scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth },
          };
        }, invoice);

        expect(m.buttons.length, 'expected Invoice on the billable work orders').toBeGreaterThanOrEqual(2);
        const outside = m.buttons.filter((x) => x.left < m.box.left - EPSILON || x.right > m.box.right + EPSILON);
        expect(outside, `Invoice outside the list's visible box ${JSON.stringify(m.box)}`).toEqual([]);
        if (m.scroller) expect(m.scroller.scroll, 'the work-order table scrolls sideways').toBeLessThanOrEqual(m.scroller.client);
        expect(m.page.scroll, 'the page scrolls sideways').toBeLessThanOrEqual(m.page.client);
      });
    }
  }
});

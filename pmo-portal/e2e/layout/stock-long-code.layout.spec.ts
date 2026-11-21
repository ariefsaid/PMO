// @e2e-isolation: self-isolated - seeds its own item, central warehouse, work item and stock; the append-only ledger cannot be cleaned (PQ-10), so every code carries a per-run suffix.
import { test, expect } from '@playwright/test';
import { signIn, waitForFonts } from '../helpers';
import { makeItem, makeWarehouse, postReceive, runSuffix, SEED_PROJECT_ID, userClient } from '../support/stockFixture';

test.setTimeout(180_000);

// AC-STOCK-LAYOUT-004 companion: the seeded codes the main stock layout spec sweeps are short, so its
// red only appears when an EARLIER spec leaves a ledger move whose work-item code is one long
// unbreakable token (a real project code can be long too). This spec seeds exactly that code and
// proves the Project cell wraps it instead of clipping. One width proves the fix: the Project column
// is fixed at 136px wherever it shows (hidden below lg).
test('@layout stock ledger: a long unbreakable work-item code wraps inside the Project column, unclipped @1024', async ({ page }) => {
  const sfx = runSuffix();
  const admin = await userClient('admin@acme.test');
  const item = await makeItem(admin, sfx, 'L');
  const wh = await makeWarehouse(admin, sfx, 'LC', 'central');
  const longCode = `E2E-PIPEMWP${sfx}SEGMENT2XPIPESPOOLRUN07`;
  const boq = await admin.from('boq_items').insert({ project_id: SEED_PROJECT_ID, item_code: longCode, description: `E2E long-code work ${sfx}`, unit: 'm3', quantity: 10, rate: 1000 }).select('id').single();
  expect(boq.error, `boq: ${boq.error?.message ?? ''}`).toBeNull();

  await postReceive(admin, wh.id, item.id, '50');
  // Issue to the seed project against the long-code work item (Admin posts without being a keeper).
  // The ledger entry then carries the project name and the long work-item code in one cell.
  const issue = await admin.rpc('create_stock_document', {
    p_header: { kind: 'issue', warehouse_id: wh.id, project_id: SEED_PROJECT_ID },
    p_lines: [{ item_id: item.id, quantity: '5', boq_item_id: (boq.data as { id: string }).id }],
    p_post: true,
  });
  expect(issue.error, `issue: ${issue.error?.message ?? ''}`).toBeNull();

  await page.setViewportSize({ width: 1024, height: 900 });
  await signIn(page, 'admin@acme.test');
  // Scope the ledger to the seeded item so the measure reads exactly this movement.
  await page.goto(`/stock/ledger?item=${item.id}`);
  await expect(page.getByTestId('stock-ledger-boq-code').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('stock-ledger-boq-code').first()).toHaveText(longCode);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => {});
  await waitForFonts(page);

  const m = await page.evaluate((wantCode) => {
    const ths = [...document.querySelectorAll('table th')];
    const idx = ths.findIndex((h) => /^\s*project\b/i.test(h.textContent ?? ''));
    if (idx < 0) return { found: false } as const;
    const cells = [...document.querySelectorAll('table tbody tr')]
      .map((tr) => tr.children[idx] as HTMLElement | undefined)
      .filter((c): c is HTMLElement => !!c && c.querySelector('[data-testid="stock-ledger-boq-code"]')?.textContent === wantCode);
    const codes = cells.map((c) => c.querySelector('[data-testid="stock-ledger-boq-code"]') as HTMLElement);
    const shown = codes.filter((e) => e.textContent?.trim() && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().width > 0).length;
    // The main spec's oracle: a code is clipped when it overflows its own box or rides past its cell.
    const clipped = codes.filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > (e.closest('td') as HTMLElement).getBoundingClientRect().right + 1).length;
    return { found: true, cells: cells.length, shown, clipped, text: codes[0]?.textContent };
  }, longCode);
  expect(m.found, 'a Project column header must exist at 1024').toBe(true);
  if (!m.found) return;
  expect(m.cells, `the seeded long-code movement is in the ledger: ${JSON.stringify(m)}`).toBe(1);
  expect(m.shown, `the work-item code is shown: ${JSON.stringify(m)}`).toBe(1);
  expect(m.clipped, `the long work-item code must wrap, not clip: ${JSON.stringify(m)}`).toBe(0);
});

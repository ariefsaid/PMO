// @e2e-isolation: self-isolated — a disposable organisation of its own (project, running work order, contract line, stock location and
// item), its Administrator login, and an opening balance for the work order and for the location; the whole organisation is removed in finally.
// JOB-PC14 (project control): opening balances at go-live. The Administrator loads the running work order's progress and claimed value and
// the physical stock count through the same functions the command line tool calls, then reads them back on Finance → Opening balances,
// where the work order shows its progress and billed value and the stock location shows its count, with the totals above.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { need, ok, runId, serviceClient, sqlAsOwner } from './support/jobFixtures';
import { inDays } from './support/jobJourney';
import { removeJobOrganization } from './support/jobRoleUser';
import { openWorkOrderArea } from './support/workOrderArea';

test.setTimeout(120_000);

test('JOB-PC14 an administrator reads the loaded opening balances of a running work order and a stock location against the totals', async ({ page }) => {
  const svc = serviceClient('JOB-PC14');
  const run = runId('JOBPC14');
  const password = `${crypto.randomUUID()}-Aa1!`;

  const org = need('organisation', await svc.from('organizations').insert({ name: `${run} client`, built_in_roles_enabled: true }).select('id, default_currency').single()) as { id: string; default_currency: string | null };
  const currency = org.default_currency ?? 'IDR';

  let adminId = '';
  try {
    ok('setup workflows on', await svc.from('org_setup_workflow_settings').insert({ org_id: org.id, enabled: true }));

    // The Administrator of this organisation, with a known password so both the API and the browser can be that person.
    const created = await svc.auth.admin.createUser({ email: `opening-${run}@example.test`, password, email_confirm: true });
    if (created.error || !created.data.user) throw created.error ?? new Error('no administrator user');
    adminId = created.data.user.id;
    ok('administrator profile', await svc.from('profiles').insert({
      id: adminId, org_id: org.id, email: `opening-${run}@example.test`, full_name: `${run} administrator`,
      role: 'Admin', status: 'active', built_in_role: 'administrator', locale: 'en', number_locale: 'en-US',
    }));

    const project = need('project', await svc.from('projects').insert({ org_id: org.id, name: `${run} project`, status: 'Ongoing Project', currency }).select('id').single()) as { id: string };
    const wo = need('work order', await svc.from('work_orders').insert({
      org_id: org.id, project_id: project.id, title: `${run} running scope`, status: 'Issued', wo_number: `WO-${run.slice(-8)}`,
      order_value: 100_000, tax_treatment: 'exclusive', tax_amount: 0, currency, issued_at: new Date().toISOString(),
    }).select('id, wo_number').single()) as { id: string; wo_number: string };
    const line = need('contract line', await svc.from('boq_items').insert({
      org_id: org.id, project_id: project.id, item_code: `OPN-${run.slice(-5)}`, description: `${run} measured work`, unit: 'm3', quantity: 100, rate: 25,
    }).select('id').single()) as { id: string };
    ok('allocation', await svc.from('work_order_lines').insert({ org_id: org.id, work_order_id: wo.id, boq_item_id: line.id, quantity: 100 }));

    const unit = need('unit', await svc.from('stock_units').insert({ org_id: org.id, code: `U-${run.slice(-6)}`, name: `${run} unit`, whole_only: true }).select('id').single()) as { id: string };
    const item = need('stock item', await svc.from('stock_items').insert({ org_id: org.id, code: `STK-${run.slice(-5)}`, name: `${run} cement`, unit_id: unit.id }).select('id, code').single()) as { id: string; code: string };
    const warehouse = need('warehouse', await svc.from('stock_warehouses').insert({ org_id: org.id, code: `WH-${run.slice(-5)}`, name: `${run} yard`, kind: 'central' }).select('id, code, name').single()) as { id: string; code: string; name: string };

    // The Administrator's own session loads both openings, as the command line tool does.
    const api = createClient(
      process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321',
      process.env.VITE_SUPABASE_ANON_KEY ?? '',
      { auth: { persistSession: false } },
    );
    const signedIn = await api.auth.signInWithPassword({ email: `opening-${run}@example.test`, password });
    if (signedIn.error) throw signedIn.error;
    const asOf = inDays(-1); // the opening is read as of yesterday by the organisation's calendar
    ok('work order opening', await api.rpc('load_work_order_opening', {
      p_work_order_id: wo.id, p_as_of: asOf,
      p_lines: [{ boq_item_id: line.id, certified_quantity: 40, claimed_quantity: 30 }],
      p_note: `${run} from the source file`,
    }));
    ok('stock opening', await api.rpc('load_stock_opening', {
      p_warehouse_id: warehouse.id, p_as_of: asOf,
      p_lines: [{ item_id: item.id, counted_quantity: 12, unit_cost: 25 }],
      p_note: null,
    }));

    // The Administrator reads them back on the screen.
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(`opening-${run}@example.test`);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole('button', { name: /sign in/i }).click();
    await expect(page).not.toHaveURL(/\/login/, { timeout: 20_000 });
    await page.goto('/finance/opening-balances');
    await expect(page.getByRole('heading', { name: 'Opening balances' })).toBeVisible({ timeout: 30_000 });
    // Source figures: 40 certified and 30 claimed of a line at 25 each, and 12 counted at 25 each.
    // Money is matched as digits with either separator style, exactly: 1,000.00 / 1.000,00 and never a longer number that merely contains it.
    const amount = (n: string) => new RegExp(`(?:^|\\D)${n.replace(/(\d)(?=(\d{3})+$)/g, '$1[.,\\s]?')}(?:[.,]00)?(?:\\D|$)`);
    const totalCell = (id: string) => page.getByTestId(id).getByRole('cell').last();
    await expect(page.getByTestId('ob-total-stock').getByRole('cell').nth(1)).toHaveText('1 location');
    await expect(totalCell('ob-total-stock')).toHaveText(amount('300'));
    await expect(page.getByTestId('ob-total-certified').getByRole('cell').nth(1)).toHaveText('1 work order');
    await expect(totalCell('ob-total-certified')).toHaveText(amount('1000'));
    await expect(totalCell('ob-total-claimed')).toHaveText(amount('750'));
    const orderCard = page.getByRole('region', { name: new RegExp(wo.wo_number) });
    await expect(orderCard).toContainText(`OPN-${run.slice(-5)}`, { timeout: 20_000 });
    const orderRow = orderCard.getByRole('row').filter({ hasText: `OPN-${run.slice(-5)}` });
    await expect(orderRow.getByRole('cell').nth(1)).toHaveText('40');
    await expect(orderRow.getByRole('cell').nth(2)).toHaveText('30');
    await expect(orderRow.getByRole('cell').nth(3)).toHaveText(amount('750'));
    await expect(orderCard).toContainText(`${run} from the source file`);
    const stockCard = page.getByRole('region', { name: new RegExp(warehouse.code) });
    const stockRow = stockCard.getByRole('row').filter({ hasText: item.code });
    await expect(stockRow.getByRole('cell').nth(1)).toHaveText('12');
    await expect(stockRow.getByRole('cell').nth(2)).toHaveText(amount('300'));

    // The running work order: its page shows the progress to date and the billed value that were loaded.
    await page.goto(`/work-orders/${wo.id}`);
    await expect(page.getByRole('main')).toContainText(`${run} running scope`, { timeout: 30_000 });
    await expect(page.getByTestId(`scope-line-${line.id}`)).toContainText('40 of 100 m3', { timeout: 30_000 });
    await openWorkOrderArea(page, 'billing');
    await expect(page.getByTestId('billing-invoiced')).toContainText(amount('750'), { timeout: 30_000 });

    // Stock → Balances: the counted quantity of the item in the warehouse.
    await page.goto('/stock');
    const onHand = page.getByRole('row').filter({ hasText: item.code });
    await expect(onHand.first()).toBeVisible({ timeout: 30_000 });
    await expect(onHand.first()).toContainText('12');
  } finally {
    sqlAsOwner(`delete from public.opening_balance_lines where org_id = '${org.id}'; delete from public.opening_balances where org_id = '${org.id}';`);
    removeJobOrganization(org.id);
    if (adminId) ok('login cleanup', await svc.from('profiles').delete().eq('id', adminId));
  }
});

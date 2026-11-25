// @e2e-isolation: serial — switches the organisation's profit-per-discipline setting for the run and restores it in finally; the contract, disciplines, stock and item are this run's own and are deleted.
// JOB-M9 (acceptance 01-management, TC-M-09): profit per discipline. A contract with revenue and cost tagged to two
// disciplines: the Executive opens the discipline view and each discipline shows revenue, cost and profit, and the
// totals equal the project's.
import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { need, ok, ORG_ID, runId, serviceClient, sqlAsOwner } from '../support/jobFixtures';
import { makeItem, makeWarehouse, postReceive, runSuffix, userClient } from '../support/stockFixture';
import { roleJobUser } from '../support/roleJobUser';
import { formatExactMoney } from '../../src/lib/format';

test.setTimeout(180_000);

type Actor = Awaited<ReturnType<typeof roleJobUser>>;
const money = (value: string) => formatExactMoney(value, 'USD', 'en-US')!;

test('JOB-M9 the Executive sees revenue, cost and profit per discipline, and the totals add up', async ({ page }) => {
  const svc = serviceClient('JOB-M9');
  const run = runId('JOBM9');
  const suffix = runSuffix();
  const actor: Actor = await roleJobUser(svc, 'executive', run);
  const stock = await userClient('admin@acme.test');
  let previousSetting: boolean | null = null;
  let projectId = ''; let woId = ''; let discA = ''; let discB = ''; let reportId = '';
  let itemId = ''; let siteId = ''; const docIds: string[] = [];

  try {
    const org = need('org', await svc.from('organizations').select('discipline_profit_enabled').eq('id', ORG_ID).single());
    previousSetting = org.discipline_profit_enabled as boolean;
    ok('setting on', await svc.from('organizations').update({ discipline_profit_enabled: true }).eq('id', ORG_ID));

    const clientId = need('client', await svc.from('companies').insert({ org_id: ORG_ID, name: `${run} client`, type: 'Client' }).select('id').single()).id as string;
    projectId = need('project', await svc.from('projects').insert({
      org_id: ORG_ID, name: `${run} contract`, status: 'Ongoing Project', currency: 'USD', client_id: clientId,
      contract_value: 1_000_000, tax_treatment: 'exclusive', tax_amount: 0,
    }).select('id').single()).id as string;
    woId = randomUUID();
    ok('work order', await svc.from('work_orders').insert({
      id: woId, org_id: ORG_ID, project_id: projectId, title: `${run} works`, wo_number: `WO-${run}`, status: 'Issued',
      issued_at: new Date().toISOString(), order_value: 500_000, tax_treatment: 'exclusive', tax_amount: 0, currency: 'USD',
    }));
    discA = need('discipline A', await svc.from('cost_disciplines').insert({ org_id: ORG_ID, code: `A${suffix}`.slice(0, 20), name: `${run} piping` }).select('id').single()).id as string;
    discB = need('discipline B', await svc.from('cost_disciplines').insert({ org_id: ORG_ID, code: `B${suffix}`.slice(0, 20), name: `${run} civil` }).select('id').single()).id as string;
    // Revenue: two contract lines, each tagged to its discipline and measured 12.5 and 25 at rate 10 → 125 and 250.
    const boqA = need('contract line A', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: `A-${suffix}`, description: `${run} pipe work`, unit: 'm', quantity: 100, rate: 10, discipline_id: discA,
    }).select('id').single()).id as string;
    const boqB = need('contract line B', await svc.from('boq_items').insert({
      org_id: ORG_ID, project_id: projectId, item_code: `B-${suffix}`, description: `${run} civil work`, unit: 'm', quantity: 100, rate: 10, discipline_id: discB,
    }).select('id').single()).id as string;
    const lineA = need('work-order line A', await svc.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: woId, boq_item_id: boqA, quantity: 100 }).select('id').single()).id as string;
    const lineB = need('work-order line B', await svc.from('work_order_lines').insert({ org_id: ORG_ID, work_order_id: woId, boq_item_id: boqB, quantity: 100 }).select('id').single()).id as string;
    reportId = need('report', await svc.from('daily_site_reports').insert({
      org_id: ORG_ID, project_id: projectId, work_order_id: woId, work_date: '2026-11-01', status: 'validated',
      author_id: actor.id, validated_by: (await stock.auth.getUser()).data.user!.id, validated_at: new Date().toISOString(),
    }).select('id').single()).id as string;
    ok('progress A', await svc.from('dsr_progress_lines').insert({
      org_id: ORG_ID, report_id: reportId, position: 1, work_order_line_id: lineA, quantity: 12.5, unit: 'm',
      frozen_rate: 10, frozen_rate_source: 'contract', frozen_amount: 125, frozen_at: new Date().toISOString(),
    }));
    ok('progress B', await svc.from('dsr_progress_lines').insert({
      org_id: ORG_ID, report_id: reportId, position: 2, work_order_line_id: lineB, quantity: 25, unit: 'm',
      frozen_rate: 10, frozen_rate_source: 'contract', frozen_amount: 250, frozen_at: new Date().toISOString(),
    }));
    // Cost: material issued to the work order and attributed to each discipline (100.00 and 50.00).
    const item = await makeItem(stock, suffix, 'M9');
    itemId = item.id;
    const yard = await makeWarehouse(stock, suffix, 'M9', 'central');
    siteId = yard.id;
    docIds.push(await postReceive(stock, yard.id, itemId, '100', '2'));
    for (const [quantity, disciplineId] of [['50', discA], ['25', discB]] as const) {
      const issue = await stock.rpc('create_stock_document', {
        p_header: { kind: 'issue', warehouse_id: yard.id, project_id: projectId },
        p_lines: [{ item_id: itemId, quantity }], p_post: true,
      });
      if (issue.error) throw new Error('issue: ' + issue.error.message);
      docIds.push(issue.data as string);
      ok('attribution', await stock.rpc('set_cost_attribution', { p_source: 'stock_document', p_ids: [issue.data], p_work_order_id: woId, p_discipline_id: disciplineId }));
    }

    await actor.signIn(page);
    await page.goto(`/projects/${projectId}/orders`);
    const panel = page.getByTestId('discipline-profit');
    await expect(panel).toBeVisible({ timeout: 30_000 });
    const rowA = panel.getByTestId(`discipline-profit-row-${discA}`);
    const rowB = panel.getByTestId(`discipline-profit-row-${discB}`);
    await expect(rowA).toContainText(`${run} piping`);
    await expect(rowA).toContainText(money('125.00'));           // revenue
    await expect(rowA).toContainText(money('100.00'));           // cost
    await expect(rowA).toContainText(money('25.00'));            // profit
    await expect(rowB).toContainText(`${run} civil`);
    await expect(rowB).toContainText(money('250.00'));
    await expect(rowB).toContainText(money('50.00'));
    await expect(rowB).toContainText(money('200.00'));
    // The project total is the sum of the disciplines.
    const total = panel.getByTestId('discipline-profit-row-total');
    await expect(total).toContainText(money('375.00'));
    await expect(total).toContainText(money('150.00'));
    await expect(total).toContainText(money('225.00'));
  } finally {
    if (docIds.length) {
      const list = docIds.map((d) => `'${d}'`).join(',');
      sqlAsOwner(`delete from public.stock_ledger where document_id in (${list}); delete from public.stock_document_lines where document_id in (${list}); delete from public.stock_documents where id in (${list});`);
    }
    if (siteId) sqlAsOwner(`delete from public.stock_balances where warehouse_id = '${siteId}'; delete from public.stock_warehouses where id = '${siteId}';`);
    if (itemId) {
      sqlAsOwner(`delete from public.stock_items where id = '${itemId}';`);
      ok('unit cleanup', await svc.from('stock_units').delete().eq('code', `E2E-U${suffix}`));
    }
    if (reportId) sqlAsOwner(`delete from public.dsr_progress_lines where report_id = '${reportId}'; delete from public.daily_site_reports where id = '${reportId}';`);
    if (projectId) {
      sqlAsOwner(`delete from public.work_order_lines where work_order_id = '${woId}';
        delete from public.work_orders where id = '${woId}';
        delete from public.boq_items where project_id = '${projectId}';
        delete from public.record_changes where entity_id = '${projectId}'::text;
        delete from public.projects where id = '${projectId}';`);
    }
    if (discA) sqlAsOwner(`delete from public.cost_disciplines where id in ('${discA}','${discB}');`);
    if (previousSetting !== null) ok('restore setting', await svc.from('organizations').update({ discipline_profit_enabled: previousSetting }).eq('id', ORG_ID));
    await actor.cleanup();
  }
});

// @e2e-isolation: self-isolated — creates its own disposable site supervisor login, a controllerless crew and a tool line per run, and deletes all owned rows in finally.
/**
 * JOB-RSD — the crew field-controller default (RR-3, FR-RSD-007).
 * The crew names no field controller and no Admin sets one. The organisation's site supervisor opens the crew's
 * tools sheet, reports a lost tool for it, and the open report reads back with the supervisor as its reporter.
 */
import { test, expect } from '@playwright/test';
import { ORG_ID, ok, runId, serviceClient } from './support/jobFixtures';
import { roleJobUser } from './support/roleJobUser';

test.setTimeout(180_000);

test('JOB-RSD the site supervisor reports a tool for a crew that names no field controller', async ({ page }) => {
  const svc = serviceClient('JOB-RSD');
  const run = runId('rsd');
  const supervisor = await roleJobUser(svc, 'site_supervisor', runId('rsd-ss'));
  let crewId = '';
  let lineId = '';
  try {
    const crew = need('crew', await svc.from('crews').insert({
      org_id: ORG_ID, code: `RD${run.slice(0, 6)}`, name: `${run} ground crew`, field_controller_id: null,
    }).select('id').single());
    crewId = crew.id;
    const line = need('tool line', await svc.from('crew_tool_lines').insert({
      org_id: ORG_ID, crew_id: crewId, name: `${run} hammer`, held_qty: 3,
    }).select('id').single());
    lineId = line.id;

    // 1. Goal: the site supervisor — no named controller, no Admin setup — reports the tool.
    await supervisor.signIn(page);
    await page.goto('/crews?view=tools');
    await page.getByLabel('Crew').selectOption({ label: `${run} ground crew` });
    await expect(page.getByRole('row').filter({ hasText: `${run} hammer` })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('row').filter({ hasText: `${run} hammer` }).getByRole('button', { name: 'Report a problem' }).click();
    await page.getByRole('dialog', { name: new RegExp(`Report ${run} hammer`) }).getByLabel('What happened').selectOption({ label: 'Lost' });
    await page.getByRole('dialog', { name: new RegExp(`Report ${run} hammer`) }).getByLabel(/^Quantity/).fill('1');
    await page.getByRole('dialog', { name: new RegExp(`Report ${run} hammer`) }).getByLabel(/^Note/).fill('Not returned from the site store');
    await page.getByRole('dialog', { name: new RegExp(`Report ${run} hammer`) }).getByRole('button', { name: 'Send report' }).click();
    await expect(page.getByText('Reported. The equipment coordinator has a task.')).toBeVisible({ timeout: 15_000 });

    // 2. The open report reads back with the supervisor as its reporter.
    await expect(page.getByRole('row').filter({ hasText: `${run} hammer` }).getByRole('rowheader')).toContainText('1', { timeout: 15_000 });
    const row = await svc.from('crew_tool_reports').select('reported_by, qty, status').eq('line_id', lineId).single();
    if (row.error) throw new Error('report read: ' + row.error.message);
    expect(row.data.reported_by).toBe(supervisor.id);
    expect(row.data.status).toBe('open');
  } finally {
    if (lineId) ok('tool reports cleanup', await svc.from('crew_tool_reports').delete().eq('line_id', lineId));
    if (lineId) ok('tool line cleanup', await svc.from('crew_tool_lines').delete().eq('id', lineId));
    if (crewId) ok('crew cleanup', await svc.from('crews').delete().eq('id', crewId));
    await supervisor.cleanup();
  }
});

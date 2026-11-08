// @e2e-isolation: dedicated-row — owns a fresh org; it also stops and restarts the Odoo bed, so it runs only under the Odoo lock after the other Odoo journeys (the bed lock, not the lane, isolates it).
// AC-ODC-014: a connected org whose Odoo goes away keeps its last data with its age, shows the unavailable notice, queues nothing, and clears the notice after the bed returns.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adminClient, must, provisionOdooOrg, scenarioGate, openOdooSection, signIn, sweep, type ScenarioOrg } from './_connectScenario';

const gate = scenarioGate('AC-ODC-014');
test.skip(!gate.ready, gate.reason);
test.setTimeout(420_000);

const BED_SCRIPT = fileURLToPath(new URL('../../scripts/odoo-dev-bed.sh', import.meta.url));
const bed = (verb: 'up' | 'down') => execFileSync(BED_SCRIPT, [verb], { stdio: 'pipe', timeout: 300_000 });

let scenario: ScenarioOrg | undefined;
let productId = 0;
// The bed is brought back even when the journey fails, so the next spec (and the next agent) finds it up.
test.afterAll(async () => {
  test.setTimeout(300_000);
  try { bed('up'); } catch { /* reported by the next bed user; nothing safe to add here */ }
  await scenario?.call('product.product', 'unlink', { ids: [productId] }).catch(() => undefined);
  await scenario?.cleanup();
});

test('AC-ODC-014: with Odoo down the item directory shows last data and the unavailable notice, nothing is queued, and Re-check clears it once Odoo is back', async ({ page }) => {
  const admin = adminClient();
  const stamp = `ODC014-${Date.now().toString(36)}`;
  scenario = await provisionOdooOrg(admin, stamp);
  const { orgId, call } = scenario;
  productId = (await call<number[]>('product.product', 'create', { vals_list: [{ name: `${stamp} Barang`, default_code: `${stamp}-1`.toUpperCase(), purchase_ok: true }] }))[0];
  await sweep();   // the directory now holds the product while Odoo is up

  await signIn(page, scenario.admin);
  await openOdooSection(page);
  const banner = page.getByTestId('odoo-connection-banner');
  const recheck = page.getByRole('button', { name: 'Re-check' });
  await recheck.waitFor({ timeout: 45_000 }).catch(async () => { throw new Error(`no Re-check button on ${page.url()}: ${(await page.locator('body').innerText()).slice(0, 600)}`); });
  await recheck.click();
  await expect(page.getByText('Checked just now.')).toBeVisible();

  bed('down');
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('button', { name: 'Re-check' }).click();
    await expect(page.getByRole('alert').or(page.getByText('Checked just now.')).first()).toBeVisible();
  }
  await expect(banner).toContainText('Odoo cannot be reached');
  await expect(banner).toContainText(/as of \d/);

  // Last data, with its age, and the same notice on the directory.
  await page.goto('/master-data/product');
  await expect(page.getByText(`${stamp} Barang`)).toBeVisible();
  await expect(page.getByText(/^As of /).first()).toBeVisible();
  await expect(page.getByTestId('odoo-connection-banner')).toContainText('Odoo cannot be reached');

  // Nothing was queued for Odoo while it was away.
  const outbox = await must('outbox', admin.from('external_command_outbox').select('id').eq('org_id', orgId));
  expect(outbox).toHaveLength(0);

  bed('up');
  await openOdooSection(page);
  await page.getByRole('button', { name: 'Re-check' }).click();
  await expect(page.getByText('Checked just now.')).toBeVisible();
  await expect(page.getByTestId('odoo-connection-banner')).toHaveCount(0);
});

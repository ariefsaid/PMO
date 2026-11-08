// @e2e-isolation: dedicated-row — owns a fresh org; it also stops and restarts the Odoo bed, so it runs only under the Odoo lock after the other Odoo journeys (the bed lock, not the lane, isolates it).
// AC-ODC-014: a connected org whose Odoo goes away keeps its last data with its age, shows the unavailable notice, queues nothing, and clears the notice after the bed returns.
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adminClient, must, provisionOdooOrg, scenarioGate, accessToken, openOdooSection, setup, signIn, sweep, type ScenarioOrg } from './_connectScenario';

const gate = scenarioGate('AC-ODC-014');
test.skip(!gate.ready, gate.reason);
test.setTimeout(900_000);

const BED_SCRIPT = fileURLToPath(new URL('../../scripts/odoo-dev-bed.sh', import.meta.url));
const bed = (verb: 'up' | 'down') => execFileSync(BED_SCRIPT, [verb], { stdio: 'pipe', timeout: 300_000 });

// Re-check is limited to one a minute, so each press waits out the window; the answer is the card's own notice or alert.
async function recheck(page: import('@playwright/test').Page): Promise<string> {
  const button = page.getByRole('button', { name: 'Re-check' });
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await button.click();
    await expect(button).toBeEnabled({ timeout: 60_000 });
    const said = (await page.getByTestId('odoo-section').locator('[role=status],[role=alert]').allInnerTexts()).join(' | ');
    if (!/try again in a minute|just ran/i.test(said)) return said;
    await page.waitForTimeout(20_000);   // the card told us the window is still open
  }
  throw new Error('Re-check stayed rate limited');
}

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
  // Same call the button makes, first, so a failure names the function's own answer (the UI shows only a generic sentence).
  const direct = await setup<{ state: string }>(await accessToken(scenario.admin), { setupAction: 'recheck' }).then((r) => r, (e: Error) => ({ state: `ERR ${e.message}` }));
  expect(direct.state, 'a Re-check against a healthy Odoo').toBe('healthy');
  await page.waitForTimeout(61_000);
  await openOdooSection(page);
  const banner = page.getByTestId('odoo-connection-banner');
  await page.getByRole('button', { name: 'Re-check' }).waitFor({ timeout: 45_000 });
  expect.soft(await recheck(page), 'Re-check against a healthy Odoo, through the screen').toContain('Checked just now.');

  bed('down');
  const answers: string[] = [];
  for (let i = 0; i < 3; i += 1) {
    await page.waitForTimeout(61_000);   // one check a minute
    answers.push(await recheck(page));
  }
  void answers;   // a failed probe is still an answer (the card says it checked); the state it produced is asserted on the banner below
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
  await page.waitForTimeout(61_000);
  expect(await recheck(page)).toContain('Checked just now.');
  await expect(page.getByTestId('odoo-connection-banner')).toHaveCount(0);
});

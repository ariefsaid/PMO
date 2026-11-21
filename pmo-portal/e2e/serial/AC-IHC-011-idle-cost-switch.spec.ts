// @e2e-isolation: serial - turns the seed organisation's labour cost and idle cost switches on and off (org-global singletons); resets both in afterEach.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from '../helpers';

// AC-IHC-011 (idle hours as cost, #2673): an Admin turns labour cost on, then idle time as cost, and the choice persists.
// With labour cost off the idle switch says nothing shows yet. ISOLATION: both settings are reset in afterEach, even on failure.
test.setTimeout(120_000);
test.use({ deviceScaleFactor: 2 });
const EVIDENCE = '../docs/evidence/1215/2673';
const shots = async (page: import('@playwright/test').Page, locator: import('@playwright/test').Locator, name: string) => {
  for (const [label, width, height] of [['phone', 390, 844], ['desktop', 1440, 900]] as const) {
    await page.setViewportSize({ width, height });
    await locator.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${EVIDENCE}/${name}-${label}.png`, fullPage: true });
  }
};
const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
if (!svcKey) throw new Error('AC-IHC-011: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey - it must not silently skip.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

test.afterEach(async () => {
  await admin.from('idle_cost_settings').delete().eq('org_id', ORG_ID);
  await admin.from('labour_cost_settings').delete().eq('org_id', ORG_ID);
});

test('AC-IHC-011 Admin switches idle time as cost on and it persists', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/cost-attribution');
  const labour = page.getByTestId('labour-cost-settings').getByRole('checkbox', { name: 'Cost approved hours in money' });
  const idle = page.getByTestId('idle-cost-settings');
  const toggle = idle.getByRole('checkbox', { name: 'Cost idle hours in money' });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await expect(idle.getByRole('status')).toContainText('Nothing shows until labour cost in money is switched on.');
  await labour.check();
  await expect(idle.getByRole('status')).toBeHidden();
  await shots(page, idle, 'idle-cost-switch');
  await page.reload();
  await expect(page.getByTestId('idle-cost-settings').getByRole('checkbox', { name: 'Cost idle hours in money' })).toBeChecked();
});

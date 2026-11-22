// @e2e-isolation: serial - it sets the seed organisation's labour-cost and idle-cost settings (org-global singletons) and restores both in afterEach.
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { signIn, requireServiceRoleKey } from '../helpers';

/**
 * AC-IWR-012 (idle cost of people and rented equipment): an Admin widens what idle cost covers.
 *
 * Journey: idle time as cost is on (labour cost in money is on), and idle cost covers the idle hours at the average
 * hourly cost. The Admin opens Administration › Modules › Billing extras (the catalogue routes idle-cost settings there),
 * finds "Idle cost covers" and chooses people present and rented equipment on standby. After a reload the choice is still
 * there, which is the goal: the setting is saved.
 * The seed organisation's two settings are put back in afterEach, which is why this spec is serial.
 */
test.setTimeout(120_000);

const ORG_ID = '00000000-0000-0000-0000-000000000001';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const svcKey = requireServiceRoleKey();
if (!svcKey) throw new Error('AC-IWR-012: SUPABASE_SERVICE_ROLE_KEY is required for this owning journey (local fixture dependency) - it must not silently skip.');
const admin = createClient(SUPABASE_URL, svcKey, { auth: { persistSession: false } });

type Saved = { labour: { enabled: boolean } | null; idle: { enabled: boolean; scope: string } | null };
let saved: Saved | null = null;

test.beforeEach(async () => {
  const labour = (await admin.from('labour_cost_settings').select('enabled').eq('org_id', ORG_ID).maybeSingle()).data;
  const idle = (await admin.from('idle_cost_settings').select('enabled, scope').eq('org_id', ORG_ID).maybeSingle()).data;
  saved = { labour, idle };
  const l = await admin.from('labour_cost_settings').upsert({ org_id: ORG_ID, enabled: true });
  if (l.error) throw new Error(`AC-IWR-012 seed labour cost: ${l.error.message}`);
  const i = await admin.from('idle_cost_settings').upsert({ org_id: ORG_ID, enabled: true, scope: 'labour_average' });
  if (i.error) throw new Error(`AC-IWR-012 seed idle cost: ${i.error.message}`);
});

test.afterEach(async () => {
  if (!saved) return;
  const fail = (step: string, error: { message: string } | null) => { if (error) throw new Error(`AC-IWR-012 cleanup ${step}: ${error.message}`); };
  if (saved.idle) fail('idle', (await admin.from('idle_cost_settings').upsert({ org_id: ORG_ID, ...saved.idle })).error);
  else fail('idle', (await admin.from('idle_cost_settings').delete().eq('org_id', ORG_ID)).error);
  if (saved.labour) fail('labour', (await admin.from('labour_cost_settings').upsert({ org_id: ORG_ID, ...saved.labour })).error);
  else fail('labour', (await admin.from('labour_cost_settings').delete().eq('org_id', ORG_ID)).error);
  saved = null;
});

test('AC-IWR-012 an Admin makes idle cost cover people and rented equipment and it stays saved', async ({ page }) => {
  await signIn(page, 'admin@acme.test');
  await page.goto('/administration/modules');
  const scope = page.getByRole('combobox', { name: 'Idle cost covers' });
  await expect(scope).toHaveValue('labour_average');
  await scope.selectOption('people_and_equipment');
  await expect(scope).toHaveValue('people_and_equipment');
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Idle cost covers' })).toHaveValue('people_and_equipment');
});

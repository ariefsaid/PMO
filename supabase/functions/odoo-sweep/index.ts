/**
 * odoo-sweep (FR-ODC-047): the 5-minute tick for every activated Odoo binding. Called by pg_cron
 * (`odoo_sweep_tick`, migration 0421) with a dedicated sweep secret, never the service key; a no-op for orgs without
 * an Odoo binding. Each org runs through `sweepOdooOrg`, which owns single-flight, budgets and cursors.
 */
import { createClient } from '@supabase/supabase-js';
import { constantTimeBearerEquals } from '../_shared/constantTimeBearerEquals.ts';
import { ODOO_SWEEP_TICK_TIME_BUDGET_MS, sweepOdooOrg } from '../_shared/odooSweep.ts';
import { serveWithErrorReporting } from '../_shared/serveWithErrorReporting.ts';

export const ODOO_SWEEP_SECRET_ENV = 'ODOO_SWEEP_SECRET';
export const testSupabaseOptions = { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export async function handleOdooSweepRequest(req: Request): Promise<Response> {
  const secret = Deno.env.get(ODOO_SWEEP_SECRET_ENV) ?? '';
  if (!secret || !(await constantTimeBearerEquals(req.headers.get('Authorization') ?? '', `Bearer ${secret}`))) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }
  const sc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, testSupabaseOptions);
  const { data: orgs, error } = await sc.from('external_org_bindings').select('org_id')
    .eq('external_tier', 'odoo').eq('status', 'active').not('activated_at', 'is', null).order('org_id');
  if (error) return json({ error: 'BINDINGS_UNREADABLE' }, 500);
  // ponytail: orgs run in turn and share one tick's time budget; fan out one request per org if orgs ever starve.
  // Each 5-minute tick starts one org further along, so a slow org never spends the budget of the same orgs every tick.
  const list = orgs ?? [];
  const start = list.length ? Math.floor(Date.now() / 300_000) % list.length : 0;
  const deadline = Date.now() + ODOO_SWEEP_TICK_TIME_BUDGET_MS;
  const results = [];
  for (const { org_id } of [...list.slice(start), ...list.slice(0, start)]) {
    const timeBudgetMs = deadline - Date.now();
    if (timeBudgetMs <= 0) { results.push({ org_id, skipped: 'tick-budget' }); continue; }
    try {
      results.push({ org_id, ...(await sweepOdooOrg(sc, org_id, { timeBudgetMs })) });
    } catch {
      // One org's store failure never stops the others; its cursors did not move.
      results.push({ org_id, error: 'SWEEP_FAILED' });
    }
  }
  return json({ orgs: results.length, results });
}

if (import.meta.main) serveWithErrorReporting('odoo-sweep', handleOdooSweepRequest);

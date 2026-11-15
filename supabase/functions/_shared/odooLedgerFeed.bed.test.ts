/** AC-ODA-021: reconcile the live Odoo ledger and its project attribution. */
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { readOdooBedContext } from './testing/odooBedContext.ts';
import { runLedgerPass } from './odooLedgerFeed.ts';

const bed = readOdooBedContext();
Deno.test({
  name: 'AC-ODA-021: posted bill and invoice reconcile by account and project to Odoo',
  ignore: !bed,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    assert(bed);
    const call = bindCall({ baseUrl: bed.odooUrl, apiKey: bed.odooKey, database: bed.odooDatabase, fetchImpl: fetch });
    const sc = createClient(bed.supabaseUrl, bed.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const must = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> => {
      const r = await p; if (r.error) throw new Error(r.error.message); return r.data;
    };
    const make = async (model: string, values: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [values] }))[0];
    const [company] = await call<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    const [plan] = await call<Array<{ id: number }>>('account.analytic.plan', 'search_read', { domain: [], fields: ['id'], limit: 1 });
    assert(company && plan, 'the bed has a company and analytic plan');
    const orgId = crypto.randomUUID(), projectId = crypto.randomUUID();
    const stamp = `ODA021-${Date.now()}`;
    const partner = await make('res.partner', { name: stamp });
    const analytic = await make('account.analytic.account', { name: stamp, plan_id: plan.id, company_id: company.id });
    const moves: number[] = [];
    try {
      for (const [type, amount, share] of [['in_invoice', 200, 50], ['out_invoice', 300, 100]] as const) {
        const move = await make('account.move', { move_type: type, partner_id: partner, invoice_date: '2026-11-10',
          invoice_line_ids: [[0, 0, { name: stamp, quantity: 1, price_unit: amount, tax_ids: [[5, 0, 0]], analytic_distribution: { [analytic]: share } }]] });
        moves.push(move);
        await call('account.move', 'action_post', { ids: [move] });
      }
      await must(sc.from('organizations').insert({ id: orgId, name: stamp }).select());
      await must(sc.from('external_org_bindings').insert({ org_id: orgId, external_tier: 'odoo', site_url: 'https://odoo.example.test', secret_ref: stamp,
        status: 'active', activated_at: new Date().toISOString(), config: { odoo_company_id: company.id, ledger_basis_at: new Date().toISOString() } }).select());
      await must(sc.from('projects').insert({ id: projectId, org_id: orgId, name: stamp }).select());
      await must(sc.from('external_project_bindings').insert({ org_id: orgId, project_id: projectId, external_tier: 'odoo', external_container_id: String(analytic) }).select());
      const accounts = await call<Array<{ id: number; code: string; name: string; write_date: string }>>('account.account', 'search_read', {
        domain: [['company_ids', 'in', [company.id]]], fields: ['id', 'code', 'name', 'write_date'], limit: 10000,
        context: { allowed_company_ids: [company.id] },
      });
      await must(sc.from('external_master_records').insert(accounts.map((a) => ({ org_id: orgId, external_tier: 'odoo', kind: 'account', external_id: String(a.id), code: a.code, name: a.name, source_write_date: a.write_date }))).select());
      let remaining = 5000;
      const result = await runLedgerPass(sc, orgId, call, company.id, { spend: () => --remaining > 0, left: () => remaining > 0 });
      assert(result.caughtUp, 'the ledger pass reaches the present');
      assertEquals(result.check, 'matches', 'the shipped reconciliation matches Odoo');
      const grouped = await call<Array<{ account_id: [number, string]; 'debit:sum': number; 'credit:sum': number }>>('account.move.line', 'formatted_read_group', {
        domain: [['company_id', '=', company.id], ['parent_state', '=', 'posted']], groupby: ['account_id'], aggregates: ['debit:sum', 'credit:sum'],
      });
      const rows = await must(sc.from('erp_gl_entry_mirror').select('account,debit,credit').eq('org_id', orgId).eq('is_cancelled', false));
      assert(rows);
      const cents = (n: number) => Math.round(n * 100);
      for (const g of grouped) {
        const code = accounts.find((a) => a.id === g.account_id[0])?.code;
        assert(code, 'each Odoo group has an account code');
        const matching = rows.filter((r) => r.account === code);
        assertEquals(matching.reduce((n, r) => n + cents(Number(r.debit)), 0), cents(g['debit:sum']), `${code} debit`);
        assertEquals(matching.reduce((n, r) => n + cents(Number(r.credit)), 0), cents(g['credit:sum']), `${code} credit`);
      }
      const actuals = await must(sc.from('erp_actuals_snapshot').select('debit,credit').eq('org_id', orgId).eq('project_id', projectId));
      assert(actuals);
      assertEquals(actuals.reduce((n, r) => n + cents(Number(r.debit)), 0), 10000, 'project bill share');
      assertEquals(actuals.reduce((n, r) => n + cents(Number(r.credit)), 0), 30000, 'project invoice share');
    } finally {
      await must(sc.from('projects').delete().eq('org_id', orgId));
      await must(sc.from('organizations').delete().eq('id', orgId));
      for (const id of moves) { await call('account.move', 'button_draft', { ids: [id] }); await call('account.move', 'unlink', { ids: [id] }); }
      await call('account.analytic.account', 'unlink', { ids: [analytic] });
      await call('res.partner', 'unlink', { ids: [partner] });
    }
  },
});

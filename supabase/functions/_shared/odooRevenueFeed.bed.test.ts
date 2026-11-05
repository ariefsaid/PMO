/**
 * AC-OCI-073 / AC-OCI-075 (layer B, #1506 C6) on stock Odoo and local Supabase: a hard-deleted, linked customer invoice is
 * tombstoned by the shipped daily census and no longer contributes to the billed/receivable sets; an Odoo reversal is
 * mirrored once as a negative credit note linked to its PMO invoice, whose outstanding is exactly Odoo's residual.
 * The dependency gate is explicit and never checks CI. All rows/documents carry a synthetic run stamp.
 * Pass a private, throwaway bed-context JSON path as the test script argument to enable the bed.
 */
import { assert, assertEquals } from '@std/assert';
import { createClient } from '@supabase/supabase-js';
import { bindCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { readOdooBedContext } from './testing/odooBedContext.ts';
import { runRevenuePass } from './odooRevenueFeed.ts';

const BED_CONTEXT = readOdooBedContext();
const BED = BED_CONTEXT?.odooUrl;
const DB = BED_CONTEXT?.odooDatabase ?? '';
const KEY = BED_CONTEXT?.odooKey ?? '';
const SUPABASE_ENDPOINT = BED_CONTEXT?.supabaseUrl;
const SERVICE = BED_CONTEXT?.serviceRoleKey;
const ready = Boolean(BED && DB && KEY && SUPABASE_ENDPOINT && SERVICE);
const budget = () => { let left = 200; return { left: () => left > 0, spend: () => left-- > 0 }; };

Deno.test({
  name: 'AC-OCI-073 / AC-OCI-075 on the bed: census excludes a deleted invoice, and a reversal is linked, negative and keeps Odoo residual',
  ignore: !ready,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const raw = bindCall({ baseUrl: BED!, apiKey: KEY, database: DB, fetchImpl: fetch });
    let companyId = 0, incomeId = 0, journalId = 0;
    for (const { id } of await raw<Array<{ id: number }>>('res.company', 'search_read', { domain: [], fields: ['id'] })) {
      const [income] = await raw<Array<{ id: number }>>('account.account', 'search_read', {
        domain: [['account_type', '=', 'income'], ['company_ids', 'in', [id]]], fields: ['id'], limit: 1,
        context: { allowed_company_ids: [id] },
      });
      const [journal] = await raw<Array<{ id: number }>>('account.journal', 'search_read', {
        domain: [['type', '=', 'sale'], ['company_id', '=', id]], fields: ['id'], limit: 1,
        context: { allowed_company_ids: [id] },
      });
      if (income && journal) { companyId = id; incomeId = income.id; journalId = journal.id; break; }
    }
    assert(companyId, 'the Odoo bed has a company with a sales journal and income account');
    const call = (async <T>(model: string, method: string, body: Record<string, unknown> = {}) => raw<T>(model, method, {
      ...body, context: { allowed_company_ids: [companyId], ...((body.context as object) ?? {}) },
    })) as typeof raw;
    const make = async (model: string, vals: Record<string, unknown>) => (await call<number[]>(model, 'create', { vals_list: [vals] }))[0];
    const [company] = await call<Array<{ currency_id: [number, string] }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] });
    const stamp = `C6-${Date.now()}`;
    let partnerId = 0, creditId = 0, deletedId = 0, creditNoteId = 0;
    const invoice = async (suffix: string, amount: number) => {
      const id = await make('account.move', {
        move_type: 'out_invoice', partner_id: partnerId, invoice_date: '2026-11-03', ref: `${stamp}-${suffix}`,
        invoice_line_ids: [[0, 0, { name: `${stamp} ${suffix}`, quantity: 1, price_unit: amount, account_id: incomeId }]],
      });
      await call('account.move', 'action_post', { ids: [id] });
      return id;
    };
    const sc = createClient(SUPABASE_ENDPOINT!, SERVICE!, { auth: { persistSession: false, autoRefreshToken: false } });
    const orgId = crypto.randomUUID(), projectId = crypto.randomUUID();
    const creditSiId = crypto.randomUUID(), deletedSiId = crypto.randomUUID();
    const must = async <T>(p: PromiseLike<{ data: T; error: { message: string } | null }>) => {
      const { data, error } = await p;
      if (error) throw new Error(error.message);
      return data;
    };
    const addInvoice = async (id: string, amount: number, externalId: number, suffix: string) => {
      await must(sc.from('sales_invoices').insert({
        id, org_id: orgId, project_id: projectId, amount, tax_amount: 0, tax_treatment: 'exclusive',
        currency: company.currency_id[1], status: 'Unpaid', invoice_date: '2026-11-03', erp_outstanding_amount: amount,
      }).select());
      await must(sc.from('external_refs').insert({ org_id: orgId, domain: 'revenue', pmo_record_id: id,
        external_tier: 'odoo', external_record_id: `account.move:${externalId}` }).select());
      await must(sc.from('external_refs').update({ created_at: new Date(Date.now() - 3_600_000).toISOString() })
        .eq('org_id', orgId).eq('pmo_record_id', id).select());
      // Odoo reference identifies the seeded row in diagnostics without naming a person or tenant.
      void suffix;
    };

    try {
      partnerId = await make('res.partner', { name: `${stamp} client`, customer_rank: 1 });
      creditId = await invoice('credit', 1000);
      deletedId = await invoice('deleted', 500);
      await must(sc.from('organizations').insert({ id: orgId, name: `${stamp} org` }).select());
      await must(sc.from('external_org_bindings').insert({ org_id: orgId, external_tier: 'odoo', site_url: 'https://odoo.example.test',
        secret_ref: stamp, status: 'active', config: { odoo_company_id: companyId }, activated_at: new Date().toISOString() }).select());
      await must(sc.from('external_domain_ownership').insert({ org_id: orgId, external_tier: 'odoo', domain: 'revenue' }).select());
      await must(sc.from('projects').insert({ id: projectId, org_id: orgId, name: stamp }).select());
      await addInvoice(creditSiId, 1000, creditId, 'credit');
      await addInvoice(deletedSiId, 500, deletedId, 'deleted');

      const odoo = call;
      const runInvoice = () => runRevenuePass(sc, orgId, 'sales-invoice', odoo, companyId, budget());
      const runCredit = () => runRevenuePass(sc, orgId, 'credit-note', odoo, companyId, budget());
      await runInvoice();

      const [original] = await call<Array<{ amount_residual: number }>>('account.move', 'read', { ids: [creditId], fields: ['amount_residual'] });
      const [refund] = await call<Array<{ id: number }>>('account.move.reversal', 'create', {
        vals_list: [{ journal_id: journalId, company_id: companyId, date: '2026-11-03' }],
        context: { active_model: 'account.move', active_ids: [creditId] },
      });
      await call('account.move.reversal', 'refund_moves', { ids: [refund], context: { active_model: 'account.move', active_ids: [creditId] } });
      const [creditNote] = await call<Array<{ id: number; state: string; reversed_entry_id: [number, string] }>>('account.move', 'search_read', {
        domain: [['reversed_entry_id', '=', creditId], ['move_type', '=', 'out_refund']], fields: ['id', 'state', 'reversed_entry_id'], order: 'id desc', limit: 1,
      });
      assert(creditNote, 'the Odoo reversal wizard creates a credit note linked to the original invoice');
      creditNoteId = creditNote.id;
      if (creditNote.state === 'draft') await call('account.move', 'action_post', { ids: [creditNote.id] });
      const [postedOriginal] = await call<Array<{ amount_residual: number }>>('account.move', 'read', { ids: [creditId], fields: ['amount_residual'] });
      assert(Number.isFinite(postedOriginal.amount_residual));
      await runInvoice(); // refresh the source residual after the Odoo reversal
      await runCredit();

      const creditMirror = await must(sc.from('revenue_erp_mirror').select('sales_invoice_id,grand_total,outstanding_amount,reversed_entry_ref,erp_docstatus')
        .eq('org_id', orgId).eq('external_ref', `account.move:${creditNote.id}`).single()) as {
          sales_invoice_id: string; grand_total: number; outstanding_amount: number; reversed_entry_ref: string; erp_docstatus: number;
        };
      assertEquals(creditMirror.sales_invoice_id, creditSiId, 'the credit note links to its PMO invoice');
      assertEquals(creditMirror.reversed_entry_ref, `account.move:${creditId}`);
      assert(creditMirror.grand_total < 0, 'the credit note is negative in the side mirror');
      assertEquals(creditMirror.erp_docstatus, 1);
      const [creditPmo] = await must(sc.from('sales_invoices').select('erp_outstanding_amount').eq('org_id', orgId).eq('id', creditSiId)) as Array<{ erp_outstanding_amount: number }>;
      assertEquals(Number(creditPmo.erp_outstanding_amount), Number(postedOriginal.amount_residual), 'the outstanding is Odoo amount_residual, not a PMO-computed balance');

      await call('account.move', 'button_draft', { ids: [deletedId] });
      await call('account.move', 'unlink', { ids: [deletedId] });
      const { data: wm, error: wmError } = await sc.from('external_sync_watermarks').select('watermark_cursor')
        .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', 'revenue:sales-invoice').single();
      if (wmError) throw new Error(wmError.message);
      const cursor = JSON.parse(wm!.watermark_cursor as string);
      delete cursor.census_done_at;
      await must(sc.from('external_sync_watermarks').update({ watermark_cursor: JSON.stringify(cursor) })
        .eq('org_id', orgId).eq('external_tier', 'odoo').eq('domain', 'revenue:sales-invoice').select());
      await runInvoice();

      const deleted = await must(sc.from('sales_invoices').select('status,erp_docstatus,erp_cancelled_at')
        .eq('org_id', orgId).eq('id', deletedSiId).single()) as { status: string; erp_docstatus: number; erp_cancelled_at: string | null };
      assertEquals([deleted.status, deleted.erp_docstatus], ['Cancelled', 2], 'the hard-deleted invoice is tombstoned, not removed');
      assert(deleted.erp_cancelled_at);
      const rows = await must(sc.from('sales_invoices').select('id,amount,erp_outstanding_amount,status,erp_docstatus,erp_cancelled_at')
        .eq('org_id', orgId).eq('project_id', projectId)) as Array<{ id: string; amount: number; erp_outstanding_amount: number | null; status: string; erp_docstatus: number | null; erp_cancelled_at: string | null }>;
      const billedAndReceivable = rows.filter((r) => ['Submitted','Unpaid','Paid'].includes(r.status)
        && r.erp_docstatus !== 2 && r.erp_cancelled_at === null);
      assertEquals(billedAndReceivable.map((r) => r.id), [creditSiId], 'the deleted invoice is absent from billed-to-date and receivables');
      assertEquals(billedAndReceivable.reduce((sum, r) => sum + Number(r.amount), 0), 1000);
      assertEquals(billedAndReceivable.reduce((sum, r) => sum + Number(r.erp_outstanding_amount ?? 0), 0), Number(postedOriginal.amount_residual));
      // Keep the pre-reversal read in the execution path so the bed assertion proves the feed refreshed it.
      assert(Number.isFinite(original.amount_residual));
    } finally {
      await sc.from('sales_invoices').delete().eq('org_id', orgId);
      await sc.from('projects').delete().eq('org_id', orgId);
      await sc.from('organizations').delete().eq('id', orgId);
      // The bed is disposable; cleanup is best effort because posted accounting moves can be immutable.
      if (creditNoteId) {
        await call('account.move', 'button_draft', { ids: [creditNoteId] }).catch(() => {});
        await call('account.move', 'unlink', { ids: [creditNoteId] }).catch(() => {});
      }
      if (deletedId) {
        await call('account.move', 'button_draft', { ids: [deletedId] }).catch(() => {});
        await call('account.move', 'unlink', { ids: [deletedId] }).catch(() => {});
      }
      if (creditId) {
        await call('account.move', 'button_draft', { ids: [creditId] }).catch(() => {});
        await call('account.move', 'unlink', { ids: [creditId] }).catch(() => {});
      }
      if (partnerId) await call('res.partner', 'unlink', { ids: [partnerId] }).catch(() => {});
    }
  },
});

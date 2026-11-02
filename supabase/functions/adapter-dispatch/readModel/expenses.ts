import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import type { ReadModelWriter } from './types.ts';

/**
 * #775 phase B (ADR-0059 §6, ADR-0081) — the expense side mirror. The intent row exists already (0270 trigger);
 * a landed posting marks it `pushed` with the ERP name. A landed `approval-cancel` also stamps the approval row
 * cancelled, so the feed's later tombstone of that Journal Entry is recognised as PMO's own (no notice).
 * Keyed on (org_id, posting_identity) — never `id` (the L-1 lesson: the mirror's own uuid is not the PMO key).
 */
export const expensesWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    const rec = command.record as { posting?: unknown; posting_identity?: unknown };
    const identity = typeof rec.posting_identity === 'string' ? rec.posting_identity : '';
    if (!identity) throw new AppError('expense posting command carries no posting identity', 'commit-rejected');
    // The adapter sets `canonical.id` to the PMO record id (the subject uuid); the ERP document name travels in
    // `erp_name` (bodies/expenseJournal.ts, bodies/expensePayment.ts). Without it there is nothing a dependent posting
    // could cite — refuse rather than record a name ERPNext does not have.
    const erpName = typeof canonical.erp_name === 'string' && canonical.erp_name ? canonical.erp_name : '';
    if (!erpName) throw new AppError(`expense posting ${identity}: the ERP result carries no ERP document name`, 'commit-rejected');
    const erpModified = (canonical.erp_modified as string | null | undefined) ?? null;
    const now = new Date().toISOString();
    // #1515 §9: a site float transfer lands on its own side mirror (keyed the same way, by posting identity).
    const table = (command.record as { erp_doc_kind?: unknown }).erp_doc_kind === 'imprest-transfer' ? 'imprest_posting_erp_mirror' : 'expense_posting_erp_mirror';
    const write = async (postingIdentity: string, patch: Record<string, unknown>): Promise<void> => {
      const { error } = await (ctx.serviceClient.from(table).update(patch)
        .eq('org_id', ctx.orgId).eq('posting_identity', postingIdentity) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>);
      if (error) throw new AppError(`${table} write failed: ${error.message}`, 'DISPATCH_FAILED');
    };
    await write(identity, {
      push_state: 'pushed', push_error: null, erp_name: erpName, pushed_at: now,
      erp_docstatus: (canonical.erp_docstatus as number | null | undefined) ?? null, erp_modified: erpModified,
    });
    if (rec.posting === 'approval-cancel') {
      await write(identity.replace(/:approval-cancel$/, ':approval'), { erp_docstatus: 2, erp_cancelled_at: now, erp_modified: erpModified });
    }
  },
};

import { AppError } from '../../../../pmo-portal/src/lib/appError.ts';
import { checkLinkSameOrg } from './shared.ts';
import type { ReadModelWriter } from './types.ts';

/** ERPNext `companies` writer (task 3.6, FR-ENA-090): mirrors the adapter's canonical party shape
 *  (`name`/`type`/`erp_party_type`/`erp_supplier_name`/`erp_customer_name`/`erp_tax_id`/
 *  `erp_payment_terms_days`) into the `companies` read-model. `archived_at` is a PMO-owned
 *  enhancement (ADR-0018) — this writer NEVER sets it, on either create or update, so a mirror write
 *  can never clobber a user's soft-archive. */
export const companiesWriter: ReadModelWriter = {
  async upsert(ctx, canonical, command) {
    if (command.record.erp_doc_kind === 'contact') {
      const companyId = command.record.company_id;
      if (typeof companyId !== 'string' || !companyId || await checkLinkSameOrg(ctx, 'companies', companyId) !== 'ok') {
        throw new AppError('Contact company is unavailable', 'cross-org-link-rejected');
      }
      const fields = {
        full_name: canonical.full_name,
        email: canonical.email ?? null,
        phone: canonical.phone ?? null,
        erp_modified: canonical.erp_modified ?? null,
      };
      const query = command.operation === 'create'
        ? ctx.serviceClient.from('contacts').insert({
          id: canonical.id, org_id: ctx.orgId, company_id: companyId,
          title: command.record.title ?? null, notes: command.record.notes ?? null, ...fields,
        })
        : ctx.serviceClient.from('contacts').update(fields).eq('org_id', ctx.orgId).eq('id', canonical.id);
      const { error } = await (query as unknown as Promise<{ error: { message: string; code?: string } | null }>);
      if (error) throw new AppError(error.message, error.code);
      return;
    }
    const patch = {
      name: canonical.name,
      type: canonical.type,
      erp_party_type: (canonical.erp_party_type as string | null | undefined) ?? null,
      erp_supplier_name: (canonical.erp_supplier_name as string | null | undefined) ?? null,
      erp_customer_name: (canonical.erp_customer_name as string | null | undefined) ?? null,
      erp_tax_id: (canonical.erp_tax_id as string | null | undefined) ?? null,
      erp_payment_terms_days: (canonical.erp_payment_terms_days as number | null | undefined) ?? null,
      erp_modified: (canonical.erp_modified as string | null | undefined) ?? null,
    };
    if (command.operation === 'create') {
      const { error } = await ctx.serviceClient.from('companies').insert({ id: canonical.id, org_id: ctx.orgId, ...patch });
      if (error) throw new AppError(error.message, error.code);
      return;
    }
    const { error } = await (
      ctx.serviceClient.from('companies').update(patch).eq('org_id', ctx.orgId).eq('id', canonical.id) as unknown as Promise<{
        error: { message: string; code?: string } | null;
      }>
    );
    if (error) throw new AppError(error.message, error.code);
  },
};

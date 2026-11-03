/**
 * FR-OCI-004 / FR-OCI-050 / FR-OCI-055 (AC-OCI-003, AC-OCI-051/005 link half): the pre-flight an Odoo revenue command passes at adapter
 * selection, BEFORE the outbox row and before any Odoo request. It is the ERPNext link check, reused, plus the receipt's same-scope rule:
 *   - every cross-entity link the command names (customer, project, work order, invoice) belongs to the caller's organisation; an absent
 *     row is refused like a foreign one (`cross-org-link-rejected`);
 *   - an invoice that names a project needs that project's Odoo cost account resolved (FR-OCI-020): unlinked, or a link in needs-attention,
 *     refuses with a named reason. No project is the `require_project_on_si` gate's business. After the link check, so a foreign project is
 *     `cross-org-link-rejected` and not "unlinked";
 *   - a receipt settles exactly one invoice, that invoice is the one Odoo holds (a recorded Odoo reference), and the receipt's customer is
 *     the invoice's customer. The reference and customer are read from PMO's tables, never from the payload.
 * Fails closed on any unreadable input.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { assertCommandLinksSameOrg } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchPreflight.ts';
import { resolveExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { resolveOdooCostAccount } from '../_shared/odooPurchaseRefs.ts';

export async function assertOdooRevenueCommandScope(sc: SupabaseClient, orgId: string, command: AdapterCommand): Promise<void> {
  await assertCommandLinksSameOrg({ command, serviceClient: sc as never, orgId });
  const record = command.record as { erp_doc_kind?: unknown; salesInvoiceId?: unknown; customerId?: unknown; projectId?: unknown };
  if (record.erp_doc_kind === 'sales-invoice' && typeof record.projectId === 'string' && record.projectId !== '') {
    const account = await resolveOdooCostAccount(sc, orgId, record.projectId);
    if (account.status === 'unlinked') throw new AppError('project-unlinked', 'commit-rejected');
    if (account.status === 'needs-attention') throw new AppError(account.reason === 'unreadable' ? 'gate-check-failed' : 'project-needs-attention', 'commit-rejected');
  }
  if (record.erp_doc_kind !== 'incoming-payment' || String(command.operation) !== 'create') return;
  const invoiceId = record.salesInvoiceId;
  if (typeof invoiceId !== 'string' || invoiceId === '') throw new AppError('receipt-invoice-required', 'commit-rejected');
  if (await resolveExternalRef(sc as never, orgId, 'revenue', invoiceId) === null) throw new AppError('receipt-invoice-not-in-odoo', 'commit-rejected');
  const { data, error } = await sc.from('sales_invoices').select('customer_id').eq('org_id', orgId).eq('id', invoiceId).maybeSingle();
  if (error) throw new AppError('gate-check-failed', 'commit-rejected');
  const customer = (data as { customer_id: string | null } | null)?.customer_id;
  if (customer === undefined) throw new AppError('receipt-invoice-not-in-odoo', 'commit-rejected');
  if (typeof record.customerId === 'string' && record.customerId !== '' && record.customerId !== customer) throw new AppError('receipt-customer-mismatch', 'commit-rejected');
}

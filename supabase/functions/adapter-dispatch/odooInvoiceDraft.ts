/**
 * An invoice for an org that employs revenue under Odoo is a PMO DRAFT until its approval (OQ-OCI-1, owner ruling for #1506 C3): authoring and
 * editing it make no Odoo call and leave no outbox row, no Odoo reference and no external mapping. The draft's lines live on the draft row
 * (`sales_invoices.native_lines`, the native line shape, written here by the service role only; a client has no grant on the column and the mirror
 * guard pins it). The approval (`transition submit`, separation of duties enforced before it reaches here) reads the lines from the row and pushes
 * create + post as ONE command (`revenueAdapter.ts`). The author of a draft, and anyone who edits its lines, joins the append-only authorship set
 * the approval's SoD reads, so nobody who chose the lines can approve them.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import type { AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { ODOO_TIER } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { resolveExternalRef, type ExternalRefsLookupClient } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { readOdooProgressClaim } from '../_shared/odooProgressClaim.ts';
import { parseDraftLines, readInvoiceDraft } from '../_shared/odooRevenueRefs.ts';
import { assertOdooRevenueCommandScope } from './odooRevenueGate.ts';

type Reply = { status: number; body: Record<string, unknown> };
const reply = (status: number, error: string, message: string): Reply => ({ status, body: { error, message } });

const isInvoice = (command: Pick<AdapterCommand, 'domain' | 'record'>) => command.domain === 'revenue' && command.record.erp_doc_kind === 'sales-invoice';

/** The operations that author or edit the draft: no Odoo document exists for them (a create is not a push). */
export const isOdooInvoiceDraftWrite = (tier: string | undefined, command: AdapterCommand): boolean =>
  tier === ODOO_TIER && isInvoice(command) && (command.operation === 'create' || command.operation === 'update');

/** The approval is the one command that pushes (`revenueAdapter.isInvoicePush`). */
const isApproval = (command: AdapterCommand): boolean => command.operation === 'transition' && command.record.verb === 'submit';

/**
 * Where the target of an update or an approval stands. An unmapped draft is a PMO row no Odoo document exists for: the transition/update binding
 * (which refuses a record that was never externalized) does not apply to it, because the draft IS the target. Anything already mapped to Odoo
 * keeps the normal binding check.
 */
export async function checkOdooDraftTarget(sc: SupabaseClient, orgId: string, command: AdapterCommand): Promise<{ ok: true; unmappedDraft: boolean } | { ok: false; status: number; message: string }> {
  if (!isInvoice(command) || !(command.operation === 'update' || isApproval(command))) return { ok: true, unmappedDraft: false };
  let draft;
  try { draft = await readInvoiceDraft(sc, orgId, String(command.record.id)); } catch { return { ok: false, status: 503, message: 'The invoice could not be checked' }; }
  if (!draft) return { ok: false, status: 422, message: 'invoice-draft-missing' };
  const mapped = await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'revenue', draft.id);
  if (mapped !== null) return { ok: true, unmappedDraft: false };
  if (draft.pmoNative || draft.status !== 'Draft' || draft.erpDocstatus !== null) return { ok: false, status: 422, message: 'invoice-not-a-draft' };
  return { ok: true, unmappedDraft: true };
}

const lineAmounts = (items: unknown, allowNegative = false) => {
  const lines = parseDraftLines(Array.isArray(items) ? items.map((i: { item_code?: unknown; qty?: unknown; rate?: unknown; description?: unknown }) => ({ item_code: i?.item_code, qty: i?.qty, rate: i?.rate, description: i?.description })) : null, allowNegative);
  return lines === null ? null : { lines, total: lines.reduce((sum, l) => sum + Math.round(l.amount * 100), 0) / 100 };
};

async function appendAuthor(sc: SupabaseClient, orgId: string, invoiceId: string, userId: string): Promise<void> {
  const { error } = await sc.from('sales_invoice_authors').upsert({ org_id: orgId, sales_invoice_id: invoiceId, user_id: userId }, { onConflict: 'sales_invoice_id,user_id', ignoreDuplicates: true });
  if (error) throw new AppError(error.message, error.code);
}

/** Has this invoice ever been sent to the outbox? A draft whose approval has started is no longer the author's to edit. */
async function hasOutboxRow(sc: SupabaseClient, orgId: string, invoiceId: string): Promise<boolean | 'unreadable'> {
  const { data, error } = await sc.from('external_command_outbox').select('id').eq('org_id', orgId).eq('domain', 'revenue').eq('pmo_record_id', invoiceId).limit(1);
  if (error) return 'unreadable';
  return (data ?? []).length > 0;
}

/**
 * Author or edit the draft. Server-side only; the client's `items` are validated to the stored shape and nothing else of the payload is trusted
 * (links are checked against the caller's organisation, the project's Odoo cost account must resolve, the author is the verified caller).
 */
export async function writeOdooInvoiceDraft(args: { serviceClient: SupabaseClient; orgId: string; userId: string; command: AdapterCommand }): Promise<Reply> {
  const { serviceClient: sc, orgId, userId, command } = args;
  const record = command.record as Record<string, unknown> & { id: string };
  let claim: Awaited<ReturnType<typeof readOdooProgressClaim>> = null;
  try {
    claim = await readOdooProgressClaim(sc, orgId, String(record.id));
    if (claim && command.operation === 'update') return reply(409, 'commit-rejected', 'claim-invoice-lines-locked');
    const scopedCommand = claim ? { ...command, record: {
      ...record, customerId: claim.customerId, projectId: claim.claim.project_id, workOrderId: claim.claim.work_order_id,
    } } as AdapterCommand : command;
    await assertOdooRevenueCommandScope(sc, orgId, scopedCommand);   // links in this org; the project's cost account resolves (FR-OCI-020)
  } catch (err) {
    if (err instanceof AppError) return reply(422, String(err.code ?? 'commit-rejected'), err.message);
    throw err;
  }
  const items = lineAmounts(claim?.items ?? record.items, claim !== null);
  const reference = claim ? null : typeof record.reference_number === 'string' && record.reference_number.trim() !== '' ? record.reference_number.trim() : null;

  if (command.operation === 'create') {
    if (items === null) return reply(422, 'commit-rejected', 'invoice-lines-invalid');
    const customerId = claim?.customerId ?? (typeof record.customerId === 'string' && record.customerId !== '' ? record.customerId : null);
    if (customerId === null) return reply(422, 'commit-rejected', 'invoice-customer-required');
    const projectId = claim?.claim.project_id ?? (typeof record.projectId === 'string' && record.projectId !== '' ? record.projectId : null);
    const workOrderId = claim?.claim.work_order_id ?? (typeof record.workOrderId === 'string' && record.workOrderId !== '' ? record.workOrderId : null);
    const { error } = await sc.from('sales_invoices').insert({
      id: record.id, org_id: orgId, project_id: projectId, customer_id: customerId, ...(workOrderId ? { work_order_id: workOrderId } : {}),
      ...(claim?.claim.currency ? { currency: claim.claim.currency } : {}),
      ...(!claim && projectId && (record.billingKind === 'contract' || record.billingKind === 'other') ? { billing_kind: record.billingKind } : {}),
      reference_number: reference, native_lines: items.lines, amount: items.total, tax_treatment: 'exclusive', tax_amount: 0, status: 'Draft', author_user_id: userId,
    });
    if (error) return reply(error.code === '23505' ? 422 : 500, 'commit-rejected', error.code === '23505' ? 'a revenue create must name a new record' : 'The invoice draft could not be saved');
    await appendAuthor(sc, orgId, record.id, userId);
    return { status: 200, body: { externalRecordId: null, canonical: { id: record.id, si_number: null, status: 'Draft' }, draft: true } };
  }

  // update: only while it is a draft no approval has started
  const draft = await readInvoiceDraft(sc, orgId, record.id);
  if (!draft || draft.pmoNative || draft.status !== 'Draft' || draft.erpDocstatus !== null) return reply(422, 'commit-rejected', 'invoice-not-a-draft');
  const started = await hasOutboxRow(sc, orgId, record.id);
  if (started === 'unreadable') return reply(503, 'commit-rejected', 'The invoice could not be checked');
  if (started) return reply(409, 'commit-rejected', 'invoice-approval-started');
  if (record.items !== undefined && items === null) return reply(422, 'commit-rejected', 'invoice-lines-invalid');
  const patch = { ...(items ? { native_lines: items.lines, amount: items.total } : {}), ...(Object.hasOwn(record, 'reference_number') ? { reference_number: reference } : {}), author_user_id: userId };
  const { error } = await sc.from('sales_invoices').update(patch).eq('org_id', orgId).eq('id', record.id);
  if (error) return reply(500, 'commit-rejected', 'The invoice draft could not be saved');
  await appendAuthor(sc, orgId, record.id, userId);   // whoever chose the lines can never approve them
  return { status: 200, body: { externalRecordId: null, canonical: { id: record.id, si_number: null, status: 'Draft' }, draft: true } };
}

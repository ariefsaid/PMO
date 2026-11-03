/**
 * The PMO-side facts an Odoo customer invoice needs, read before any write (FR-OCI-010/013/020/023, FR-ODC-102). The invoice is a PMO DRAFT until
 * its approval (OQ-OCI-1): its lines live on the draft row (`sales_invoices.native_lines`, written by the dispatch only), and the approval reads
 * them from there, never from the command. Everything is read with the service client, scoped to the org; nothing here trusts the payload for a
 * fact the database owns. A value that cannot be resolved is explicit (`unlinked`, a named refusal), never a default or a guess.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { AdapterError, type AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { resolveExternalRef, type ExternalRefsLookupClient } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { resolveClientReference, type InvoiceMaps, type PmoInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceBody.ts';
import { expectedInvoiceTotal, type InvoiceExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.ts';
import { selectSaleTaxes, type SaleTax } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/taxValidate.ts';
import { resolveOdooCostAccount } from './odooPurchaseRefs.ts';

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };
const rejected = (message: string) => new AppError(message, 'config-rejected');
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const asMap = (value: unknown): Record<string, string> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' && v !== '')) as Record<string, string>
    : {};

/** One line of a draft, as the PMO draft stores it (the native line shape). */
export interface DraftLine { item_code: string; description: string | null; qty: number; rate: number; amount: number }
export interface InvoiceDraftRow {
  id: string; customerId: string | null; projectId: string | null; workOrderId: string | null; referenceNumber: string | null;
  invoiceDate: string | null; currency: string | null; status: string; erpDocstatus: number | null; pmoNative: boolean; lines: DraftLine[];
}
const DRAFT_COLUMNS = 'id,customer_id,project_id,work_order_id,reference_number,invoice_date,currency,status,erp_docstatus,pmo_native,native_lines';

/** A line is valid only in its stored shape: a code, a positive quantity, a finite non-negative rate, and an amount of qty x rate to the cent. */
export function parseDraftLines(value: unknown): DraftLine[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const lines: DraftLine[] = [];
  for (const raw of value) {
    const l = raw as { item_code?: unknown; description?: unknown; qty?: unknown; rate?: unknown; amount?: unknown } | null;
    const code = text(l?.item_code);
    if (!l || !code || typeof l.qty !== 'number' || !(l.qty > 0) || typeof l.rate !== 'number' || !Number.isFinite(l.rate) || l.rate < 0) return null;
    lines.push({ item_code: code, description: text(l.description), qty: l.qty, rate: l.rate, amount: Math.round(l.qty * l.rate * 100) / 100 });
  }
  return lines;
}

/** The draft row of this org, or null when there is none. A read that cannot answer throws (fail closed). */
export async function readInvoiceDraft(sc: SupabaseClient, orgId: string, id: string): Promise<InvoiceDraftRow | null> {
  const { data, error } = await sc.from('sales_invoices').select(DRAFT_COLUMNS).eq('org_id', orgId).eq('id', id).maybeSingle();
  if (error) throw new AppError('The invoice could not be read', 'gate-check-failed');
  if (!data) return null;
  const r = data as Record<string, unknown>;
  return {
    id: String(r.id), customerId: text(r.customer_id), projectId: text(r.project_id), workOrderId: text(r.work_order_id), referenceNumber: text(r.reference_number),
    invoiceDate: text(r.invoice_date), currency: text(r.currency), status: String(r.status), erpDocstatus: typeof r.erp_docstatus === 'number' ? r.erp_docstatus : null,
    pmoNative: r.pmo_native === true, lines: parseDraftLines(r.native_lines) ?? [],
  };
}

type Resolved = { companyId: number | null; config: Record<string, unknown> };

/** The sale tax the org chose as its default (by id), checked against the mirrored directory and Odoo's own company for it (SD-9). */
async function readSaleTax(sc: SupabaseClient, orgId: string, call: OdooCall, id: number): Promise<SaleTax[]> {
  const mirror = await sc.from('external_master_records').select('external_id,name,active,tombstoned_at,attrs').eq('org_id', orgId).eq('external_tier', 'odoo').eq('kind', 'tax').eq('external_id', String(id));
  if (mirror.error) throw rejected('config-rejected: the sale tax directory could not be read');
  const rows = (mirror.data ?? []) as Array<{ external_id: string; name: string; active: boolean; tombstoned_at: string | null; attrs: { amount?: unknown; use?: unknown; tax_group?: unknown; price_include?: unknown } | null }>;
  if (rows.length === 0) return [];
  let company: unknown;
  try { company = (await call<Array<{ company_id?: unknown }>>('account.tax', 'read', { ids: [id], fields: ['company_id'], context: { lang: 'en_US' } }))[0]?.company_id; } catch { throw rejected('config-rejected: the chosen sale tax could not be checked against Odoo'); }
  const companyId = Array.isArray(company) ? Number(company[0]) : -1;
  return rows.flatMap((r) => typeof r.attrs?.amount === 'number'
    ? [{ id, name: r.name, rate: r.attrs.amount, active: r.active === true && r.tombstoned_at === null, companyId, scope: text(r.attrs.use) ?? '', priceIncluded: r.attrs.price_include === true, taxGroup: text(r.attrs.tax_group) }]
    : []);
}

/** Odoo's company currency (the only currency PMO invoices in, OQ-OCI-13) as `[id, code]`; unreadable is refused. */
async function companyCurrency(call: OdooCall, companyId: number | null): Promise<string> {
  const unreadable = () => rejected('currency-unreadable: the invoice currency could not be confirmed against Odoo');
  if (companyId === null) throw unreadable();
  let company: Array<{ currency_id?: unknown }>;
  try { company = await call<Array<{ currency_id?: unknown }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] }); } catch { throw unreadable(); }
  const cur = company[0]?.currency_id;
  if (!Array.isArray(cur) || typeof cur[1] !== 'string' || cur[1].trim() === '') throw unreadable();
  return cur[1].trim().toUpperCase();
}

/** The Odoo products the lines name and the income account each posts to (`false` = none set: the line is refused, never guessed). */
async function readProducts(call: OdooCall, ids: number[]): Promise<Map<number, number | null>> {
  if (ids.length === 0) return new Map();
  let rows: Array<{ id: number; property_account_income_id?: unknown }>;
  try { rows = await call('product.product', 'read', { ids, fields: ['property_account_income_id'] }); } catch { throw rejected('config-rejected: the invoice items could not be checked against Odoo'); }
  return new Map(rows.map((r) => [r.id, Array.isArray(r.property_account_income_id) ? Number(r.property_account_income_id[0]) : null]));
}

const resolvedInvoices = new WeakMap<object, Promise<{ input: PmoInvoice; maps: InvoiceMaps; expect: InvoiceExpect; draft: InvoiceDraftRow }>>();

/**
 * An invoice approval: the draft's own client, project, work order and lines (the command's are replaced by them), the client's reference resolved
 * exactly as the ERPNext path resolves it (invoice, else work order PO, else project contract reference) BEFORE the outbox snapshots the command,
 * the project's cost account, the explicit taxes (the project's VAT flag decides; an invoice with no project is taxed as the ERPNext path taxes it),
 * and the figure Odoo is expected to answer. One resolution per command: adapter selection resolves (and so refuses, before any outbox row) and the
 * adapter reuses it. A `replay` (the command already left an outbox row) relaxes only the draft-state check.
 */
export function resolveOdooInvoiceInputs(sc: SupabaseClient, orgId: string, command: AdapterCommand, resolved: Resolved, call: OdooCall, replay = false): Promise<{ input: PmoInvoice; maps: InvoiceMaps; expect: InvoiceExpect; draft: InvoiceDraftRow }> {
  const memo = resolvedInvoices.get(command);
  if (memo) return memo;
  const run = (async () => {
    const record = command.record as Record<string, unknown>;
    const draft = await readInvoiceDraft(sc, orgId, String(record.id));
    if (!draft) return refuse('invoice-draft-missing');
    if (draft.pmoNative) return refuse('invoice-raised-in-pmo');
    // A retry of the same intent (its outbox row exists) may meet the invoice already pushed: the lines are the draft's still, and the outbox answers it.
    if (!replay && (draft.status !== 'Draft' || draft.erpDocstatus !== null)) return refuse('invoice-not-a-draft');
    if (draft.lines.length === 0) return refuse('invoice-draft-lines-missing');
    if (resolved.companyId === null) return refuse('company-not-set');

    const project = draft.projectId
      ? await sc.from('projects').select('subject_to_vat,customer_contract_ref').eq('org_id', orgId).eq('id', draft.projectId).maybeSingle()
      : null;
    if (project?.error) throw new AppError('The project could not be read', 'gate-check-failed');
    const vat = (project?.data as { subject_to_vat?: unknown } | null | undefined)?.subject_to_vat;
    if (draft.projectId && typeof vat !== 'boolean') throw rejected('config-rejected: the project VAT context could not be verified');
    const workOrder = draft.workOrderId
      ? await sc.from('work_orders').select('client_po_number').eq('org_id', orgId).eq('id', draft.workOrderId).maybeSingle()
      : null;
    if (workOrder?.error) throw new AppError('The work order could not be read', 'gate-check-failed');
    const workOrderPo = text((workOrder?.data as { client_po_number?: unknown } | null | undefined)?.client_po_number);
    const contractRef = text((project?.data as { customer_contract_ref?: unknown } | null | undefined)?.customer_contract_ref);

    let costAccountId: number | null = null;
    if (draft.projectId) {
      const account = await resolveOdooCostAccount(sc, orgId, draft.projectId);
      if (account.status !== 'resolved') return refuse(account.status === 'unlinked' ? 'project-unlinked' : 'project-needs-attention');
      costAccountId = Number(account.accountId);
    }

    const customerRef = draft.customerId ? await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'companies', draft.customerId) : null;
    const partner = Number(/^Client:(\d+)$/.exec(customerRef ?? '')?.[1]);
    const partners: Record<string, number> = draft.customerId && Number.isInteger(partner) && partner > 0 ? { [draft.customerId]: partner } : {};

    const itemMap = asMap(resolved.config.item_map);
    const productIds = [...new Set(draft.lines.flatMap((l) => (/^[1-9][0-9]*$/.test(itemMap[l.item_code] ?? '') ? [Number(itemMap[l.item_code])] : [])))];
    const incomeOf = await readProducts(call, productIds);
    const items: Record<string, { productId: number; incomeAccountId: number | null }> = {};
    for (const l of draft.lines) {
      const productId = Number(itemMap[l.item_code]);
      if (Number.isInteger(productId) && productId > 0) items[l.item_code] = { productId, incomeAccountId: incomeOf.get(productId) ?? null };
    }

    const saleTaxId = Number.isInteger(resolved.config.sale_tax_id) && (resolved.config.sale_tax_id as number) > 0 ? resolved.config.sale_tax_id as number : null;
    const vatFlag = draft.projectId ? vat === true : true;
    const taxes = vatFlag && saleTaxId !== null ? await readSaleTax(sc, orgId, call, saleTaxId) : [];
    const selection = selectSaleTaxes({ vatFlag, defaultTaxId: saleTaxId, taxes, companyId: resolved.companyId });
    if (selection.outcome === 'refused') throw rejected(`config-rejected: the sale tax${selection.tax ? ` ${selection.tax}` : ''} cannot be used on an invoice`);
    const rates = taxes.filter((t) => selection.taxIds.includes(t.id)).map((t) => t.rate);

    const lines = draft.lines.map((l) => ({ itemId: l.item_code, description: l.description ?? l.item_code, quantity: l.qty, unitPrice: l.rate }));
    const reference = resolveClientReference({ invoice: draft.referenceNumber, workOrderPo, projectContractRef: contractRef });
    const today = new Date().toISOString().slice(0, 10);
    const input: PmoInvoice = {
      id: draft.id, customerId: draft.customerId ?? '', invoiceDate: draft.invoiceDate ?? today, currency: draft.currency ?? '', lines,
      referenceNumber: draft.referenceNumber, workOrderPoNumber: workOrderPo, projectContractRef: contractRef,
    };
    const maps: InvoiceMaps = { companyCurrency: await companyCurrency(call, resolved.companyId), partners, items, units: {}, costAccountId, taxIds: selection.taxIds };

    // The command is what the draft says: the client's, project's, work order's and lines' values REPLACE whatever the payload carried, so the
    // outbox payload, its digest, the work-order fence and the recovery all read the approved draft (never the approver's say-so).
    record.customerId = draft.customerId;
    record.projectId = draft.projectId;
    record.workOrderId = draft.workOrderId;
    record.currency = draft.currency;
    record.items = draft.lines.map((l) => ({ item_code: l.item_code, qty: l.qty, rate: l.rate, ...(l.description ? { description: l.description } : {}) }));
    record.reference_number = reference;
    delete record.taxes;
    return { input, maps, expect: { total: expectedInvoiceTotal(lines, rates), costAccountId }, draft };
  })();
  resolvedInvoices.set(command, run);
  return run;
}

/** The client's Odoo partner, from PMO's tables only: what a recovery's composite looks by (null when unmapped). */
export async function invoiceCompositeFacts(sc: SupabaseClient, orgId: string, record: { id?: unknown }): Promise<{ partnerId: number | null }> {
  const draft = await readInvoiceDraft(sc, orgId, String(record.id));
  const customerRef = draft?.customerId ? await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'companies', draft.customerId) : null;
  const partner = Number(/^Client:(\d+)$/.exec(customerRef ?? '')?.[1]);
  return { partnerId: Number.isInteger(partner) && partner > 0 ? partner : null };
}

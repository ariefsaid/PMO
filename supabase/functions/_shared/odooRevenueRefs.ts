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
import { parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import { resolveClientReference, type InvoiceMaps, type PmoInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceBody.ts';
import { expectedInvoiceTotal, type InvoiceExpect } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/invoiceReadBack.ts';
import { odooCurrencyAmountsEqual, odooFloatRound, odooLineSubtotal } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/odooRounding.ts';
import type { ReceiptDefaults, ReceiptInput, ReceiptInvoice } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/receiptBody.ts';
import { selectSaleTaxes, type SaleTax } from '../../../pmo-portal/src/lib/adapterSeam/odoo/revenue/taxValidate.ts';
import { formatTimeMaterialsDescription } from '../../../pmo-portal/src/lib/adapterSeam/erpnext/dispatchRevenueFormatting.ts';
import { readOdooProgressClaim } from './odooProgressClaim.ts';
import { resolveOdooCostAccount } from './odooPurchaseRefs.ts';

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };
const rejected = (message: string) => new AppError(message, 'config-rejected');
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const asMap = (value: unknown): Record<string, string> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' && v !== '')) as Record<string, string>
    : {};

/** One line of a draft, as the PMO draft stores it (the native line shape). */
export interface DraftLine { item_code: string; description: string | null; qty: number; rate: number; amount: number; unit?: string }
export interface InvoiceDraftRow {
  id: string; customerId: string | null; projectId: string | null; workOrderId: string | null; referenceNumber: string | null;
  invoiceDate: string | null; currency: string | null; status: string; erpDocstatus: number | null; pmoNative: boolean; lines: DraftLine[];
}
const DRAFT_COLUMNS = 'id,customer_id,project_id,work_order_id,reference_number,invoice_date,currency,status,erp_docstatus,pmo_native,native_lines';

/** A line is valid only in its stored shape: a code, a positive quantity, a finite rate and a verified amount to the cent. */
export function parseDraftLines(value: unknown, allowNegative = false, preserveRecordedAmounts = false): DraftLine[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const lines: DraftLine[] = [];
  for (const raw of value) {
    const l = raw as { item_code?: unknown; description?: unknown; qty?: unknown; rate?: unknown; amount?: unknown; unit?: unknown } | null;
    const code = text(l?.item_code);
    if (!l || !code || typeof l.qty !== 'number' || !(l.qty > 0) || typeof l.rate !== 'number' || !Number.isFinite(l.rate) || (!allowNegative && l.rate < 0)) return null;
    const recordedAmount = typeof l.amount === 'number' ? l.amount : typeof l.amount === 'string' && l.amount.trim() !== '' ? Number(l.amount) : NaN;
    const amount = preserveRecordedAmounts ? recordedAmount : odooFloatRound(l.qty * l.rate, { precisionDigits: 2 });
    if (!Number.isFinite(amount) || odooFloatRound(amount, { precisionDigits: 2 }) !== amount) return null;
    const unit = preserveRecordedAmounts && l.unit !== undefined ? text(l.unit) : null;
    if (preserveRecordedAmounts && l.unit !== undefined && unit === null) return null;
    lines.push({ item_code: code, description: text(l.description), qty: l.qty, rate: l.rate, amount, ...(unit ? { unit } : {}) });
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
    pmoNative: r.pmo_native === true, lines: parseDraftLines(r.native_lines, true, true) ?? [],
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

/** Odoo's company currency and its actual rounding increment (OQ-OCI-13); unreadable configuration is refused. */
async function companyCurrency(call: OdooCall, companyId: number | null): Promise<{ code: string; rounding: number }> {
  const unreadable = () => rejected('currency-unreadable: the invoice currency could not be confirmed against Odoo');
  if (companyId === null) throw unreadable();
  let company: Array<{ currency_id?: unknown }>;
  try { company = await call<Array<{ currency_id?: unknown }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] }); } catch { throw unreadable(); }
  const cur = company[0]?.currency_id;
  const currencyId = Array.isArray(cur) ? Number(cur[0]) : NaN;
  if (!Number.isInteger(currencyId) || currencyId <= 0 || !Array.isArray(cur) || typeof cur[1] !== 'string' || cur[1].trim() === '') throw unreadable();
  let currencies: Array<{ rounding?: unknown }>;
  try { currencies = await call<Array<{ rounding?: unknown }>>('res.currency', 'read', { ids: [currencyId], fields: ['rounding'] }); } catch {
    throw rejected('config-rejected: the invoice currency rounding could not be read');
  }
  const rounding = Number(currencies[0]?.rounding);
  if (!Number.isFinite(rounding) || rounding <= 0) throw rejected('config-rejected: the invoice currency rounding could not be read');
  return { code: cur[1].trim().toUpperCase(), rounding };
}

/** account.move.line.quantity uses digits="Product Unit"; Odoo's ORM rounds it through float_round. */
async function productUnitRounding(call: OdooCall, timeMaterials: boolean): Promise<number> {
  const message = timeMaterials
    ? 'config-rejected: the product unit precision could not be checked against Odoo'
    : 'config-rejected: the product-unit quantity precision could not be read';
  let rows: Array<{ digits?: unknown }>;
  try {
    rows = await call<Array<{ digits?: unknown }>>('decimal.precision', 'search_read', {
      domain: [['name', '=', 'Product Unit']], fields: ['digits'], limit: 2,
    });
  } catch {
    throw rejected(message);
  }
  const digits = rows.length === 1 ? Number(rows[0].digits) : NaN;
  if (!Number.isInteger(digits) || digits < 0 || digits > 12) throw rejected(message);
  return 10 ** -digits;
}

/** The Odoo products the lines name and the income account each posts to (`false` = none set: the line is refused, never guessed). */
async function readProducts(call: OdooCall, ids: number[]): Promise<Map<number, number | null>> {
  if (ids.length === 0) return new Map();
  let rows: Array<{ id: number; property_account_income_id?: unknown }>;
  try { rows = await call('product.product', 'read', { ids, fields: ['property_account_income_id'] }); } catch { throw rejected('config-rejected: the invoice items could not be checked against Odoo'); }
  return new Map(rows.map((r) => [r.id, Array.isArray(r.property_account_income_id) ? Number(r.property_account_income_id[0]) : null]));
}

/** The mirrored item and a live liability account must agree before any Odoo read or write. */
async function customerAdvanceAccount(
  sc: SupabaseClient,
  orgId: string,
  companyId: number,
  itemCode: string,
  productId: number,
  accountRef: unknown,
): Promise<{ productId: number; accountId: number }> {
  const accountId = parseOdooExternalRef('account.account', accountRef);
  const refuseItem = () => { throw rejected(`config-rejected: down-payment-account: ${itemCode}`); };
  if (accountId === null) return refuseItem();

  const [product, account] = await Promise.all([
    sc.from('external_master_records').select('active,tombstoned_at,attrs').eq('org_id', orgId).eq('external_tier', 'odoo')
      .eq('kind', 'product').eq('external_id', String(productId)).maybeSingle(),
    sc.from('external_master_records').select('active,tombstoned_at,attrs').eq('org_id', orgId).eq('external_tier', 'odoo')
      .eq('kind', 'account').eq('external_id', String(accountId)).maybeSingle(),
  ]);
  if (product.error || account.error) throw rejected(`config-rejected: down-payment-account: ${itemCode}`);
  const productRow = product.data as { active?: unknown; tombstoned_at?: unknown; attrs?: { income_account_id?: unknown } | null } | null;
  const accountRow = account.data as { active?: unknown; tombstoned_at?: unknown; attrs?: { account_type?: unknown; company_ids?: unknown } | null } | null;
  const companies = accountRow?.attrs?.company_ids;
  if (!productRow || productRow.active !== true || productRow.tombstoned_at !== null
    || !accountRow || accountRow.active !== true || accountRow.tombstoned_at !== null
    || productRow.attrs?.income_account_id !== String(accountId)
    || typeof accountRow.attrs?.account_type !== 'string' || !accountRow.attrs.account_type.startsWith('liability') || accountRow.attrs.account_type === 'liability_payable'
    || !Array.isArray(companies) || !companies.includes(String(companyId))) return refuseItem();
  return { productId, accountId };
}

const resolvedInvoices = new WeakMap<object, Promise<{ input: PmoInvoice; maps: InvoiceMaps; expect: InvoiceExpect; draft: InvoiceDraftRow }>>();

export interface OdooInvoiceCommandMaterial { draft: InvoiceDraftRow; input: PmoInvoice; vatFlag: boolean }

/** Rebuild command material from PMO's draft without consulting mutable Odoo mappings. Recovery uses it to retain the
 * payload-digest guard while judging the landed document against the expectations frozen in its outbox row. */
export async function resolveOdooInvoiceCommandMaterial(
  sc: SupabaseClient, orgId: string, command: AdapterCommand, replay = false,
): Promise<OdooInvoiceCommandMaterial> {
  const record = command.record as Record<string, unknown>;
  const draft = await readInvoiceDraft(sc, orgId, String(record.id));
  if (!draft) return refuse('invoice-draft-missing');
  if (draft.pmoNative) return refuse('invoice-raised-in-pmo');
  if (!replay && (draft.status !== 'Draft' || draft.erpDocstatus !== null)) return refuse('invoice-not-a-draft');
  if (draft.lines.length === 0) return refuse('invoice-draft-lines-missing');

  const project = draft.projectId
    ? await sc.from('projects').select('subject_to_vat,customer_contract_ref').eq('org_id', orgId).eq('id', draft.projectId).maybeSingle()
    : null;
  if (project?.error) throw new AppError('The project could not be read', 'gate-check-failed');
  const projectFacts = project?.data as { subject_to_vat?: unknown; customer_contract_ref?: unknown } | null | undefined;
  const vat = projectFacts?.subject_to_vat;
  if (draft.projectId && typeof vat !== 'boolean') throw rejected('config-rejected: the project VAT context could not be verified');

  const workOrder = draft.workOrderId
    ? await sc.from('work_orders').select('client_po_number').eq('org_id', orgId).eq('id', draft.workOrderId).maybeSingle()
    : null;
  if (workOrder?.error) throw new AppError('The work order could not be read', 'gate-check-failed');
  const workOrderPo = text((workOrder?.data as { client_po_number?: unknown } | null | undefined)?.client_po_number);
  const contractRef = text(projectFacts?.customer_contract_ref);
  const lines = draft.lines.map((line) => ({
    itemId: line.item_code, description: line.description ?? line.item_code, quantity: line.qty, unitPrice: line.rate,
  }));
  const reference = resolveClientReference({ invoice: draft.referenceNumber, workOrderPo, projectContractRef: contractRef });
  const input: PmoInvoice = {
    id: draft.id, customerId: draft.customerId ?? '', invoiceDate: draft.invoiceDate ?? new Date().toISOString().slice(0, 10),
    currency: draft.currency ?? '', lines, referenceNumber: draft.referenceNumber, workOrderPoNumber: workOrderPo, projectContractRef: contractRef,
  };

  record.customerId = draft.customerId;
  record.projectId = draft.projectId;
  record.workOrderId = draft.workOrderId;
  record.currency = draft.currency;
  record.items = draft.lines.map((line) => ({ item_code: line.item_code, qty: line.qty, rate: line.rate, ...(line.description ? { description: line.description } : {}) }));
  record.reference_number = reference;
  delete record.taxes;
  return { draft, input, vatFlag: draft.projectId ? vat === true : true };
}

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
    const claim = await readOdooProgressClaim(sc, orgId, draft.id);
    if (claim) {
      const recorded = claim.items.map((line) => ({
        item_code: line.item_code, qty: line.qty, rate: line.rate, amount: line.amount, description: text(line.description),
        ...(claim.timeMaterials && line.unit ? { unit: line.unit } : {}),
      }));
      const copied = draft.lines.map((line) => ({
        item_code: line.item_code, qty: line.qty, rate: line.rate, amount: line.amount, description: line.description,
        ...(claim.timeMaterials && line.unit ? { unit: line.unit } : {}),
      }));
      if (draft.customerId !== claim.customerId || draft.projectId !== claim.claim.project_id || draft.workOrderId !== claim.claim.work_order_id
        || draft.currency !== claim.claim.currency || draft.referenceNumber !== null || JSON.stringify(copied) !== JSON.stringify(recorded)) {
        return refuse('claim-invoice-draft-mismatch');
      }
    }

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
    const advanceItemCode = claim && (claim.claim.kind === 'down_payment' || Number(claim.claim.dp_recovery_amount) > 0)
      ? claim.claim.dp_item_code : null;
    let downPayment: { itemId: string; advanceAccountId: number } | undefined;
    let advanceAccount: InvoiceExpect['advanceAccount'];
    if (claim && (claim.claim.kind === 'down_payment' || Number(claim.claim.dp_recovery_amount) > 0)) {
      if (!advanceItemCode || !/^[1-9][0-9]*$/.test(itemMap[advanceItemCode] ?? '')) {
        throw rejected(`config-rejected: down-payment-account: ${advanceItemCode ?? 'missing down-payment item'}`);
      }
      const validated = await customerAdvanceAccount(sc, orgId, resolved.companyId, advanceItemCode, Number(itemMap[advanceItemCode]), resolved.config.customer_advance_account_ref);
      downPayment = { itemId: advanceItemCode, advanceAccountId: validated.accountId };
      advanceAccount = validated;
    }
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
    const [quantityRounding, currency] = await Promise.all([productUnitRounding(call, claim?.timeMaterials === true), companyCurrency(call, resolved.companyId)]);

    const lines = draft.lines.map((l, i) => {
      const item = {
        itemId: l.item_code, description: l.description ?? l.item_code, quantity: l.qty, unitPrice: l.rate,
        ...(claim?.timeMaterials ? { amount: l.amount, unit: l.unit } : {}),
        ...(claim ? { kind: claim.claim.kind === 'down_payment' ? 'down-payment' as const
          : l.item_code === claim.claim.dp_item_code && l.rate < 0 ? 'recovery' as const : undefined } : {}),
      };
      if (odooCurrencyAmountsEqual(odooLineSubtotal(l.qty, l.rate, quantityRounding, currency.rounding), l.amount, currency.rounding)) return item;
      if (!odooCurrencyAmountsEqual(odooLineSubtotal(1, l.amount, quantityRounding, currency.rounding), l.amount, currency.rounding)) {
        throw rejected('config-rejected: the invoice currency rounding cannot preserve the signed line amount');
      }
      const claimItem = claim?.items[i];
      const sourceDescription = l.description ?? l.item_code;
      const unitSuffix = /^(.*) \(([^()]*)\)$/.exec(sourceDescription);
      const hasUnitSuffix = unitSuffix !== null && (!claimItem?.unit || unitSuffix[2] === claimItem.unit);
      const description = formatTimeMaterialsDescription(
        hasUnitSuffix ? unitSuffix[1] : sourceDescription,
        claimItem?.unit ?? (hasUnitSuffix ? unitSuffix[2] : 'unit'),
        l.qty, l.rate, l.amount, currency.code,
      );
      return { ...item, description, quantity: 1, unitPrice: l.amount };
    });
    const reference = resolveClientReference({ invoice: draft.referenceNumber, workOrderPo, projectContractRef: contractRef });
    const today = new Date().toISOString().slice(0, 10);
    const input: PmoInvoice = {
      id: draft.id, customerId: draft.customerId ?? '', invoiceDate: draft.invoiceDate ?? today, currency: draft.currency ?? '', lines,
      referenceNumber: draft.referenceNumber, workOrderPoNumber: workOrderPo, projectContractRef: contractRef,
    };
    const units = Object.fromEntries(Object.entries(asMap(resolved.config.unit_map)).flatMap(([unit, id]) => {
      const parsed = Number(id);
      return Number.isInteger(parsed) && parsed > 0 ? [[unit, parsed]] : [];
    }));
    const maps: InvoiceMaps = {
      companyCurrency: currency.code, currencyRounding: currency.rounding, quantityRounding, partners, items, units, costAccountId, taxIds: selection.taxIds,
      ...(downPayment ? { downPayment } : {}),
    };

    // The command is what the draft says: the client's, project's, work order's and lines' values REPLACE whatever the payload carried, so the
    // outbox payload, its digest, the work-order fence and the recovery all read the approved draft (never the approver's say-so).
    record.customerId = draft.customerId;
    record.projectId = draft.projectId;
    record.workOrderId = draft.workOrderId;
    record.currency = draft.currency;
    record.items = lines.map((l, i) => ({
      item_code: l.itemId, qty: l.quantity, rate: l.unitPrice, amount: draft.lines[i].amount,
      ...(l.description ? { description: l.description } : {}),
      ...(claim?.timeMaterials && draft.lines[i].unit ? { unit: draft.lines[i].unit } : {}),
    }));
    record.reference_number = reference;
    delete record.taxes;
    return {
      input, maps,
      expect: { total: expectedInvoiceTotal(lines.map((line, i) => ({ ...line, amount: draft.lines[i].amount })), rates, currency.rounding), costAccountId, ...(advanceAccount ? { advanceAccount } : {}) },
      draft,
    };
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

export interface ResolvedReceiptInputs {
  input: ReceiptInput;
  invoice: ReceiptInvoice | null;
  defaults: ReceiptDefaults;
  invoiceRef: string;
}
const resolvedReceipts = new WeakMap<object, Promise<ResolvedReceiptInputs>>();

const scalarId = (value: unknown): number | null => {
  const id = Array.isArray(value) ? Number(value[0]) : Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
};
const relationCurrency = (value: unknown, fallback: string): string | null =>
  Array.isArray(value) && typeof value[1] === 'string' && value[1] !== '' ? value[1].toUpperCase() : value === false || value == null ? fallback : null;
const positiveId = (value: unknown): number | null => {
  const id = typeof value === 'string' && /^[1-9][0-9]{0,8}$/.test(value) ? Number(value) : typeof value === 'number' ? value : null;
  return Number.isInteger(id) && id! > 0 ? id : null;
};
const isReceiptMoney = (value: unknown): value is number | string | null | undefined =>
  value === undefined || value === null || typeof value === 'number' || typeof value === 'string';
const validReceiptDate = (value: unknown): value is string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};

/** Resolve all receipt facts from the PMO row, Odoo invoice, directory and binding before the money outbox opens. */
export function resolveOdooReceiptInputs(
  sc: SupabaseClient,
  orgId: string,
  command: AdapterCommand,
  companyId: number | null,
  config: Record<string, unknown>,
  call: OdooCall,
  recordedBy: string,
): Promise<ResolvedReceiptInputs> {
  const memo = resolvedReceipts.get(command);
  if (memo) return memo;
  const run = (async () => {
    const record = command.record as Record<string, unknown>;
    const invoiceId = text(record.salesInvoiceId);
    const customerId = text(record.customerId);
    if (!invoiceId || !customerId) return refuse('receipt-invoice-required');
    if (!validReceiptDate(record.date)) return refuse('date');
    if (companyId === null) return refuse('receipt-company-unavailable');
    const withheldAmount = Number(record.withheld_amount ?? 0);
    if (!Number.isFinite(withheldAmount) || withheldAmount < 0) return refuse('amounts');
    // Configuration and mirrored directory checks happen before any Odoo call. A stale or missing default must not
    // consume ERP capacity or create an outbox intent that can never be safely executed.
    const journalId = positiveId(record.journalId) ?? positiveId(config.default_payment_journal_id);
    if (!journalId) return refuse('journal-missing');
    const journalMirror = await sc.from('external_master_records').select('active,tombstoned_at,attrs').eq('org_id', orgId)
      .eq('external_tier', 'odoo').eq('kind', 'journal').eq('external_id', String(journalId)).maybeSingle();
    if (journalMirror.error) throw rejected('The Odoo receipt journal could not be verified');
    const journalDirectory = journalMirror.data as { active?: boolean; tombstoned_at?: string | null; attrs?: { type?: unknown } | null } | null;
    if (!journalDirectory || journalDirectory.active !== true || journalDirectory.tombstoned_at !== null || !['bank', 'cash'].includes(String(journalDirectory.attrs?.type))) return refuse('journal-invalid');

    let taxPrepaidAccountId: number | null = null;
    if (withheldAmount > 0) {
      taxPrepaidAccountId = positiveId(config.tax_prepaid_account_id);
      if (!taxPrepaidAccountId) return refuse('tax-prepaid-account');
      const taxAccountMirror = await sc.from('external_master_records').select('active,tombstoned_at,attrs').eq('org_id', orgId)
        .eq('external_tier', 'odoo').eq('kind', 'account').eq('external_id', String(taxPrepaidAccountId)).maybeSingle();
      if (taxAccountMirror.error) throw rejected('The tax-prepaid account directory could not be read');
      const accountMirror = taxAccountMirror.data as { active?: boolean; tombstoned_at?: string | null; attrs?: { account_type?: unknown; company_ids?: unknown } | null } | null;
      const companies = Array.isArray(accountMirror?.attrs?.company_ids) ? accountMirror!.attrs!.company_ids as unknown[] : [];
      if (!accountMirror || accountMirror.active !== true || accountMirror.tombstoned_at !== null
          || !['asset_current', 'asset_prepayments'].includes(String(accountMirror.attrs?.account_type))
          || !companies.some((id) => String(id) === String(companyId))) return refuse('tax-prepaid-account');
    }
    const [invoiceRow, reference] = await Promise.all([
      sc.from('sales_invoices').select('id,customer_id,currency').eq('org_id', orgId).eq('id', invoiceId).maybeSingle(),
      sc.from('external_refs').select('external_record_id').eq('org_id', orgId).eq('domain', 'revenue').eq('external_tier', 'odoo').eq('pmo_record_id', invoiceId).maybeSingle(),
    ]);
    if (invoiceRow.error || reference.error) throw rejected('The receipt invoice could not be verified');
    const pmoInvoice = invoiceRow.data as { id: string; customer_id: string | null; currency?: string | null } | null;
    if (!pmoInvoice || pmoInvoice.customer_id !== customerId) return refuse('receipt-customer-mismatch');
    const invoiceRef = (reference.data as { external_record_id?: unknown } | null)?.external_record_id;
    const validInvoiceRef = typeof invoiceRef === 'string' && /^account\.move:[1-9][0-9]*$/.test(invoiceRef) ? invoiceRef : null;
    const odooInvoiceId = validInvoiceRef ? /^account\.move:([1-9][0-9]*)$/.exec(validInvoiceRef)?.[1] : null;
    if (!validInvoiceRef || !odooInvoiceId) return refuse('receipt-invoice-not-in-odoo');
    const invoiceOdooId = Number(odooInvoiceId);
    const [moveRows, companyCurrencyInfo, customerRef, journalRows] = await Promise.all([
      call<Array<{ state: string; move_type: string; partner_id?: unknown; amount_residual?: unknown; currency_id?: unknown }>>('account.move', 'read', {
        ids: [invoiceOdooId], fields: ['state', 'move_type', 'partner_id', 'amount_residual', 'currency_id'],
      }),
      companyCurrency(call, companyId),
      resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'companies', customerId),
      call<Array<{ type?: unknown; active?: boolean; company_id?: unknown; inbound_payment_method_line_ids?: unknown; default_account_id?: unknown }>>(
        'account.journal', 'read', { ids: [journalId], fields: ['type', 'active', 'company_id', 'inbound_payment_method_line_ids', 'default_account_id'] },
      ),
    ]);
    const companyCurrencyCode = companyCurrencyInfo.code;
    const move = moveRows[0];
    if (!move || move.move_type !== 'out_invoice' || move.state !== 'posted') return refuse('receipt-invoice-not-posted');
    const partnerId = Number(/^Client:([1-9][0-9]*)$/.exec(customerRef ?? '')?.[1]);
    if (!Number.isInteger(partnerId) || partnerId <= 0 || scalarId(move.partner_id) !== partnerId) return refuse('receipt-client-mismatch');
    const invoiceCurrency = relationCurrency(move.currency_id, companyCurrencyCode);
    if (!invoiceCurrency || (pmoInvoice.currency && pmoInvoice.currency.toUpperCase() !== invoiceCurrency)) return refuse('receipt-currency-unreadable');

    const journal = journalRows[0];
    const inboundMethodLineId = Array.isArray(journal?.inbound_payment_method_line_ids) ? positiveId(journal!.inbound_payment_method_line_ids[0]) : null;
    if (!journal || journal.active !== true || !['bank', 'cash'].includes(String(journal.type)) || scalarId(journal.company_id) !== companyId) return refuse('journal-invalid');
    if (!inboundMethodLineId) return refuse('journal-method');

    let accountCurrencies: ReceiptDefaults['accountCurrencies'];
    if (withheldAmount > 0) {
      const receivableLines = await call<Array<{ account_id?: unknown }>>('account.move.line', 'search_read', {
        domain: [['move_id', '=', invoiceOdooId], ['account_type', '=', 'asset_receivable']], fields: ['account_id'], limit: 2,
      });
      const receivableId = receivableLines.length === 1 ? scalarId(receivableLines[0].account_id) : null;
      const cashAccountId = scalarId(journal.default_account_id);
      if (!receivableId || !cashAccountId || !taxPrepaidAccountId) return refuse('receipt-account-currency-unreadable');
      const accountRows = await call<Array<{ id: number; currency_id?: unknown }>>('account.account', 'read', {
        ids: [...new Set([receivableId, cashAccountId, taxPrepaidAccountId])], fields: ['currency_id'],
      });
      const currencyById = new Map(accountRows.map((row) => [row.id, relationCurrency(row.currency_id, companyCurrencyCode)]));
      const receivableCurrency = currencyById.get(receivableId), cashCurrency = currencyById.get(cashAccountId), taxPrepaidCurrency = currencyById.get(taxPrepaidAccountId);
      if (!receivableCurrency || !cashCurrency || !taxPrepaidCurrency) return refuse('receipt-account-currency-unreadable');
      accountCurrencies = { receivable: receivableCurrency, cash: cashCurrency, taxPrepaid: taxPrepaidCurrency };
    }
    const settled = record.paid_amount;
    const cash = record.received_amount;
    const withheld = record.withheld_amount;
    if (!isReceiptMoney(settled) || !isReceiptMoney(cash) || !isReceiptMoney(withheld)) return refuse('amounts');
    const input: ReceiptInput = {
      id: String(record.id), orgId, date: String(record.date ?? ''), currency: invoiceCurrency,
      settled, cash: cash ?? settled, withheld,
      slipNumber: typeof record.withholding_slip_number === 'string' ? record.withholding_slip_number : null,
      journalId,
    };
    const invoice: ReceiptInvoice = {
      id: invoiceId, orgId, customerId, state: move.state, outstanding: move.amount_residual as number | string,
      currency: invoiceCurrency,
    };
    return {
      input, invoice, invoiceRef: validInvoiceRef, defaults: {
        companyCurrency: companyCurrencyCode, partners: { [customerId]: partnerId }, journalId, inboundMethodLineId,
        taxPrepaidAccountId, ...(accountCurrencies ? { accountCurrencies } : {}),
      },
    };
  })();
  resolvedReceipts.set(command, run);
  return run.then((facts) => ({ ...facts, input: { ...facts.input } }));
}

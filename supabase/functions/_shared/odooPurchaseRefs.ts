/**
 * The PMO-side facts an Odoo purchase command needs, read before any write (FR-OPP-014/020/021, FR-ODC-102): the project's cost
 * account, the vendor's partner, the case's lines and the org's item, unit and tax mappings. Read from PMO's tables with the
 * service client, scoped to the org; nothing here trusts the command's payload for a fact the database owns. A value that
 * cannot be resolved is explicit (`unlinked`, `needs-attention`, a named refusal), never a default or a guess.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { AppError } from '../../../pmo-portal/src/lib/appError.ts';
import { AdapterError, type AdapterCommand } from '../../../pmo-portal/src/lib/adapterSeam/contract.ts';
import { resolveExternalRef, type ExternalRefsLookupClient } from '../../../pmo-portal/src/lib/adapterSeam/refs.ts';
import { parseOdooExternalRef } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/anchors.ts';
import type { PaymentFacts } from '../../../pmo-portal/src/lib/adapterSeam/odoo/procurementAdapter.ts';
import type { OdooCall } from '../../../pmo-portal/src/lib/adapterSeam/odoo/client.ts';
import { toAdapterError } from '../../../pmo-portal/src/lib/adapterSeam/odoo/connectAdapter.ts';
import { chooseTaxIds, selectBillTaxes, type BillCtx, type BillInput, type BillTax } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/billBody.ts';
import type { OrderCtx, OrderInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/orderBody.ts';
import type { ReviseLine } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/orderRevise.ts';
import type { ReceiptLineInput } from '../../../pmo-portal/src/lib/adapterSeam/odoo/purchase/receiptBody.ts';

export type CostAccount = { status: 'resolved'; accountId: string } | { status: 'unlinked' } | { status: 'needs-attention'; reason: string };

/**
 * The project's Odoo cost account (an analytic account of the chosen plan). Unlinked when no link exists; needs attention when
 * the linked account is archived, gone from Odoo, or cannot be read (fail closed, FR-ODC-074).
 */
export async function resolveOdooCostAccount(sc: SupabaseClient, orgId: string, projectId: string): Promise<CostAccount> {
  const link = await sc.from('external_project_bindings').select('external_container_id').eq('org_id', orgId).eq('project_id', projectId).eq('external_tier', 'odoo').maybeSingle();
  if (link.error) return { status: 'needs-attention', reason: 'unreadable' };
  const accountId = (link.data as { external_container_id?: string } | null)?.external_container_id;
  if (!accountId) return { status: 'unlinked' };
  const mirror = await sc.from('external_master_records').select('active,tombstoned_at').eq('org_id', orgId).eq('external_tier', 'odoo').eq('kind', 'analytic_account').eq('external_id', accountId).maybeSingle();
  if (mirror.error) return { status: 'needs-attention', reason: 'unreadable' };
  const row = mirror.data as { active: boolean; tombstoned_at: string | null } | null;
  if (!row || row.active !== true || row.tombstoned_at !== null) return { status: 'needs-attention', reason: 'cost-account-unavailable' };
  return { status: 'resolved', accountId };
}

const refuse = (reason: string): never => { throw new AdapterError('commit-rejected', reason); };
const asMap = (value: unknown): Record<string, string> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).filter(([, v]) => typeof v === 'string' && v !== '')) as Record<string, string>
    : {};
const asIds = (value: unknown): number[] => (Array.isArray(value) ? value.filter((v): v is number => Number.isInteger(v) && v > 0) : []);

interface Resolved { companyId: number | null; config: Record<string, unknown> }
type CaseRow = { code: string | null; project_id: string | null; vendor_id: string | null; currency: string | null };

async function readCase(sc: SupabaseClient, orgId: string, procurementId: unknown): Promise<CaseRow> {
  if (typeof procurementId !== 'string' || procurementId === '') return refuse('case-missing');
  const { data, error } = await sc.from('procurements').select('code,project_id,vendor_id,currency').eq('org_id', orgId).eq('id', procurementId).maybeSingle();
  if (error || !data) return refuse('case-missing');
  return data as CaseRow;
}

async function orderCtx(sc: SupabaseClient, orgId: string, c: CaseRow, resolved: Resolved, currencyId: number): Promise<OrderCtx> {
  if (resolved.companyId === null) return refuse('company-not-set');
  let costAccountId: string | null = null;
  if (c.project_id) {
    const account = await resolveOdooCostAccount(sc, orgId, c.project_id);
    if (account.status !== 'resolved') return refuse(account.status === 'unlinked' ? 'project-unlinked' : 'project-needs-attention');
    costAccountId = account.accountId;
  }
  return { companyId: resolved.companyId, currencyId, itemMap: asMap(resolved.config.item_map), unitMap: asMap(resolved.config.unit_map), costAccountId, taxIds: asIds(resolved.config.purchase_tax_ids) };
}

type ItemRow = { name: string; quantity: number; rate: number; description: string | null };

/**
 * One identity for a PO line across create and revise (FR-OPP-016): a revision can only name a line by its BoQ item, so a PO that
 * has its own revision-1 lines (a subcontract PO) is created from them, keyed by BoQ item code. A PO with none is created from the
 * case's free-form lines, keyed by their name (the only thing they have, and nothing revises them).
 */
async function readPoLines(sc: SupabaseClient, orgId: string, poId: unknown): Promise<ItemRow[]> {
  if (typeof poId !== 'string' || poId === '') return [];
  const lines = await sc.from('purchase_order_lines').select('boq_item_id,quantity,rate').eq('org_id', orgId).eq('po_id', poId).eq('revision', 1).order('boq_item_id');
  if (lines.error) return refuse('lines-unreadable');
  const rows = (lines.data ?? []) as Array<{ boq_item_id: string; quantity: number | string; rate: number | string }>;
  if (rows.length === 0) return [];
  const boq = await sc.from('boq_items').select('id,item_code,description').eq('org_id', orgId).in('id', rows.map((l) => l.boq_item_id));
  if (boq.error) return refuse('lines-unreadable');
  const byId = new Map((boq.data as Array<{ id: string; item_code: string; description: string | null }>).map((b) => [b.id, b]));
  return rows.map((l) => {
    const item = byId.get(l.boq_item_id) ?? refuse('lines-unreadable');
    return { name: item.item_code, quantity: Number(l.quantity), rate: Number(l.rate), description: item.description };
  });
}

/** The case, its lines and its vendor's reference: what an order is made of, before any project or mapping is asked. */
async function readOrderFacts(sc: SupabaseClient, orgId: string, procurementId: unknown, poId?: unknown): Promise<{ c: CaseRow; items: ItemRow[]; vendor: string | null }> {
  const c = await readCase(sc, orgId, procurementId);
  const own = await readPoLines(sc, orgId, poId);
  const items = own.length ? { data: own, error: null } : await sc.from('procurement_items').select('name,quantity,rate,description').eq('org_id', orgId).eq('procurement_id', procurementId as string).order('id');
  if (items.error) return refuse('lines-unreadable');
  const vendor = c.vendor_id ? await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'companies', c.vendor_id) : null;
  return { c, items: items.data as ItemRow[], vendor };
}

/** Line subtotal in cents, rounded per line as Odoo rounds a line subtotal. */
const lineCents = (l: ItemRow) => Math.round((Math.round(Number(l.quantity) * 100) * Math.round(Number(l.rate) * 100)) / 100);

/**
 * The facts the order's create-to-anchor composite probe matches on (vendor's Odoo partner, untaxed total, line count). They
 * need neither the project nor the mappings, so a recovery still probes after a project was un-linked.
 */
export async function orderCompositeFacts(sc: SupabaseClient, orgId: string, record: { id?: unknown; procurementId?: unknown }): Promise<{ partnerId: number | null; amount: string; lineCount: number }> {
  return compositeFacts(sc, orgId, record.procurementId, record.id);
}

async function compositeFacts(sc: SupabaseClient, orgId: string, procurementId: unknown, poId: unknown): Promise<{ partnerId: number | null; amount: string; lineCount: number }> {
  const { items, vendor } = await readOrderFacts(sc, orgId, procurementId, poId);
  const cents = items.reduce((sum, l) => sum + lineCents(l), 0);
  const partner = Number(/^Vendor:(\d+)$/.exec(vendor ?? '')?.[1]);
  return { partnerId: Number.isInteger(partner) && partner > 0 ? partner : null, amount: (cents / 100).toFixed(2), lineCount: items.length };
}

/** A purchase-order create: the case's vendor, lines and project, and the org's mappings. */
export async function resolveOdooOrderInputs(sc: SupabaseClient, orgId: string, command: AdapterCommand, resolved: Resolved, currencyId: number): Promise<{ input: OrderInput; ctx: OrderCtx }> {
  const record = command.record as { id?: unknown; procurementId?: unknown; projectId?: unknown; referenceNumber?: unknown; date?: unknown };
  const { c, items, vendor } = await readOrderFacts(sc, orgId, record.procurementId, record.id);
  // The case owns its project. A command that names another one is a second project, which O2 refuses (FR-OPP-021).
  const claimed = typeof record.projectId === 'string' && record.projectId !== '' ? record.projectId : null;
  const projectIds = [...new Set([c.project_id, claimed].filter((p): p is string => !!p))];
  const ctx = await orderCtx(sc, orgId, c, resolved, currencyId);
  return {
    ctx,
    input: {
      vendor, caseNumber: c.code, vendorReference: typeof record.referenceNumber === 'string' ? record.referenceNumber : null,
      expectedDate: typeof record.date === 'string' ? record.date : null, projectIds,
      lines: items.map((l) => ({ name: l.name, quantity: l.quantity, rate: l.rate, description: l.description })),
    },
  };
}

/** A revision: the Odoo order the PMO order maps to, and the revision's effective lines as PMO issued them. */
export async function resolveOdooReviseInputs(sc: SupabaseClient, orgId: string, command: AdapterCommand, resolved: Resolved, currencyId: number): Promise<{ orderId: number; lines: ReviseLine[]; ctx: OrderCtx }> {
  const { poId, revision } = command.record as { poId?: unknown; revision?: unknown };
  if (typeof poId !== 'string' || !Number.isInteger(revision)) return refuse('revise-invalid');
  const po = await sc.from('purchase_orders').select('procurement_id').eq('org_id', orgId).eq('id', poId).maybeSingle();
  if (po.error || !po.data) return refuse('po-missing');
  const orderRef = await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'procurement', poId);
  const orderId = parseOdooExternalRef('purchase.order', orderRef);
  if (orderId === null) return refuse('order-not-in-odoo');
  const lines = await sc.from('purchase_order_lines').select('boq_item_id,quantity,rate,unit').eq('org_id', orgId).eq('po_id', poId).eq('revision', revision as number).order('boq_item_id');
  if (lines.error || !lines.data?.length) return refuse('revision-lines-missing');
  const boq = await sc.from('boq_items').select('id,item_code').eq('org_id', orgId).in('id', lines.data.map((l: { boq_item_id: string }) => l.boq_item_id));
  if (boq.error) return refuse('revision-lines-missing');
  const codes = new Map((boq.data as Array<{ id: string; item_code: string }>).map((b) => [b.id, b.item_code]));
  const c = await readCase(sc, orgId, (po.data as { procurement_id: string }).procurement_id);
  return {
    orderId,
    ctx: await orderCtx(sc, orgId, c, resolved, currencyId),
    lines: (lines.data as Array<{ boq_item_id: string; quantity: number | string; rate: number | string; unit: string }>).map((l) => ({
      itemRef: codes.get(l.boq_item_id) ?? refuse('revision-lines-missing'), quantity: String(l.quantity), rate: String(l.rate), unit: l.unit,
    })),
  };
}

/**
 * A goods receipt (FR-OPP-030): the Odoo order of the case's latest PMO order, the lines the user entered (none = everything open)
 * and the item mapping to read them by. The order is found through the org-scoped external reference, never from the command.
 */
export async function resolveOdooReceiptFacts(sc: SupabaseClient, orgId: string, command: AdapterCommand, resolved: Resolved): Promise<{ orderId: number; wanted: ReceiptLineInput[] | undefined; itemMap: Record<string, string> }> {
  const { procurementId, receiptLines } = command.record as { procurementId?: unknown; receiptLines?: unknown };
  if (typeof procurementId !== 'string' || procurementId === '') return refuse('case-missing');
  const po = await sc.from('purchase_orders').select('id').eq('org_id', orgId).eq('procurement_id', procurementId).order('created_at', { ascending: false }).limit(1);
  if (po.error) return refuse('po-unreadable');
  const poId = (po.data as Array<{ id: string }> | null)?.[0]?.id ?? refuse('po-missing');
  const orderId = parseOdooExternalRef('purchase.order', await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'procurement', poId));
  if (orderId === null) return refuse('order-not-in-odoo');
  if (receiptLines !== undefined && (!Array.isArray(receiptLines) || !receiptLines.every((l) => l && typeof l.itemRef === 'string' && (typeof l.quantity === 'number' || typeof l.quantity === 'string')))) return refuse('receipt-lines-invalid');
  return { orderId, wanted: receiptLines as ReceiptLineInput[] | undefined, itemMap: asMap(resolved.config.item_map) };
}

/**
 * OQ-OPP-9: company currency only. The order's currency is the case's (what PMO holds); Odoo's is the company's. They must be the
 * same ISO code, or the command is refused (config-rejected) before any outbox row or Odoo write; Odoo is only read. Returns the
 * Odoo currency id the create sends explicitly, so a vendor's own purchase-currency default can never decide the order's currency.
 * Fails closed when either side cannot be read.
 */
export async function resolveOdooOrderCurrency(sc: SupabaseClient, orgId: string, command: AdapterCommand, call: OdooCall, companyId: number | null): Promise<number> {
  const { procurementId, poId } = command.record as { procurementId?: unknown; poId?: unknown };
  let caseId: unknown = procurementId;
  if (String(command.operation) === 'revise') {
    if (typeof poId !== 'string') return refuse('revise-invalid');
    const po = await sc.from('purchase_orders').select('procurement_id').eq('org_id', orgId).eq('id', poId).maybeSingle();
    if (po.error || !po.data) return refuse('po-missing');
    caseId = (po.data as { procurement_id: string }).procurement_id;
  }
  const pmo = (await readCase(sc, orgId, caseId)).currency;
  const unreadable = () => new AppError('currency-unreadable: the order currency could not be confirmed against Odoo', 'config-rejected');
  if (typeof pmo !== 'string' || pmo.trim() === '' || companyId === null) throw unreadable();
  let company: Array<{ currency_id?: unknown }>;
  try { company = await call<Array<{ currency_id?: unknown }>>('res.company', 'read', { ids: [companyId], fields: ['currency_id'] }); } catch { throw unreadable(); }
  const cur = company[0]?.currency_id;
  if (!Array.isArray(cur) || !Number.isInteger(cur[0]) || typeof cur[1] !== 'string' || cur[1].trim() === '') throw unreadable();
  if (cur[1].trim().toUpperCase() !== pmo.trim().toUpperCase()) {
    throw new AppError(`currency-mismatch: the order is in ${pmo.trim().toUpperCase()}, the Odoo company is in ${cur[1].trim().toUpperCase()}. Only the company currency is supported.`, 'config-rejected');
  }
  return cur[0] as number;
}

// ── P5: the vendor bill ──────────────────────────────────────────────────────────────────────────────────────────────

/** The case's most recent PMO purchase order, or null: the order a bill of the case names (OQ-OPP-3). */
async function latestPoId(sc: SupabaseClient, orgId: string, procurementId: unknown): Promise<string | null> {
  if (typeof procurementId !== 'string' || procurementId === '') return null;
  const { data, error } = await sc.from('purchase_orders').select('id').eq('org_id', orgId).eq('procurement_id', procurementId).order('created_at', { ascending: false }).limit(1);
  if (error) return refuse('po-unreadable');
  return (data as Array<{ id: string }> | null)?.[0]?.id ?? null;
}

/** The facts the bill's create-to-anchor composite probe matches on: the vendor's partner, the untaxed total and the line count of what the bill is made of. */
export async function billCompositeFacts(sc: SupabaseClient, orgId: string, record: { procurementId?: unknown }): Promise<{ partnerId: number | null; amount: string; lineCount: number }> {
  return compositeFacts(sc, orgId, record.procurementId, await latestPoId(sc, orgId, record.procurementId));
}

/** The tax inputs the PMO bill form can forward (repositories/procurement.ts) that the Odoo bill does not honour yet. */
const ENTERED_TAX_FIELDS = ['taxTemplate', 'vatAmount', 'withheldAmount', 'pphType'] as const;
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
const taxRefusal = (message: string) => new AppError(message, 'config-rejected');

/**
 * The directory facts of the chosen taxes (FR-OPP-042): name, rate, scope and active from the MIRRORED tax directory (what the
 * user saw and chose); the two facts the mirror does not hold, the tax's company and whether a withholding tax posts to a liability
 * account, from a read-only look at Odoo. Fails closed: a tax the mirror lacks is `tax-unknown`, an unreadable Odoo is refused.
 */
async function readBillTaxes(sc: SupabaseClient, orgId: string, call: OdooCall, ids: readonly number[]): Promise<BillTax[]> {
  if (ids.length === 0) return [];
  const mirror = await sc.from('external_master_records').select('external_id,name,active,tombstoned_at,attrs').eq('org_id', orgId).eq('external_tier', 'odoo').eq('kind', 'tax').in('external_id', ids.map(String));
  if (mirror.error) throw taxRefusal('config-rejected: the purchase tax directory could not be read');
  const rows = (mirror.data ?? []) as Array<{ external_id: string; name: string; active: boolean; tombstoned_at: string | null; attrs: { amount?: unknown; use?: unknown } | null }>;
  const unreadable = () => taxRefusal('config-rejected: the chosen purchase taxes could not be checked against Odoo');
  let companies: Array<{ id: number; company_id?: unknown }>;
  const withholding = rows.filter((r) => typeof r.attrs?.amount === 'number' && r.attrs.amount < 0).map((r) => Number(r.external_id));
  const liability = new Set<number>();
  try {
    companies = await call('account.tax', 'read', { ids, fields: ['company_id'] });
    if (withholding.length) {
      const reps = await call<Array<{ tax_id: unknown; account_id: unknown }>>('account.tax.repartition.line', 'search_read', {
        domain: [['tax_id', 'in', withholding], ['document_type', '=', 'invoice'], ['repartition_type', '=', 'tax']], fields: ['tax_id', 'account_id'],
      });
      const accountIds = [...new Set(reps.flatMap((r) => (Array.isArray(r.account_id) ? [Number(r.account_id[0])] : [])))];
      const accounts = accountIds.length ? await call<Array<{ id: number; account_type?: unknown }>>('account.account', 'read', { ids: accountIds, fields: ['account_type'] }) : [];
      const isLiability = new Set(accounts.filter((a) => typeof a.account_type === 'string' && a.account_type.startsWith('liability')).map((a) => a.id));
      for (const taxId of withholding) {
        const own = reps.filter((r) => Array.isArray(r.tax_id) && Number(r.tax_id[0]) === taxId);
        if (own.length > 0 && own.every((r) => Array.isArray(r.account_id) && isLiability.has(Number(r.account_id[0])))) liability.add(taxId);
      }
    }
  } catch { throw unreadable(); }
  const companyOf = new Map(companies.map((c) => [c.id, Array.isArray(c.company_id) ? Number(c.company_id[0]) : null]));
  return rows.flatMap((r) => {
    const id = Number(r.external_id);
    const rate = r.attrs?.amount;
    return typeof rate === 'number' && Number.isInteger(id)
      ? [{ id, name: r.name, rate, active: r.active === true && r.tombstoned_at === null, companyId: companyOf.get(id) ?? -1, scope: text(r.attrs?.use) ?? '', liabilityAccount: liability.has(id) }]
      : [];
  });
}

/** One resolution per command: adapter selection resolves (and so refuses, before any outbox row) and the outbox payload reuses it. */
const resolvedBills = new WeakMap<object, Promise<{ input: BillInput; ctx: BillCtx }>>();

/**
 * A vendor-bill create: the case's vendor, the lines it is made of (the latest PMO purchase order's, else the case's), the Odoo
 * order line each settles when that order was pushed (a bill names its order, OQ-OPP-3), the project's cost account and the
 * validated, explicit taxes: the command's choice, else the org's default purchase taxes (OQ-OPP-4). A tax that does not validate
 * is `config-rejected` naming the tax; nothing is sent to Odoo.
 */
export function resolveOdooBillInputs(sc: SupabaseClient, orgId: string, command: AdapterCommand, resolved: Resolved, currencyId: number, call: OdooCall): Promise<{ input: BillInput; ctx: BillCtx }> {
  const memo = resolvedBills.get(command);
  if (memo) return memo;
  const run = (async () => {
    const record = command.record as { procurementId?: unknown; projectId?: unknown; referenceNumber?: unknown; invoiceDate?: unknown; dueDate?: unknown; taxIds?: unknown };
    // The form asks for VAT / PPh amounts or a template, and the repository forwards them; this adapter takes neither until the tax picker (P8).
    // Posting the default taxes instead would show the user a payable they did not enter (OQ-OPP-4), so the entry is refused, naming the field.
    const entered = ENTERED_TAX_FIELDS.find((f) => { const v = (command.record as Record<string, unknown>)[f]; return v !== undefined && v !== null && v !== ''; });
    if (entered) throw taxRefusal(`config-rejected: ${entered} was entered, and the Odoo bill cannot take it yet. Clear the tax entries to post with the connection's default purchase taxes.`);
    const poId = await latestPoId(sc, orgId, record.procurementId);
    const { c, items, vendor } = await readOrderFacts(sc, orgId, record.procurementId, poId);
    const claimed = typeof record.projectId === 'string' && record.projectId !== '' ? record.projectId : null;
    const projectIds = [...new Set([c.project_id, claimed].filter((p): p is string => !!p))];
    const { taxIds: defaults, ...base } = await orderCtx(sc, orgId, c, resolved, currencyId);
    const chosen = Array.isArray(record.taxIds) ? asIds(record.taxIds) : null;
    if (chosen !== null && chosen.length !== (record.taxIds as unknown[]).length) throw taxRefusal('config-rejected: a chosen purchase tax is not a valid id');   // never narrow a bad choice into "no tax"
    const ids = chooseTaxIds(chosen, defaults);
    let taxes: BillTax[];
    try {
      taxes = selectBillTaxes(await readBillTaxes(sc, orgId, call, ids), ids, base.companyId);
    } catch (err) {
      if (err instanceof AdapterError && err.message.startsWith('config-rejected')) throw taxRefusal(err.message);
      throw err;
    }
    // The Odoo order this PMO order became, if it was pushed: each bill line settles the order line of the same product, when that is unambiguous.
    // A reference that is not the order's model-qualified one is refused, and a failed read of its lines fails the command (retryable): either would
    // otherwise post the bill free-standing, and the order would show "to invoice" for ever (OQ-OPP-3, I3).
    const orderRef = poId ? await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'procurement', poId) : null;
    const orderId = orderRef === null ? null : parseOdooExternalRef('purchase.order', orderRef) ?? refuse('order-ref-invalid');
    const orderLines = orderId === null ? [] : await call<Array<{ id: number; product_id: unknown }>>('purchase.order.line', 'search_read', { domain: [['order_id', '=', orderId]], fields: ['product_id'] }).catch(toAdapterError);
    const lineFor = (name: string): number | null => {
      const product = Number(base.itemMap[name]);
      const hits = orderLines.filter((l) => Array.isArray(l.product_id) && Number(l.product_id[0]) === product);
      return hits.length === 1 ? hits[0].id : null;
    };
    return {
      ctx: { ...base, taxes },
      input: {
        vendor, reference: text(record.referenceNumber), invoiceDate: text(record.invoiceDate), dueDate: text(record.dueDate), projectIds,
        lines: items.map((l) => ({ name: l.name, quantity: l.quantity, rate: l.rate, description: l.description, purchaseLineId: lineFor(l.name) })),
      },
    };
  })();
  resolvedBills.set(command, run);
  return run;
}

// ── P6: the vendor payment ───────────────────────────────────────────────────────────────────────────────────────────────

/** The journal a payment leaves from: Finance's per-payment choice, else the org's default (OQ-OPP-6); a chosen journal must be a live bank or cash journal of this connection. */
async function paymentJournalId(sc: SupabaseClient, orgId: string, record: { journalId?: unknown }, config: Record<string, unknown>): Promise<number | null> {
  const chosen = typeof record.journalId === 'string' && record.journalId !== '' ? record.journalId : null;
  if (chosen === null) return Number.isInteger(config.default_payment_journal_id) && (config.default_payment_journal_id as number) > 0 ? config.default_payment_journal_id as number : null;
  if (!/^[0-9]{1,9}$/.test(chosen)) return refuse('journal-invalid');
  const mirror = await sc.from('external_master_records').select('active,tombstoned_at,attrs').eq('org_id', orgId).eq('external_tier', 'odoo').eq('kind', 'journal').eq('external_id', chosen).maybeSingle();
  if (mirror.error) return refuse('journal-unreadable');
  const row = mirror.data as { active: boolean; tombstoned_at: string | null; attrs: { type?: unknown } | null } | null;
  if (!row || row.active !== true || row.tombstoned_at !== null || !['bank', 'cash'].includes(String(row.attrs?.type))) return refuse('journal-invalid');
  return Number(chosen);
}

/**
 * A vendor-payment create: the bill's Odoo reference (the mapping written when the bill was pushed), the vendor's partner, the
 * journal, and what to pay. The bill must belong to the command's case: a payment for another case's bill is refused here. Nothing
 * that Odoo owns (the bill's state and residual) is decided here; the adapter reads it just before the write.
 */
export async function resolveOdooPaymentFacts(sc: SupabaseClient, orgId: string, command: AdapterCommand, resolved: Resolved, companyCurrencyId: number): Promise<PaymentFacts> {
  const record = command.record as { procurementId?: unknown; invoiceId?: unknown; paid_amount?: unknown; date?: unknown; journalId?: unknown };
  const c = await readCase(sc, orgId, record.procurementId);
  const invoiceId = typeof record.invoiceId === 'string' && record.invoiceId !== '' ? record.invoiceId : null;
  let billRef: string | null = null;
  if (invoiceId !== null) {
    const bill = await sc.from('procurement_invoices').select('procurement_id').eq('org_id', orgId).eq('id', invoiceId).maybeSingle();
    if (bill.error) return refuse('bill-unreadable');
    if (!bill.data) return refuse('bill-missing');
    if ((bill.data as { procurement_id: string }).procurement_id !== record.procurementId) return refuse('bill-case-mismatch');
    billRef = await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'procurement', invoiceId);
  }
  const vendor = c.vendor_id ? await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'companies', c.vendor_id) : null;
  const partner = Number(/^Vendor:(\d+)$/.exec(vendor ?? '')?.[1]);
  return {
    billRef, amount: record.paid_amount as number | string, date: typeof record.date === 'string' ? record.date : null,
    vendorPartnerId: Number.isInteger(partner) && partner > 0 ? partner : null,
    journalId: await paymentJournalId(sc, orgId, record, resolved.config), companyCurrencyId,
  };
}

/** The facts a payment's recovery composite matches on, from PMO's tables only: the case vendor's Odoo partner and the bill's Odoo reference (null when unmapped). */
export async function paymentCompositeFacts(sc: SupabaseClient, orgId: string, record: { procurementId?: unknown; invoiceId?: unknown }): Promise<{ partnerId: number | null; billRef: string | null }> {
  const c = await readCase(sc, orgId, record.procurementId);
  const vendor = c.vendor_id ? await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'companies', c.vendor_id) : null;
  const partner = Number(/^Vendor:(\d+)$/.exec(vendor ?? '')?.[1]);
  const billRef = typeof record.invoiceId === 'string' && record.invoiceId !== '' ? await resolveExternalRef(sc as unknown as ExternalRefsLookupClient, orgId, 'procurement', record.invoiceId) : null;
  return { partnerId: Number.isInteger(partner) && partner > 0 ? partner : null, billRef };
}

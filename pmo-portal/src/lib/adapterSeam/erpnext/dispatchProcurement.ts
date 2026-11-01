/** Procurement-domain dispatch preparation for the ERPNext adapter (T-31 / ADP-021 / XG04-004):
 *  the PO/GR/PI order refs (task 5.3, FR-ENA-103), the purchase project dimension, the #910
 *  vendor-payment bill/amount/currency gates, and the purchase-invoice tax resolution (#520/#876/
 *  #915). Moved verbatim from `dispatchFactory.ts`; the factory calls these at the SAME points in
 *  its ordered orchestration. */
import { AdapterError } from '../contract.ts';
import { AppError } from '../../appError.ts';
import { getDoc, type ErpClientDeps } from './client.ts';
import { resolveExternalRef, type ExternalRefsLookupClient } from '../refs.ts';
import { itemsNetTotal, lineRate, type ItemsNetLine } from '../../itemsNet.ts';
import { buildEnteredPurchaseTaxRows, ENTERED_TAX_AND_TEMPLATE, findDefaultPurchaseTaxTemplate, parseEnteredPurchaseTax, resolvePurchaseTaxRows, type ErpPurchaseTaxRow } from './erpPurchaseTaxRows.ts';
import { piBodyCarriesTaxes } from './bodies/purchaseInvoice.ts';
import type { DispatchServiceClient, ErpDispatchFactoryDeps, ExternalOrgBindingRow, ProcurementSourceLine } from './dispatchTypes.ts';
import { buildsSalesInvoiceBody } from './dispatchTypes.ts';
import { resolveErpProjectName, stripDoctypePrefix } from './dispatchRefs.ts';
import { assertLinkBelongsToOrg } from './dispatchPreflight.ts';

// ── Slice 5 (task 5.3, FR-ENA-103): cross-doctype ref resolution for a PO/GR command — the
// supplier (companies domain), the case's line items (`procurement_items`) when the command carried
// none, and — for a GR — the case's PO (procurement domain) + the PO item CHILD-ROW `name` (fetched
// from the PO doc). Never a raw PMO id, never a client-supplied ERP name. Guarded on
// `record.procurementId`: a command without one (every non-PO/GR kind, and every pre-Slice-5 caller)
// takes ZERO extra DB/HTTP calls (byte-for-byte).

export interface ResolvedLineItem {
  item_code: string;
  description?: string;
  qty: number | string;
  rate?: number | string;
  schedule_date?: string;
  po_item_child_name?: string;
}

/** `YYYY-MM-DD`, `days` from today (UTC) — the fallback when a PO command carries no `date` (R9 §3:
 *  `schedule_date` is genuinely mandatory on the ERP side; the adapter must never send nothing). */
function todayPlusDaysIso(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** procurements.vendor_id -> the ERP Supplier/Customer raw name, via `external_refs` (companies
 *  domain). `null` when the case has no selected vendor yet, or no mapping is recorded. */
async function resolveCaseSupplierName(
  serviceClient: DispatchServiceClient,
  orgId: string,
  procurementId: string,
): Promise<string | null> {
  const { data, error } = await serviceClient.from('procurements').select('vendor_id').eq('id', procurementId).maybeSingle();
  if (error || !data) return null;
  const vendorId = (data as { vendor_id: string | null }).vendor_id;
  if (!vendorId) return null;
  const externalId = await resolveExternalRef(serviceClient as unknown as ExternalRefsLookupClient, orgId, 'companies', vendorId);
  return externalId ? stripDoctypePrefix(externalId) : null;
}

/** The case's line items (`procurement_items`, the shared item list every procurement sub-doctype
 *  draws from) mapped to the PMO-shaped line-item draft `erpnext/bodies/*`'s `toBody`s read. */
async function resolveCaseItems(serviceClient: DispatchServiceClient, procurementId: string,
  capture?: (lines: ProcurementSourceLine[]) => void): Promise<ResolvedLineItem[]> {
  const { data, error } = await serviceClient.from('procurement_items').select('name,quantity,rate,description').eq('procurement_id', procurementId);
  if (capture && (error || !Array.isArray(data))) throw new AppError(error?.message ?? 'procurement line items are unavailable', error?.code);
  if (error || !Array.isArray(data)) return [];
  const lines = data as ProcurementSourceLine[];
  capture?.(lines);

  return lines.map((row) => ({
    item_code: row.name,
    qty: row.quantity,
    rate: row.rate ?? undefined,
    ...(row.description ? { description: row.description } : {}),
  }));
}

/** The case's most-recently-created `purchase_orders` PMO row (P2 scope: a GR resolves against the
 *  case's single/latest PO — the current PMO `procurement_receipts` schema carries no per-GR PO
 *  picker; see the Slice 5 report). `null` when the case has no PO yet. */
async function resolveLatestPoPmoId(serviceClient: DispatchServiceClient, procurementId: string): Promise<string | null> {
  const { data, error } = await serviceClient
    .from('purchase_orders')
    .select('id')
    .eq('procurement_id', procurementId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !Array.isArray(data) || data.length === 0) return null;
  return (data[0] as { id: string }).id;
}

/** `GET` the PO doc and build `item_code -> child-row name` (the `purchase_order_item` GR needs per
 *  row, R9 §4) — the ONE place a PO doc is read for this purpose. */
async function resolvePoItemChildNames(client: ErpClientDeps, poName: string): Promise<Record<string, string>> {
  const doc = (await getDoc(client, 'Purchase Order', poName)) as { items?: unknown };
  const items = Array.isArray(doc.items) ? (doc.items as Array<Record<string, unknown>>) : [];
  const map: Record<string, string> = {};
  for (const item of items) {
    if (typeof item.item_code === 'string' && typeof item.name === 'string') map[item.item_code] = item.name;
  }
  return map;
}

/** PO/PI cost dimensions use the same project-map resolver and org guard as the revenue path.
 *  The procurement case owns its project; a caller cannot redirect that case's costs. */
export async function resolvePurchaseProjectRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ refs: Record<string, string | null> }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record;
  if (record.erp_doc_kind !== 'purchase-order' && record.erp_doc_kind !== 'purchase-invoice') return { refs };
  // PO/PI share SI's body-building operations; submit/cancel act on the existing ERP document.
  if (!buildsSalesInvoiceBody({ operation: deps.command.operation, record: { verb: record.verb } })) return { refs };

  let projectId = typeof record.projectId === 'string' ? record.projectId : null;
  if (typeof record.procurementId === 'string' && record.procurementId) {
    const { data, error } = await deps.serviceClient.from('procurements').select('project_id')
      .eq('org_id', deps.orgId).eq('id', record.procurementId).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    if (!data) throw new AppError('the procurement project reference is unavailable', 'cross-org-link-rejected');
    projectId = (data as { project_id?: string | null }).project_id ?? null;
  }
  if (!projectId) return { refs }; // Existing project-less cases remain valid.
  await assertLinkBelongsToOrg(deps.serviceClient, deps.orgId, 'projects', projectId);
  const project = resolveErpProjectName(binding.config, projectId);
  if (typeof project !== 'string' || !project.trim()) {
    throw new AppError('the procurement project has no ERP project mapping', 'project-unmapped');
  }
  refs.project = project;
  return { refs };
}

/** Resolve the PO/PI supplier/items and GR refs this command needs (task 5.3). Returns the `ctx.refs` additions +
 *  `resolvedItems` (only set when the command carried none — `adapter.ts`'s fallback substitutes it). */
export async function resolveProcurementOrderRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ refs: Record<string, string | null>; resolvedItems?: ResolvedLineItem[] }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record as { erp_doc_kind?: string; procurementId?: string; items?: unknown[]; date?: string };
  const kind = record.erp_doc_kind;
  const procurementId = record.procurementId;
  // #910 (FR-VPAY-002): `payment` joins the supplier resolution — the case's vendor mapping is the
  // ONLY party source a vendor payment has (the command never carries a supplier, and the vendorId
  // fallback at the ctx spread can never fire for one).
  if ((kind !== 'purchase-order' && kind !== 'goods-receipt' && kind !== 'purchase-invoice' && kind !== 'payment') || !procurementId) return { refs };

  const supplierName = await resolveCaseSupplierName(deps.serviceClient, deps.orgId, procurementId);
  if (supplierName) refs.supplier = supplierName;

  // #910: a payment resolves the case supplier ONLY — it has no line items, so the case-item
  // fallback below must never graft items onto a payment command (or its outbox payload).
  if (kind === 'payment') return { refs };

  let resolvedItems: ResolvedLineItem[] | undefined;
  const hasOwnItems = Array.isArray(record.items) && record.items.length > 0;
  if (!hasOwnItems) {
    const caseItems = await resolveCaseItems(deps.serviceClient, procurementId, deps.captureProcurementSourceLines);
    resolvedItems = kind === 'purchase-order'
      ? caseItems.map((item) => ({ ...item, schedule_date: record.date ?? todayPlusDaysIso(7) }))
      : caseItems;
  }

  if (kind === 'goods-receipt' && resolvedItems) {
    const poPmoId = await resolveLatestPoPmoId(deps.serviceClient, procurementId);
    if (poPmoId) {
      const poExternalName = await resolveExternalRef(deps.serviceClient as unknown as ExternalRefsLookupClient, deps.orgId, 'procurement', poPmoId);
      if (poExternalName) {
        refs.po = poExternalName;
        const childNames = await resolvePoItemChildNames(
          { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret, baseUrl: binding.site_url, rateLimiter: deps.rateLimiter },
          poExternalName,
        );
        resolvedItems = resolvedItems.map((item) => ({ ...item, po_item_child_name: childNames[item.item_code] }));
      }
    }
  }

  return { refs, resolvedItems };
}

// ============================================================================
// #910 — the vendor-payment refs pass (FR-VPAY-003/004/006, DD-VPAY-3/4/7)
// ============================================================================

/** Resolve refs for a procurement `payment` command — the bill anchor + the allocation — and gate
 *  the amount against the bill's mirrored ERP outstanding. Luna BLOCK 5's twin for the PAY side:
 *
 *  - The bill anchor is REQUIRED (DD-VPAY-3): no `invoiceId`, an unmapped bill, or a bill on another
 *    case refuses `commit-rejected` BEFORE any ERP write/outbox insert. Supplier advances (no bill)
 *    stay out pending OQ-VPAY-1.
 *  - The ERP `Purchase Invoice` name resolves from `external_refs` (procurement domain) and
 *    `references[]` is built SERVER-side from it — any caller-supplied rows are discarded, so the
 *    payload can never allocate the payment against a bill it did not name.
 *  - The amount gate (DD-VPAY-7) reads `procurement_invoices.erp_outstanding_amount` — the same
 *    mirrored oracle the ledger shows. A `null` outstanding refuses (never "uncapped"), and so does
 *    `paid_amount` above it or ≤ 0.
 *  - The currency gate (spec §1 / OBS-VPAY-003): `paid_amount` is company-currency money while
 *    `erp_outstanding_amount` is the BILL's currency — cross-currency the amount gate above is
 *    unsound, so the bill must be in the binding company's currency (the org's `default_currency`,
 *    0187). An unmirrored bill currency (`XXX`/null) or an unreadable org currency refuses fail-
 *    closed; only a PROVEN match passes. One extra service-role read (organizations), payments only.
 *
 *  Cost (NFR-VPAY-001): at most three service-role DB reads (bill row, external-ref lookup, the
 *  case-supplier read `resolveProcurementOrderRefs` already shares) and ZERO ERP reads. Runs inside
 *  the factory — before the outbox insert — so a refused payment leaves no outbox row. The supplier
 *  itself resolves in `resolveProcurementOrderRefs` (its kind gate now includes `payment`), and the
 *  cross-org case is already refused by `assertCommandLinksSameOrg` (this re-read is same-org by
 *  construction; a vanished row fails closed below).
 */
export async function resolvePaymentRefs(deps: ErpDispatchFactoryDeps): Promise<{ refs: Record<string, string | null> }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record as { erp_doc_kind?: string; procurementId?: string; invoiceId?: unknown; paid_amount?: unknown; references?: unknown };
  if (record.erp_doc_kind !== 'payment' || deps.command.operation !== 'create') return { refs };

  const procurementId = typeof record.procurementId === 'string' ? record.procurementId : '';
  const invoiceId = typeof record.invoiceId === 'string' && record.invoiceId.trim() !== '' ? record.invoiceId : null;
  if (!invoiceId || !procurementId) {
    throw new AppError('supplier payment: the bill it settles is required (select the supplier invoice this payment closes)', 'commit-rejected');
  }
  const amount = Number(record.paid_amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError(`supplier payment: paid_amount "${String(record.paid_amount)}" must be a positive figure`, 'commit-rejected');
  }

  const replay = deps.replay === true;

  // The bill row — org-scoped, fail closed on a missing row (a stale invoiceId is never a silent skip).
  const { data: bill, error } = await deps.serviceClient.from('procurement_invoices')
    .select('procurement_id,erp_outstanding_amount,vi_number,currency')
    .eq('org_id', deps.orgId).eq('id', invoiceId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  if (!bill) {
    throw new AppError(`supplier payment: bill '${invoiceId}' was not found in this org`, 'commit-rejected');
  }
  const billRow = bill as { procurement_id: string | null; erp_outstanding_amount: number | string | null; vi_number: string | null; currency: string | null };
  const billName = billRow.vi_number ?? invoiceId;
  if (billRow.procurement_id !== procurementId) {
    throw new AppError(`supplier payment: bill ${billName} belongs to a different procurement case`, 'commit-rejected');
  }
  // On recovery, ERP may already have applied this payment and refreshed the bill outstanding to
  // zero. Preserve the bill/case anchor and mapping checks, but do not re-run mutable balance checks.
  if (replay) {
    const piExternalId = await resolveExternalRef(deps.serviceClient as unknown as ExternalRefsLookupClient, deps.orgId, 'procurement', invoiceId);
    if (!piExternalId) {
      throw new AppError(`supplier payment: bill ${billName} has no ERP mapping in this org's external_refs — it is not on ERPNext yet`, 'commit-rejected');
    }
    refs.pi = piExternalId;
    record.references = [{ reference_doctype: 'Purchase Invoice', reference_name: piExternalId, allocated_amount: amount }];
    return { refs };
  }

  // Spec §1 (multi-currency is OUT; OBS-VPAY-003): paid_amount is company-currency money and
  // erp_outstanding_amount is the bill's currency — cross-currency the amount gate below compares
  // figures that are not in the same unit. The bill must be in the binding company's currency: the
  // org's default_currency (0187_money_currency_seam — "the org's single v1 currency", set at
  // onboarding / ERPNext Connect). Fail closed: an unreadable org row or a non-ISO value refuses,
  // an unmirrored bill currency (null, or 0187's 'XXX' "no currency" placeholder) refuses — only a
  // PROVEN match reaches the amount gate.
  const { data: orgRow, error: orgError } = await deps.serviceClient.from('organizations')
    .select('default_currency').eq('id', deps.orgId).maybeSingle();
  if (orgError || !orgRow) {
    throw new AppError('supplier payment: the org currency could not be read — cannot verify the bill is in the company currency', 'commit-rejected');
  }
  const orgCurrency = (orgRow as { default_currency?: unknown }).default_currency;
  if (typeof orgCurrency !== 'string' || !/^[A-Z]{3}$/.test(orgCurrency)) {
    throw new AppError('supplier payment: the org currency is not set — set it before paying a bill', 'commit-rejected');
  }
  const billCurrency = billRow.currency;
  if (!billCurrency || billCurrency === 'XXX') {
    throw new AppError(`supplier payment: bill ${billName} has no mirrored currency yet — record the bill's ERP push first`, 'commit-rejected');
  }
  if (billCurrency !== orgCurrency) {
    throw new AppError(`This bill is in ${billCurrency}; paying a foreign-currency bill from PMO is not supported yet — pay it in ERPNext.`, 'commit-rejected');
  }
  if (billRow.erp_outstanding_amount === null || billRow.erp_outstanding_amount === undefined) {
    throw new AppError(`supplier payment: bill ${billName} has no mirrored ERP outstanding yet — record the bill's ERP push first`, 'commit-rejected');
  }
  if (amount > Number(billRow.erp_outstanding_amount)) {
    throw new AppError(`supplier payment: paid_amount ${amount} exceeds bill ${billName}'s outstanding ${billRow.erp_outstanding_amount}`, 'commit-rejected');
  }

  // The bill's ERP Purchase Invoice name (procurement domain). Unmapped ⇒ the bill never reached
  // ERPNext — there is nothing to allocate against, so refuse (never a party: undefined PE).
  const piExternalId = await resolveExternalRef(deps.serviceClient as unknown as ExternalRefsLookupClient, deps.orgId, 'procurement', invoiceId);
  if (!piExternalId) {
    throw new AppError(`supplier payment: bill ${billName} has no ERP mapping in this org's external_refs — it is not on ERPNext yet`, 'commit-rejected');
  }
  refs.pi = piExternalId;
  // DISCARD caller-supplied references entirely; build ONLY from the resolved bill (DD-VPAY-2).
  record.references = [{ reference_doctype: 'Purchase Invoice', reference_name: piExternalId, allocated_amount: amount }];
  return { refs };
}

/**
 * #520 + #876 slice 2 — the tax a vendor invoice create on a flipped org sends. Exactly one of:
 *   • a user-chosen ERPNext Purchase Taxes and Charges Template (#520): resolved, validated against the binding's
 *     company and expanded into its rows here;
 *   • the VAT / PPh AMOUNTS the user entered (DD-VWH-13): fixed `Actual` rows on the org's tax accounts, marked
 *     `taxesFromAmounts` so `piToBody` sends them with an empty template;
 *   • neither: a create naming neither is where ERPNext would apply the company's own default. #915: PMO looks that
 *     default up (the sales side's read) and runs it through the SAME resolver/validator a chosen template gets,
 *     BEFORE any ERP write — a malformed default used to be refused only by the database mirror AFTER the bill had
 *     posted (fail-closed, manual repair). None found (or no ERP company to look one up for) → unchanged: nothing is
 *     sent and the bill posts untaxed, as AC-520-2 and DD-VWH-15/DD-VI-3 keep for non-form callers.
 * Both is refused before any ERP call. Rows and the marker are written onto the record BEFORE the outbox snapshot, so
 * the payload and digest cover them and a sweep replay re-sends them with no ERPNext read. A caller's `taxes` and
 * `taxesFromAmounts` are always dropped; edits and amends send none.
 */
export async function resolvePurchaseInvoiceTaxes(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow, resolvedItems: ResolvedLineItem[] | undefined,
): Promise<void> {
  const record = deps.command.record as Record<string, unknown>;
  if (record.erp_doc_kind !== 'purchase-invoice') return;
  if (deps.replay && deps.command.operation === 'create') {
    // #915 fix round: a replay of a create whose persisted body sends NO tax fields (e.g. the earlier
    // "no default found" refusal stored no marker) lets ERPNext apply the company's CURRENT default at
    // POST time — so that default is looked up and validated here, before the re-POST, with the create
    // path's own refusals. Deliberately validate-only: the persisted record, body and digest are never
    // mutated (a valid default is ERPNext's to apply; `piBodyCarriesTaxes` is the body predicate this
    // mirrors, so the gate cannot drift from the body it guards).
    if (!piBodyCarriesTaxes(record)) await validateCurrentDefaultPurchaseTaxTemplate(deps, binding);
    return;
  }
  delete record.taxes;
  delete record.taxesFromAmounts;
  const chosen = typeof record.taxTemplate === 'string' ? record.taxTemplate.trim() : '';
  const entered = deps.command.operation === 'create' ? parseEnteredPurchaseTax(record) : null;
  if (deps.command.operation !== 'create' || (!chosen && !entered)) {
    for (const key of ['taxTemplate', 'vatAmount', 'withheldAmount', 'pphType']) delete record[key];
    if (deps.command.operation === 'create') await sendDefaultPurchaseTaxTemplate(deps, binding, record);
    return;
  }
  if (chosen && entered) throw new AdapterError('commit-rejected', ENTERED_TAX_AND_TEMPLATE);
  const company = binding.config?.company;
  if (typeof company !== 'string' || !company) {
    throw new AppError(chosen
      ? 'ERPNext has no company set for this organization, so the chosen purchase tax template cannot be checked. Set the ERP company in Administration → Integrations, then record the invoice again.'
      : 'ERPNext has no company set for this organization, so the supplier invoice tax cannot be checked. Set the ERP company in Administration → Integrations, then record the invoice again.',
    'config-rejected');
  }
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  if (chosen) {
    record.taxTemplate = chosen;
    record.taxes = await resolvePurchaseTaxRows(client, company, chosen);
    return;
  }
  if (!entered) return;
  delete record.taxTemplate;
  // The items the PI will carry: the command's own, else the case's (adapter.ts substitutes `resolvedItems`).
  const lines = (Array.isArray(record.items) && record.items.length > 0 ? record.items : resolvedItems ?? []) as ItemsNetLine[];
  // Both refusals land BEFORE any read (ADR-0072 style, DD-VWH-22): an unpriced line must not count as 0 — it
  // would understate the base the withheld bound checks against — and an unknown total (a line without a
  // quantity) must not SKIP the bound — ERPNext would accept the bill and every replay would then refuse it.
  if (lines.some((line) => lineRate(line) === null)) {
    throw new AppError('This case has unpriced lines: give every line a rate, then record the invoice again.', 'config-rejected');
  }
  const itemsTotal = itemsNetTotal(lines);
  if (lines.length > 0 && itemsTotal === null) {
    throw new AdapterError('commit-rejected', "The supplier invoice's items total cannot be computed: a line is missing its quantity. Complete the case's lines, then record the invoice again.");
  }
  const { data, error } = await deps.serviceClient.from('organizations')
    .select('input_vat_account,pph23_payable_account,pph4_2_payable_account').eq('id', deps.orgId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const settings = (data ?? {}) as Record<string, unknown>;
  const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);
  record.taxes = await buildEnteredPurchaseTaxRows(client, company, entered, {
    inputVat: text(settings.input_vat_account), pph23: text(settings.pph23_payable_account), pph4_2: text(settings.pph4_2_payable_account),
  }, itemsTotal);
  record.taxesFromAmounts = true;
  record.vatAmount = entered.vatAmount;
  record.withheldAmount = entered.withheldAmount;
  record.pphType = entered.pphType;
}

/**
 * #915 — the ERP company's CURRENT default Purchase Taxes and Charges Template, resolved through the
 * SAME validator a chosen template goes through (`findDefaultPurchaseTaxTemplate` +
 * `resolvePurchaseTaxRows`, so a malformed default refuses `config-rejected` with the chosen path's
 * exact wording, naming the template — never the company, ADR-0072). Null when no ERP company is
 * configured to look one up for, or no default exists — callers treat that as "send nothing".
 */
async function resolveCurrentDefaultPurchaseTax(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow,
): Promise<{ template: string; rows: ErpPurchaseTaxRow[] } | null> {
  const company = binding.config?.company;
  if (typeof company !== 'string' || !company) return null;
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  const template = await findDefaultPurchaseTaxTemplate(client, company);
  if (!template) return null;
  return { template, rows: await resolvePurchaseTaxRows(client, company, template) };
}

/** #915 fix round — the replay gate: validate the current default, write NOTHING anywhere. */
async function validateCurrentDefaultPurchaseTaxTemplate(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow,
): Promise<void> {
  await resolveCurrentDefaultPurchaseTax(deps, binding);
}

/**
 * #915 — the create-naming-neither path: resolve the ERP company's default Purchase Taxes and Charges Template through
 * the same validator a chosen template goes through, so a malformed default is refused BEFORE the ERP write instead of
 * by the database mirror after the bill posted. The refusals and wording are the chosen path's own (`config-rejected`,
 * naming the template). No default — or no company configured to look one up for — sends nothing, exactly as before.
 */
async function sendDefaultPurchaseTaxTemplate(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow, record: Record<string, unknown>,
): Promise<void> {
  const resolved = await resolveCurrentDefaultPurchaseTax(deps, binding);
  if (!resolved) return;
  record.taxTemplate = resolved.template;
  record.taxes = resolved.rows;
}

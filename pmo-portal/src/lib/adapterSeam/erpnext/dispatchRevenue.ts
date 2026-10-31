/** Revenue-domain dispatch preparation for the ERPNext adapter (T-31 / ADP-021 / XG04-004): the
 *  revenue refs (task 2.3, FR-SAR-100/101/121), the client-PO/receipt-date resolution (#766), the
 *  ordinary-invoice currency + VAT rows (#856/#866/OD-TAX-4), the progress-claim invoice build
 *  (#766/#858, ADR-0077) and the withheld-tax receipt config merge (AC-WHT-004). Moved verbatim
 *  from `dispatchFactory.ts`; the factory calls these at the SAME points in its ordered
 *  orchestration. */
import { AppError } from '../../appError.ts';
import { getDoc, type ErpClientDeps } from './client.ts';
import { resolveExternalRef, type ExternalRefsLookupClient } from '../refs.ts';
import { readNegativeRatesAllowed } from './erpSellingSettings.ts';
import { resolveSalesTaxRows, type ErpTaxRow } from './erpSalesTaxRows.ts';
import { progressClaimItems, type ProgressClaimLineRecord, type ProgressClaimRecord } from './progressClaimItems.ts';
import type { ErpDispatchFactoryDeps, ExternalOrgBindingRow } from './dispatchTypes.ts';
import { buildsSalesInvoiceBody } from './dispatchTypes.ts';
import { resolveErpProjectName } from './dispatchRefs.ts';

// ============================================================================
// Task 2.3 — Revenue ref resolver (FR-SAR-100/101/121)
// ============================================================================

/** Resolve the client PO before the outbox snapshots and digests this command. The invoice's
 *  linked work order is read from PMO, and every source read is scoped to the dispatching org.
 *  Matching the reference back to its source preserves its date after ERP readback mirrors po_no
 *  onto reference_number; an unrelated explicit invoice reference carries no borrowed date. */
async function resolveSalesInvoicePo(deps: ErpDispatchFactoryDeps): Promise<void> {
  const record = deps.command.record;
  const read = async (table: string, columns: string, id: string) => {
    const { data, error } = await deps.serviceClient.from(table).select(columns)
      .eq('org_id', deps.orgId).eq('id', id).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    return data as Record<string, unknown> | null;
  };
  const nonblank = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

  const invoice = await read('sales_invoices', 'reference_number,work_order_id,project_id', record.id);
  // #766: a claim invoice has no mirror row yet on its first push; its work order rides on the record.
  const workOrderId = nonblank(invoice?.work_order_id) ?? nonblank(record.workOrderId);
  const projectId = nonblank(record.projectId) ?? nonblank(invoice?.project_id);
  const workOrder = workOrderId
    ? await read('work_orders', 'client_po_number,order_date', workOrderId)
    : null;
  const project = projectId
    ? await read('projects', 'customer_contract_ref,contract_date', projectId)
    : null;

  const invoiceReference = nonblank(Object.hasOwn(record, 'reference_number')
    ? record.reference_number
    : invoice?.reference_number);
  const workOrderReference = nonblank(workOrder?.client_po_number);
  const projectReference = nonblank(project?.customer_contract_ref);
  const reference = invoiceReference ?? workOrderReference ?? projectReference;
  const date = reference !== null && reference === workOrderReference
    ? nonblank(workOrder?.order_date)
    : reference !== null && reference === projectReference
      ? nonblank(project?.contract_date)
      : null;

  // These are command material: both the HTTP body and the persisted outbox payload/digest read
  // the same resolved values. A caller-supplied po_date is replaced by the matching PMO date.
  record.reference_number = reference;
  record.po_date = date;

  // #767 (AC-DUE-003): a recorded receipt date rides along as ERP's `custom_received_date`. `due_date`
  // is deliberately NOT pushed: ERPNext refuses a due date past the customer's payment-terms default
  // (party.py `validate_due_date_with_template`, "Due Date cannot be after …") — so sending one would
  // fail the amend of any invoice whose customer has a terms template — and `due_date` is not
  // `allow_on_submit`, so it could never follow a receipt recorded after submission anyway. ERP keeps
  // its own due date; PMO shows the receipt-based one (`deriveArDueDate`). Proposed DD-DUE-1.
  const stamp = await read('sales_invoices', 'received_date', record.id);
  const received = nonblank(stamp?.received_date);
  delete record.received_date;
  delete record.due_date;
  if (received) record.received_date = received;
}

/** Resolve revenue-domain refs for a sales-invoice or incoming-payment command.
 *  - `ctx.refs.customer` from `record.customerId` via `external_refs` (companies domain,
 *    `Customer:<name>` → strip prefix to bare ERP name).
 *  - `ctx.refs.project` from `record.projectId` via the binding's ERP-project→PMO map
 *    (`binding.config.project_map[projectId]` → ERP `project` name). The Director ruling §6.1
 *    says: resolve by ERP `project_name` search first; auto-create on miss is a separate
 *    concern (the binding map is the override; search-by-name + create is a fast-follow).
 *    Here we use the binding map as the source of truth for the ERP project name.
 *  - For `incoming-payment`: `references[]` row's `reference_name` from `record.salesInvoiceId`
 *    via `external_refs` (revenue domain → the SI's ERP name). The body builder reads
 *    `rec.references` (set by the repo from `salesInvoiceId`) and maps to ERP `references`.
 */
export async function resolveRevenueRefs(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ refs: Record<string, string | null> }> {
  const refs: Record<string, string | null> = {};
  const record = deps.command.record as {
    erp_doc_kind?: string;
    customerId?: string;
    projectId?: string;
    salesInvoiceId?: string;
    paid_amount?: unknown;
  };
  const kind = record.erp_doc_kind;

  if ((kind !== 'sales-invoice' && kind !== 'incoming-payment') || !record.customerId) {
    return { refs };
  }

  // Resolve customer (companies domain: Customer:<name> → bare name)
  const customerExternalId = await resolveExternalRef(
    deps.serviceClient as unknown as ExternalRefsLookupClient,
    deps.orgId,
    'companies',
    record.customerId,
  );
  if (customerExternalId) {
    refs.customer = customerExternalId.startsWith('Customer:')
      ? customerExternalId.slice('Customer:'.length)
      : customerExternalId;
  }

  // Resolve project for sales-invoice (the gate on this ref is enforced by `assertSiProjectGate`,
  // ahead of the adapter — both use `resolveErpProjectName` so they can never diverge).
  if (kind === 'sales-invoice') {
    refs.project = resolveErpProjectName(binding.config, record.projectId);
    if (buildsSalesInvoiceBody({ operation: deps.command.operation, record: { verb: deps.command.record.verb } })) {
      await resolveSalesInvoicePo(deps);
    }
  }

  // Resolve SI reference for incoming-payment — Luna BLOCK 5 (MONEY-CRITICAL):
  // - If salesInvoiceId is present but UNRESOLVABLE → reject (classified error, no ERP write)
  // - If salesInvoiceId is present and RESOLVED → DISCARD any caller-supplied references,
  //   build references[] ONLY from the server-resolved SI ERP name + paid_amount
  // - If salesInvoiceId is null/absent → allow unreferenced on-account receipt (empty references[])
  if (kind === 'incoming-payment') {
    if (record.salesInvoiceId) {
      const siExternalId = await resolveExternalRef(
        deps.serviceClient as unknown as ExternalRefsLookupClient,
        deps.orgId,
        'revenue',
        record.salesInvoiceId,
      );
      if (!siExternalId) {
        throw new AppError(
          `salesInvoiceId '${record.salesInvoiceId}' not found in this org's revenue external_refs`,
          'cross-org-link-rejected',
        );
      }
      refs.si = siExternalId;
      // DISCARD caller-supplied references entirely; build ONLY from resolved SI
      (deps.command.record as { references?: unknown }).references = [
        { reference_doctype: 'Sales Invoice', reference_name: siExternalId, allocated_amount: record.paid_amount ?? null },
      ];
    } else {
      // No salesInvoiceId → on-account receipt: explicit empty references (never caller-supplied)
      (deps.command.record as { references?: unknown }).references = [];
    }
  }

  return { refs };
}

/**
 * #762 — the currencies of the two accounts a withholding receipt posts between. DD-RCPT-1's shape (the
 * cash in both headers, the tax as a deduction) holds only when they match; `peReceiveToBody` refuses
 * otherwise. Read only for a receipt with tax withheld, so no other command pays for the two reads.
 */
async function readReceiptAccountCurrencies(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<{ paid_from_account_currency: string | null; paid_to_account_currency: string | null }> {
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  const currencyOf = async (account: unknown): Promise<string | null> => {
    if (typeof account !== 'string' || !account) return null;
    const currency = (await getDoc(client, 'Account', account) as { account_currency?: unknown } | null)?.account_currency;
    return typeof currency === 'string' && currency ? currency : null;
  };
  const config = binding.config ?? {};
  return {
    paid_from_account_currency: await currencyOf(config.default_receivable_account),
    paid_to_account_currency: await currencyOf(config.default_cash_account ?? config.default_bank_account),
  };
}

/**
 * AC-WHT-004 — the receipt `ctx.config` merge for an incoming payment WITH withheld tax: the org's
 * `tax_prepaid_account` is required (fail-closed `config-rejected` before any ERP write), merged
 * into the binding config together with the two account currencies `peReceiveToBody` validates
 * against. Every other command sees the binding config untouched.
 */
export async function resolveReceiptConfig(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
): Promise<Record<string, unknown>> {
  const record = deps.command.record as { erp_doc_kind?: unknown; withheld_amount?: unknown };
  // Negated EXACTLY as `kind === 'incoming-payment' && Number(withheld_amount ?? 0) > 0` (a NaN
  // withheld_amount fails the `> 0` test, so it must fail this guard too — never re-read the org row).
  if (record.erp_doc_kind !== 'incoming-payment' || !(Number(record.withheld_amount ?? 0) > 0)) return binding.config;
  const { data: settings, error: settingError } = await deps.serviceClient.from('organizations')
    .select('tax_prepaid_account').eq('id', deps.orgId).maybeSingle();
  const account = (settings as { tax_prepaid_account?: unknown } | null)?.tax_prepaid_account;
  if (settingError || typeof account !== 'string' || !account.trim() || account.length > 140) {
    throw new AppError('Set the Tax-prepaid account in Administration → Accounting before recording withheld tax.', 'config-rejected');
  }
  return { ...binding.config, tax_prepaid_account: account.trim(),
    ...(await readReceiptAccountCurrencies(deps, binding)) };
}

/**
 * #766 / ADR-0077 — a Sales Invoice whose PMO record id is a billing claim's id IS that claim's invoice.
 * Its lines come from the claim alone and are rebuilt on EVERY resolution (a sweep recovery re-derives the
 * identical payload and digest); the caller's project and customer must be the claim's; the claim must carry
 * evidence (the outbox fence is the database half of this rule); and nothing but a create may build its
 * body — a wrong claim invoice is cancelled and a new claim raised (DD-PBL-7).
 */
const MAX_CLAIM_LINES = 500;
function taxBaseFraction(row: unknown): { numerator: number; denominator: number } {
  const r = (row ?? {}) as { tax_base_numerator?: unknown; tax_base_denominator?: unknown };
  const numerator = Number(r.tax_base_numerator ?? 1);
  const denominator = Number(r.tax_base_denominator ?? 1);
  return numerator > 0 && denominator >= numerator ? { numerator, denominator } : { numerator: 1, denominator: 1 };
}
/** A project that is subject to VAT is never invoiced untaxed: no ERP company or no default template is a setup action, not a free pass. */
const MISSING_TAX_SETUP = 'This project is subject to VAT, but ERPNext has no default Sales Taxes and Charges template for this company. Set a default Sales Taxes and Charges template in ERPNext for this company (or switch the project off VAT before its first invoice), then raise the invoice again.';
function requireTaxRows(rows: ErpTaxRow[]): ErpTaxRow[] {
  if (rows.length === 0) throw new AppError(MISSING_TAX_SETUP, 'config-rejected');
  return rows;
}

/**
 * #856 / OD-TAX-4 — an ordinary (non-claim) Sales Invoice create gets the same explicit tax rows a claim invoice does (ERPNext
 * does not expand a template over REST, so without them the client is billed untaxed). The project's "Subject to VAT" flag is
 * the gate: OFF sends NO rows and makes no template read; ON builds them with `resolveSalesTaxRows` at the project's
 * reduced-base fraction (0227). The flag is read server-side — a caller's value is never consulted, and a caller's `taxes`
 * was already stripped. Rows are built before the outbox snapshot, so the payload and digest cover them. Edits and amends send none.
 */
export async function resolveOrdinaryInvoiceTaxes(
  deps: ErpDispatchFactoryDeps,
  binding: ExternalOrgBindingRow,
  record: Record<string, unknown>,
): Promise<void> {
  const company = binding.config?.company;
  if (deps.command.operation !== 'create') {
    const verb = record.verb;
    if (deps.command.operation === 'update' || (deps.command.operation === 'transition' && verb === 'amend')) {
      const { data: invoice, error: invoiceError } = await deps.serviceClient.from('sales_invoices')
        .select('project_id').eq('org_id', deps.orgId).eq('id', record.id as string).maybeSingle();
      if (invoiceError) throw new AppError(invoiceError.message, invoiceError.code);
      const projectId = (invoice as { project_id?: string | null } | null)?.project_id;
      if (projectId) {
        const { data: project, error: projectError } = await deps.serviceClient.from('projects')
          .select('subject_to_vat').eq('org_id', deps.orgId).eq('id', projectId).maybeSingle();
        if (projectError) throw new AppError(projectError.message, projectError.code);
        const vat = (project as { subject_to_vat?: unknown } | null)?.subject_to_vat;
        if (typeof vat !== 'boolean') throw new AppError('Project VAT context could not be verified.', 'config-rejected');
        record.vat_flag_at_resolution = vat;
      }
    }
    return;
  }
  let fraction = { numerator: 1, denominator: 1 };
  if (typeof record.projectId === 'string' && record.projectId) {
    const { data, error } = await deps.serviceClient.from('projects')
      .select('subject_to_vat,tax_base_numerator,tax_base_denominator')
      .eq('org_id', deps.orgId).eq('id', record.projectId).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    const project = data as { subject_to_vat?: unknown } | null;
    if (!project || typeof project.subject_to_vat !== 'boolean') {
      throw new AppError('Project VAT context could not be verified. Refresh the project and try again.', 'config-rejected');
    }
    record.vat_flag_at_resolution = project.subject_to_vat;
    if (project.subject_to_vat === false) return;
    fraction = taxBaseFraction(data);
  }
  if (typeof company !== 'string' || !company) throw new AppError(MISSING_TAX_SETUP, 'config-rejected');
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  record.taxes = requireTaxRows(await resolveSalesTaxRows(client, company, fraction));
}

/** #858: the currency ERPNext will bill the customer in: the Customer's default currency, else the Company's. */
async function assertClaimCurrencyMatchesErp(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow, client: ErpClientDeps, claimCurrency: string | undefined, customerId: unknown, subject: 'claim' | 'invoice' = 'claim',
): Promise<void> {
  const externalId = typeof customerId === 'string'
    ? await resolveExternalRef(deps.serviceClient as unknown as ExternalRefsLookupClient, deps.orgId, 'companies', customerId) : null;
  const customerName = externalId?.startsWith('Customer:') ? externalId.slice('Customer:'.length) : externalId;
  const pick = (doc: unknown): string | null => {
    const value = (doc as { default_currency?: unknown } | null)?.default_currency;
    return typeof value === 'string' && value ? value : null;
  };
  let erpCurrency = customerName ? pick(await getDoc(client, 'Customer', customerName)) : null;
  const company = binding.config?.company;
  if (!erpCurrency && typeof company === 'string' && company) erpCurrency = pick(await getDoc(client, 'Company', company));
  if (!erpCurrency) {
    throw new AppError('PMO cannot tell which currency ERPNext bills this customer in. Set a default currency on the customer (or the company) in ERPNext, then raise the invoice again.', 'config-rejected');
  }
  if (erpCurrency !== claimCurrency) {
    throw new AppError(`This ${subject} is in ${claimCurrency ?? 'an unknown currency'}, but ERPNext bills this customer in ${erpCurrency}. Align the customer's default currency in ERPNext with the project currency (or raise the ${subject} from a project in ${erpCurrency}), then raise the invoice again.`, 'config-rejected');
  }
}

/**
 * #866: an ordinary invoice create is stated in its project's currency (the org's default when it has no project). Refuse a
 * mismatch with the customer's ERPNext billing currency before any write, and put the currency on the record so the body
 * (and so the persisted outbox payload a replay re-sends) carries it explicitly.
 * OD-BILL-1: an edit or amend (it rebuilds the body; the caller only reaches here for those) is stated in the invoice's
 * own mirrored currency, so ERPNext refuses a re-denomination and the work-order fence (0262) compares currencies.
 */
export async function resolveOrdinaryInvoiceCurrency(
  deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow, record: Record<string, unknown>,
): Promise<void> {
  if (deps.command.operation !== 'create') {
    const { data, error } = await deps.serviceClient.from('sales_invoices').select('currency')
      .eq('org_id', deps.orgId).eq('id', record.id as string).maybeSingle();
    if (error) throw new AppError(error.message, error.code);
    const value = (data as { currency?: unknown } | null)?.currency;
    if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) {
      throw new AppError('PMO cannot tell which currency this invoice is in. Refresh the invoice from ERPNext, then edit it again.', 'config-rejected');
    }
    record.currency = value;
    return;
  }
  const projectId = typeof record.projectId === 'string' && record.projectId ? record.projectId : null;
  const { data, error } = projectId
    ? await deps.serviceClient.from('projects').select('currency').eq('org_id', deps.orgId).eq('id', projectId).maybeSingle()
    : await deps.serviceClient.from('organizations').select('default_currency').eq('id', deps.orgId).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  const row = data as { currency?: unknown; default_currency?: unknown } | null;
  const value = projectId ? row?.currency : row?.default_currency;
  const currency = typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : undefined;
  if (!currency) throw new AppError('PMO cannot tell which currency this invoice is in. Set a currency on the project, then raise the invoice again.', 'config-rejected');
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  await assertClaimCurrencyMatchesErp(deps, binding, client, currency, record.customerId, 'invoice');
  record.currency = currency;
}

/** #858: the integration user may lack read on Selling Settings; say what to do instead of surfacing the raw permission error. */
async function negativeRatesAllowedOrAction(client: ErpClientDeps): Promise<boolean> {
  try {
    return await readNegativeRatesAllowed(client);
  } catch {
    throw new AppError('PMO cannot read Selling Settings in ERPNext, which this claim needs to check that negative rates are allowed for the down-payment recovery. An ERP administrator must give the PMO integration user read access to Selling Settings (or turn on "Allow Negative rates for Items" and re-run ERP onboarding), then raise the invoice again.', 'config-rejected');
  }
}

export async function resolveProgressClaimInvoice(deps: ErpDispatchFactoryDeps, binding: ExternalOrgBindingRow): Promise<'ordinary' | 'claim' | 'none'> {
  const record = deps.command.record as Record<string, unknown>;
  if (record.erp_doc_kind !== 'sales-invoice') return 'none';
  // #858: a recovery replays the persisted, server-built items and taxes (the digest covers them); re-deriving them would read
  // ERPNext again and could drift from the original digest if the template, the VAT flag or the negative-rates setting moved since.
  if (deps.replay && deps.command.operation === 'create') return 'none';
  delete record.taxes;
  delete record.currency; // only a claim sets it, from the claim row below
  if (!buildsSalesInvoiceBody({ operation: deps.command.operation, record: { verb: record.verb } })) return 'none';
  if (typeof record.id !== 'string' || !record.id.trim()) {
    // A create without a usable id would skip the currency check and the VAT rows below; refuse it before any ERPNext call.
    if (deps.command.operation === 'create') throw new AppError('A sales invoice needs a valid id', 'commit-rejected');
    return 'none';
  }
  const { data: claimData, error } = await deps.serviceClient.from('progress_claims')
    .select('id,kind,project_id,work_order_id,currency,down_payment_amount,dp_recovery_amount,dp_item_code,withdrawn_at')
    .eq('org_id', deps.orgId).eq('id', record.id).maybeSingle();
  if (error) throw new AppError(error.message, error.code);
  // `taxes` is server-resolved for a claim only (deleted above): a caller can never smuggle tax rows into an invoice.
  // OD-BILL-1 / DD-BWO-8: an ordinary invoice CREATE may name the work order it bills ("Invoice this work order", the
  // assistant's work-order draft). Its org is checked by the link pre-flight (DOMAIN_LINK_FIELDS); its project, status
  // and what is still to invoice by the outbox fence (0262) before any ERP write. Edits and amends never move it —
  // their work order is the mirror row's, which that same fence reads.
  if (!claimData) {
    const named = typeof record.workOrderId === 'string' && record.workOrderId.trim() !== '';
    if (deps.command.operation !== 'create' || !named) delete record.workOrderId;
    return 'ordinary';
  }
  const claim = claimData as ProgressClaimRecord;
  // DD-PBL-7 (one claim, one invoice): ids are compared as TEXT downstream (external_refs, the one-in-flight
  // outbox index, withdraw_progress_claim), so a case-variant of the claim id would mint a second invoice.
  if (record.id !== claim.id) {
    throw new AppError('This progress claim must be raised under its own id', 'commit-rejected');
  }
  if (deps.command.operation !== 'create') {
    throw new AppError('A progress claim invoice cannot be edited or amended from PMO — cancel the invoice and raise a new claim', 'commit-rejected');
  }
  if (record.projectId !== claim.project_id) {
    throw new AppError('The invoice project must be the progress claim project', 'commit-rejected');
  }
  const { data: project, error: projectError } = await deps.serviceClient.from('projects')
    .select('client_id,subject_to_vat,tax_base_numerator,tax_base_denominator').eq('org_id', deps.orgId).eq('id', claim.project_id).maybeSingle();
  if (projectError) throw new AppError(projectError.message, projectError.code);
  const clientId = (project as { client_id?: string | null } | null)?.client_id ?? null;
  let fraction = taxBaseFraction(project);
  const subjectToVat = (project as { subject_to_vat?: unknown } | null)?.subject_to_vat !== false;
  if (!project || typeof (project as { subject_to_vat?: unknown }).subject_to_vat !== 'boolean') {
    throw new AppError('Project VAT context could not be verified. Refresh the project and try again.', 'config-rejected');
  }
  record.vat_flag_at_resolution = subjectToVat;
  if (!clientId || record.customerId !== clientId) {
    throw new AppError('The invoice customer must be the project client', 'commit-rejected');
  }
  const { data: evidence, error: evidenceError } = await deps.serviceClient.from('progress_claim_evidence')
    .select('id').eq('org_id', deps.orgId).eq('claim_id', claim.id).limit(1);
  if (evidenceError) throw new AppError(evidenceError.message, evidenceError.code);
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new AppError("Attach the billing evidence (for example the progress report or the client's acceptance) before raising this invoice", 'commit-rejected');
  }
  let lines: ProgressClaimLineRecord[] = [];
  if (claim.kind === 'progress') {
    const { data, error: linesError } = await deps.serviceClient.from('progress_claim_lines')
      .select('item_code,description,unit,quantity,rate')
      .eq('org_id', deps.orgId).eq('claim_id', claim.id)
      .order('boq_item_id', { ascending: true }).limit(MAX_CLAIM_LINES + 1);
    if (linesError) throw new AppError(linesError.message, linesError.code);
    lines = (data ?? []) as ProgressClaimLineRecord[];
    if (lines.length > MAX_CLAIM_LINES) {
      throw new AppError(`A progress claim may have at most ${MAX_CLAIM_LINES} lines`, 'commit-rejected');
    }
  }
  if (claim.work_order_id) {
    const { data: workOrder, error: workOrderError } = await deps.serviceClient.from('work_orders')
      .select('tax_base_numerator,tax_base_denominator').eq('org_id', deps.orgId).eq('id', claim.work_order_id).maybeSingle();
    if (workOrderError) throw new AppError(workOrderError.message, workOrderError.code);
    if (workOrder) fraction = taxBaseFraction(workOrder);
  }
  record.items = progressClaimItems(claim, lines);
  record.workOrderId = claim.work_order_id;
  // #858: sent explicitly so ERPNext itself rejects a mismatch with the party account currency; part of the persisted body, so a replay sends the same.
  if (claim.currency) record.currency = claim.currency;
  // DD-PBL-7: the server builds the invoice from the claim alone — a caller's PO reference or receipt date is dropped
  // (the PO is re-derived from the claim's work order by `resolveSalesInvoicePo`).
  delete record.reference_number;
  delete record.po_date;
  delete record.received_date;
  const client: ErpClientDeps = { fetchImpl: deps.fetchImpl, apiKey: deps.apiKey, apiSecret: deps.apiSecret,
    baseUrl: binding.site_url, rateLimiter: deps.rateLimiter };
  // #858: the claim is stated in its own currency, but ERPNext bills in the customer's (else the company's). Refuse a mismatch
  // before a draft exists rather than book the amounts in the wrong currency.
  await assertClaimCurrencyMatchesErp(deps, binding, client, claim.currency, record.customerId);
  // DD-PBL-12a: a recovery line is a negative rate, which ERPNext refuses at submit unless the site allows it.
  // Fail fast (before a draft exists) with the action to take; onboarding enables it, this catches a site that never
  // ran onboarding or had it switched back off.
  if (Number(claim.dp_recovery_amount) > 0 && !(await negativeRatesAllowedOrAction(client))) {
    throw new AppError('ERPNext does not allow negative rates yet, which this claim needs to recover the down payment. An ERP administrator must turn on "Allow Negative rates for Items" in Selling Settings (or re-run ERP onboarding), then raise the invoice again.', 'config-rejected');
  }
  // DD-PBL-12b: ERPNext does not expand a template named over REST, so the tax rows are sent explicitly.
  // OD-TAX-4: a project that is not subject to VAT sends no tax rows and reads no template (the flag is read above, server-side).
  if (subjectToVat) {
    const company = binding.config?.company;
    if (typeof company !== 'string' || !company) throw new AppError(MISSING_TAX_SETUP, 'config-rejected');
    record.taxes = requireTaxRows(await resolveSalesTaxRows(client, company, fraction));
  } else {
    delete record.taxes;
  }
  return 'claim';
}

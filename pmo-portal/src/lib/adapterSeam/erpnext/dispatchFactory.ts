/**
 * ERPNext dispatch factory (task 2.13, mirrors `clickup/dispatchFactory.ts`). Resolves the per-org
 * erpnext adapter from the ALREADY-ACTIVATED `external_org_bindings` row (0095) — the version
 * handshake (FR-ENA-012) runs once at bind-create/refresh time, not on every dispatch. Credentials
 * (`apiKey`/`apiSecret`) are resolved from `secret_ref` at the edge-fn boundary and passed in — this
 * module never reads `secret_ref`/vault/env itself (NFR-ENA-SEC-002). `ctx.refs` is populated by
 * `resolveProcurementOrderRefs` (task 5.3, FR-ENA-103) for a PO/GR command; other kinds get an empty
 * refs bag until their own slice wires resolution.
 *
 * T-31 (ADP-021 / XG04-004): the per-domain command preparation moved OUT of this file into focused
 * modules — `dispatchTypes.ts` (shared types + the body-building predicate), `dispatchRefs.ts`
 * (shared project/party mapping), `dispatchPreflight.ts` (the cross-org link + ERP-project gates),
 * `dispatchProcurement.ts`, `dispatchRevenue.ts`, `dispatchTimesheet.ts` and `dispatchBudget.ts`.
 * THIS file is now the explicit ordered orchestration seam only: it resolves the binding, runs the
 * gates and resolvers in the EXACT order the monolith used (each step's position is behaviour —
 * see the Luna ordering notes inline), and assembles `ctx`. It re-exports the existing public
 * helpers, so every caller (edge fns + tests) keeps importing from here unchanged. No new
 * product-adapter port was introduced (ADR-0055).
 */
import { createErpAdapter, ERPNEXT_TIER, type ErpAdapterDeps } from './adapter.ts';
import { listErpItems, validateItemLines } from './itemCatalog.ts';
import { resolveExternalRef, type ExternalRefsLookupClient } from '../refs.ts';
import type { Adapter } from '../contract.ts';
import { AppError } from '../../appError.ts';
import type { ErpProbeDeps } from './recoveryProbe.ts';
import type { ErpDispatchFactoryDeps, ExternalOrgBindingRow } from './dispatchTypes.ts';
import { buildsSalesInvoiceBody } from './dispatchTypes.ts';
import { assertCommandLinksSameOrg, assertLinkBelongsToOrg, assertSiProjectGate } from './dispatchPreflight.ts';
import { resolveSupplierRef } from './dispatchRefs.ts';
import { resolvePaymentRefs, resolveProcurementOrderRefs, resolvePurchaseInvoiceTaxes, resolvePurchaseProjectRefs } from './dispatchProcurement.ts';
import { resolveOrdinaryInvoiceCurrency, resolveOrdinaryInvoiceTaxes, resolveProgressClaimInvoice, resolveReceiptConfig, resolveRevenueRefs } from './dispatchRevenue.ts';
import { resolveTimesheetRefs } from './dispatchTimesheet.ts';
import { assertBudgetBindingIdentity, isBudgetCommand, readCategoryAccountMap, resolveBudgetRefs } from './dispatchBudget.ts';

// ── Public seam (re-exports): everything `dispatchFactory.ts` exported before the split, from the
// same import path. Edge fns (`adapter-dispatch/*`, `erpnext-sweep`) and the vitest suites import
// from here; the implementations live beside their domains now.
export type {
  DispatchFilterBuilder,
  DispatchServiceClient,
  ErpDispatchFactoryDeps,
  ProcurementSourceLine,
} from './dispatchTypes.ts';
export { buildsSalesInvoiceBody };
export type { ConfirmedEmployeeLookup } from './dispatchTimesheet.ts';
export { lookupConfirmedErpEmployee } from './dispatchTimesheet.ts';
export { readBudgetLineItems, readCategoryAccountMap } from './dispatchBudget.ts';

// ============================================================================
// Luna re-audit BLOCK #1 — the fallback anchor probe needs the payment_type discriminator
// ============================================================================

/** The two PMO kinds that share Frappe's single `Payment Entry` doctype, and the `payment_type` that
 *  tells them apart. Any other kind has no discriminator (its doctype is unambiguous). */
const PAYMENT_TYPE_BY_KIND: Readonly<Record<string, 'Pay' | 'Receive'>> = {
  payment: 'Pay',
  'incoming-payment': 'Receive',
  // #775 phase B — Employee Payment Entries (the expense postings' Pay/Receive twins).
  'expense-payment': 'Pay',
  'expense-receipt': 'Receive',
};

/**
 * Conjoin the `payment_type` discriminator onto a Payment Entry recovery probe.
 *
 * `probeErpByPaymentComposite` already does this for the composite path, but the adapter-dispatch
 * FALLBACK (taken when no composite payload has been persisted yet) called the bare
 * `probeErpByAnchorKey`. Since 'Pay' and 'Receive' entries share one doctype and the anchor field
 * (`reference_no`) is ERP-side editable, an unfiltered anchor `like` can adopt an entry of the WRONG
 * direction whenever the two share a reference_no — mirroring a PMO incoming payment onto an outgoing
 * payment document (or cancelling the wrong one later, since the adopted name becomes the mapping).
 *
 * Applies both the server-side list filter AND the post-fetch validator (defense in depth, matching
 * `probeErpByPaymentComposite`'s own anchor deps). A doc that does not state its `payment_type` is
 * refused rather than adopted. A non-Payment-Entry kind is returned UNCHANGED (byte-for-byte).
 */
export function withPaymentTypeDiscriminator(deps: ErpProbeDeps, kind: unknown): ErpProbeDeps {
  const paymentType = typeof kind === 'string' ? PAYMENT_TYPE_BY_KIND[kind] : undefined;
  if (!paymentType) return deps;
  return {
    ...deps,
    anchorExtraFilters: [['payment_type', '=', paymentType]],
    validateAdoptedDoc: (doc) => (doc as { payment_type?: unknown }).payment_type === paymentType,
  };
}

/**
 * Resolve the erpnext adapter for one command: read the org's `external_org_bindings` row, refuse
 * `config-rejected` when it is missing or not yet activated (`activated_at === null` — a version
 * mismatch or a binding never activated, FR-ENA-012), then build the adapter over the resolved
 * `site_url`/`config`.
 *
 * ⚑ ORDERING IS BEHAVIOUR. Each step below runs at exactly the position the pre-split monolith ran
 * it; the guarded steps are marked. The suites `dispatchFactory*.test.ts` pin the externally visible
 * half (a refused step issues no later read/call), so a reordering turns them red.
 */
export async function resolveErpDispatchAdapter(deps: ErpDispatchFactoryDeps): Promise<Adapter> {
  const { data, error } = await deps.serviceClient
    .from('external_org_bindings')
    .select('site_url, version_major, activated_at, config')
    .eq('org_id', deps.orgId)
    .eq('external_tier', ERPNEXT_TIER)
    .maybeSingle();
  if (error || !data) {
    throw new AppError('no erpnext binding configured for this org', error?.code ?? 'BINDING_NOT_FOUND');
  }
  const binding = data as ExternalOrgBindingRow;
  if (!binding.activated_at) {
    throw new AppError('erpnext binding is not activated (version handshake mismatch or never activated)', 'config-rejected');
  }
  // P3c: the budget push's binding-time identity gate (version/account-identity match), BEFORE any
  // other preparation — the position the inline block always occupied (dispatchBudget).
  assertBudgetBindingIdentity(deps, binding);

  // Luna re-audit BLOCK 2 (+ round-7 B10, the procurement half) — the cross-org link pre-flight runs
  // FIRST: before ref resolution (which can issue ERP GETs), before the adapter is constructed, and
  // therefore before any ERP write or outbox commit. A cross-org link must never reach ERPNext (orphan
  // money, no PMO row) nor a service-role mirror insert (this org's org_id + another tenant's FK).
  await assertCommandLinksSameOrg(deps);
  const invoiceKind = await resolveProgressClaimInvoice(deps, binding);
  // AC-WHT-004: the withheld-tax receipt config merge — after the claim resolution, before the SI
  // project gate (the position the inline block always occupied; dispatchRevenue).
  const receiptConfig = await resolveReceiptConfig(deps, binding);
  // Luna re-audit BLOCK 4 — the SI project gate, likewise ahead of any ERP write.
  assertSiProjectGate(deps, binding);

  // Ref resolution (supplier/PO/PO-item) — task 5.3 wires the PO/GR case; slice 3 wires the
  // companies-domain party create/update path (which needs no cross-doctype resolution of its own).
  const contactRefs: Record<string, string | null> = {};
  if (deps.command.record.erp_doc_kind === 'contact') {
    const companyId = deps.command.record.company_id;
    if (typeof companyId !== 'string' || !companyId) throw new AppError('Contact company is required', 'commit-rejected');
    await assertLinkBelongsToOrg(deps.serviceClient, deps.orgId, 'companies', companyId);
    const externalId = await resolveExternalRef(deps.serviceClient as unknown as ExternalRefsLookupClient, deps.orgId, 'companies', companyId);
    const match = externalId?.match(/^(Customer|Supplier):(.+)$/);
    if (!match) throw new AppError('Contact company must be mapped to ERPNext', 'commit-rejected');
    contactRefs.contact_party_type = match[1];
    contactRefs.contact_party_name = match[2];
  }
  const { refs: purchaseProjectRefs } = await resolvePurchaseProjectRefs(deps, binding);
  const savedReceipt = deps.replay && deps.trustedReceiptSnapshot && deps.command.record.erp_doc_kind === 'goods-receipt'
    ? deps.command.record.pmo_gr_snapshot as { supplier?: unknown; po?: unknown } | undefined
    : undefined;
  const { refs: procurementRefs, resolvedItems } = savedReceipt
    ? { refs: {
      supplier: typeof savedReceipt.supplier === 'string' ? savedReceipt.supplier : null,
      po: typeof savedReceipt.po === 'string' ? savedReceipt.po : null,
    }, resolvedItems: undefined }
    : await resolveProcurementOrderRefs(deps, binding);
  const { refs: revenueRefs } = await resolveRevenueRefs(deps, binding);
  // #910: the vendor-payment gate (bill anchor + amount vs outstanding) — before the outbox snapshot,
  // so a refused payment leaves no outbox row and touches no ERP.
  const { refs: paymentRefs } = await resolvePaymentRefs(deps);
  // #856: ordinary-invoice tax rows read ERPNext, so they wait for the project gate and the PMO source reads (all fail closed before any ERP call).
  if (invoiceKind === 'ordinary') await resolveOrdinaryInvoiceCurrency(deps, binding, deps.command.record as Record<string, unknown>);
  if (invoiceKind === 'ordinary') await resolveOrdinaryInvoiceTaxes(deps, binding, deps.command.record as Record<string, unknown>);
  await resolvePurchaseInvoiceTaxes(deps, binding, resolvedItems);
  // Resolve authoring items before the outbox snapshot. Catalog validation belongs to the actual
  // adapter commit, so an already-committed recovery can converge its mirror without ERP reads.
  const itemKind = deps.command.record.erp_doc_kind;
  const receiptSupplier = itemKind === 'goods-receipt'
    ? savedReceipt ? procurementRefs.supplier : procurementRefs.supplier ?? await resolveSupplierRef(deps.serviceClient, deps.orgId, deps.command)
    : undefined;
  if (itemKind === 'goods-receipt' && deps.command.operation === 'create' && !deps.replay
      && typeof deps.command.record.procurementId === 'string') {
    if (resolvedItems && (!Array.isArray(deps.command.record.items) || deps.command.record.items.length === 0)) {
      deps.command.record.items = resolvedItems;
    }
    deps.command.record.pmo_gr_snapshot = {
      supplier: receiptSupplier ?? null,
      po: procurementRefs.po ?? null,
    };
  }
  let validateAuthoringItems: ErpAdapterDeps['validateAuthoringItems'];
  if (
    ['sales-invoice', 'purchase-order', 'purchase-invoice'].includes(String(itemKind)) &&
    buildsSalesInvoiceBody({ operation: deps.command.operation, record: { verb: deps.command.record.verb } })
  ) {
    const record = deps.command.record;
    const lines = Array.isArray(record.items) && record.items.length > 0 ? record.items : resolvedItems;
    if (lines?.length) {
      record.items = lines;
      validateAuthoringItems = async (command, client) => {
        if (!buildsSalesInvoiceBody({ operation: command.operation, record: { verb: command.record.verb } })) return;
        const catalog = await listErpItems(client, itemKind === 'sales-invoice' ? 'sales' : 'purchase');
        validateItemLines(Array.isArray(command.record.items) ? command.record.items : [], catalog);
      };
    }
  }
  // P3b: the timesheet push's fail-closed pre-flight (employee link, per-entry project, activity type,
  // same-org, daily hours). Gated on the kind, so no other command pays for the extra reads.
  const { refs: timesheetRefs } = await resolveTimesheetRefs(deps, binding);
  // P3c: the org's server-resolved category→account map, then the budget push's refs (ERP project +
  // the FR-BUD-121 upsert target). Both are gated on the kind, so no other command pays for the extra
  // read or sees a modified `ctx.config`. ⚑ The map is resolved FIRST because the refs pre-flight
  // validates the line items against it before issuing its ERP grain read (AC-BUD-011: an unmapped
  // category refuses with zero ERP calls).
  const budgetConfig = isBudgetCommand(deps.command)
    ? { ...binding.config, category_account_map: await readCategoryAccountMap(deps.serviceClient, deps.orgId) }
    : receiptConfig;
  const { refs: budgetRefs } = await resolveBudgetRefs(deps, binding, budgetConfig);

  const adapterDeps: ErpAdapterDeps = {
    client: {
      fetchImpl: deps.fetchImpl,
      apiKey: deps.apiKey,
      apiSecret: deps.apiSecret,
      baseUrl: binding.site_url,
      rateLimiter: deps.rateLimiter,
    },
    doctypeBodies: deps.doctypeBodies ?? {},
    validateAuthoringItems,
    // Ref resolution: PO/GR commands (task 5.3, FR-ENA-103) resolve `refs`/`resolvedItems` above via
    // the case's `procurementId` (supplier + line items + PO/PO-item-child-row for a GR). Every other
    // kind — MR/RFQ/SQ (task 4.6/4.7, FR-ENA-111/112) — carries no `procurementId`, so `refs.supplier`
    // comes back unset there; fall back to resolving the command's own `vendorId` through the SAME
    // `companies` domain external_refs mapping (`resolveExternalRef`, task 1.6). The PO/GR path never
    // pays for this fallback call — `??` short-circuits once `refs.supplier` is already resolved.
    // Revenue commands (sales-invoice/incoming-payment) resolve customer + project + SI ref via
    // `resolveRevenueRefs` (task 2.3, FR-SAR-100/101/121).
    ctx: {
      refs: { ...contactRefs, ...procurementRefs, ...purchaseProjectRefs, ...revenueRefs, ...paymentRefs, ...budgetRefs, ...timesheetRefs,
        supplier: itemKind === 'goods-receipt' ? receiptSupplier ?? null : procurementRefs.supplier ?? (await resolveSupplierRef(deps.serviceClient, deps.orgId, deps.command)) },
      config: budgetConfig,
      resolvedItems,
      ...(isBudgetCommand(deps.command) ? {
        versionMajor: binding.version_major as 15 | 16,
        ...(binding.version_major === 16 ? {
          budgetAccount: {
            intent: deps.command.record.budget_intent as 'ensure' | 'remove',
            predecessor: (deps.command.record.budget_predecessor as string | null) ?? null,
          },
        } : {}),
      } : {}),
    },
    validateAuthoringPartyIdentity: async (command) => {
      const kind = command.record.erp_doc_kind;
      if (command.domain !== 'companies' || !['contact', 'customer', 'supplier'].includes(String(kind))) return;
      if (kind === 'contact' && command.operation === 'create') {
        const { data: existing, error } = await deps.serviceClient.from('contacts')
          .select('id').eq('id', command.record.id).maybeSingle();
        if (error) throw new AppError(error.message, error.code);
        if (existing) throw new AppError('Contact create requires a new record identity', 'commit-rejected');
      }
      const oppositeTable = kind === 'contact' ? 'companies' : 'contacts';
      const { data: opposite, error: identityError } = await deps.serviceClient.from(oppositeTable)
        .select('id').eq('org_id', deps.orgId).eq('id', command.record.id).maybeSingle();
      if (identityError) throw new AppError(identityError.message, identityError.code);
      if (opposite) throw new AppError('This record identity already belongs to another party type', 'commit-rejected');
    },
    afterSubmitHook: deps.afterSubmitHook,
    afterCancelHook: deps.afterCancelHook,
  };
  return createErpAdapter(adapterDeps);
}

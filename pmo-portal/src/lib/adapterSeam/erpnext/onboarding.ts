/**
 * erpnext/onboarding.ts (task 3.9, AC-ENA-041) — the pull-adopt onboarding orchestration: composes
 * `partyAdopt.ts`'s pure mapping with injected `external_refs`/`companies` I/O so that adopting the
 * SAME ERP party twice (a retried onboarding run) mints exactly ONE `companies` mirror row + ONE
 * `external_refs` mapping — never a duplicate. Mirrors `clickup/onboarding.ts`'s pure/Deno-importable
 * shape (the edge fn `supabase/functions/erpnext-onboard/index.ts` is thin wiring around this).
 */
import { adoptParty, externalIdFor, type ErpPartySource, type PartyCandidate } from './partyAdopt.ts';
import { erpnextRequest, type ErpClientDeps } from './client.ts';
import type { PmoRecord } from '../contract.ts';

interface RawSupplierRow {
  name: string;
  supplier_name?: string;
  tax_id?: string | null;
  is_internal_supplier?: 0 | 1;
}
interface RawCustomerRow {
  name: string;
  customer_name?: string;
  tax_id?: string | null;
  is_internal_customer?: 0 | 1;
  payment_terms?: string | null;
}

/** GET `/api/resource/Supplier`/`/api/resource/Customer` and map into `ErpPartySource[]` — the ONE
 *  place this edge-fn-adjacent onboarding flow touches Frappe REST vocabulary (confinement,
 *  NFR-ENA-CONTRACT-001) so `supabase/functions/erpnext-onboard/index.ts` stays vocabulary-free.
 *  `payment_terms` is the Payment Terms Template NAME, not the resolved `credit_days` — resolving
 *  the template itself is deferred (deriveErpPaymentTermsDays's caller-supplied-or-30-default
 *  applies via `onboardParties` -> `adoptParty`, task 3.2). */
export async function listErpPartySources(client: ErpClientDeps): Promise<ErpPartySource[]> {
  const supplierFields = encodeURIComponent(JSON.stringify(['name', 'supplier_name', 'tax_id', 'is_internal_supplier']));
  const customerFields = encodeURIComponent(JSON.stringify(['name', 'customer_name', 'tax_id', 'is_internal_customer', 'payment_terms']));
  const [suppliers, customers] = await Promise.all([
    erpnextRequest(client, { method: 'GET', path: `/api/resource/Supplier?fields=${supplierFields}&limit_page_length=0` }) as Promise<{ data?: RawSupplierRow[] }>,
    erpnextRequest(client, { method: 'GET', path: `/api/resource/Customer?fields=${customerFields}&limit_page_length=0` }) as Promise<{ data?: RawCustomerRow[] }>,
  ]);
  const supplierSources: ErpPartySource[] = (suppliers.data ?? []).map((row) => ({
    doctype: 'Supplier',
    name: row.supplier_name ?? row.name,
    taxId: row.tax_id ?? null,
    isInternal: row.is_internal_supplier === 1,
  }));
  const customerSources: ErpPartySource[] = (customers.data ?? []).map((row) => ({
    doctype: 'Customer',
    name: row.customer_name ?? row.name,
    taxId: row.tax_id ?? null,
    isInternal: row.is_internal_customer === 1,
    // paymentTermsDays: the template's resolved credit_days, not derivable from this list response
    // alone (would need a second GET per distinct template name) — left undefined -> the FR-ENA-094
    // 30-day default applies via adoptParty. A future slice may batch-resolve templates.
    paymentTermsDays: undefined,
  }));
  return [...supplierSources, ...customerSources];
}

export interface OnboardPartiesDeps {
  /** Resolve an already-adopted party by its doctype-encoded external id (the idempotency check —
   *  a second run of the SAME source finds this and takes the update, not the mint, branch). */
  findPmoRecordId: (externalRecordId: string) => Promise<string | null>;
  /** Existing PMO `companies` candidates for a first-time adopt (mixed-state onboarding matching,
   *  FR-ENA-093) — never consulted on the idempotent-retry branch (the mapping is already known). */
  findCandidates: (doctype: ErpPartySource['doctype'], name: string) => Promise<PartyCandidate[]>;
  insertCompaniesMirror: (canonical: PmoRecord) => Promise<void>;
  updateCompaniesMirror: (pmoRecordId: string, canonical: PmoRecord) => Promise<void>;
  recordExternalRef: (mapping: { pmoRecordId: string; externalRecordId: string }) => Promise<void>;
}

export interface OnboardPartiesResult {
  /** Newly minted mirror rows (first-time adopts) this run. */
  adopted: number;
  /** Already-mapped parties re-applied this run (idempotent retry — no new mirror row). */
  reconciled: number;
}

/**
 * Pull-adopt every given ERP Supplier/Customer source. AC-ENA-041's "adopted twice ⇒ exactly one
 * mirror + one external_refs" holds because the SECOND call for the same source finds its mapping
 * via `findPmoRecordId` and takes the update branch — `insertCompaniesMirror`/`recordExternalRef`
 * (the mint path) are called AT MOST ONCE per distinct external id, no matter how many times
 * `onboardParties` runs against the same underlying state.
 */
export async function onboardParties(sources: readonly ErpPartySource[], deps: OnboardPartiesDeps): Promise<OnboardPartiesResult> {
  let adopted = 0;
  let reconciled = 0;
  for (const source of sources) {
    const externalRecordId = externalIdFor(source.doctype, source.name);
    const existingPmoRecordId = await deps.findPmoRecordId(externalRecordId);
    if (existingPmoRecordId) {
      // Idempotent-retry branch: the mapping is already known — re-derive the canonical shape
      // (picking up any field changes on the ERP side) and UPDATE, never re-mint / re-record-ref.
      const { canonical } = await adoptParty(source, {
        findCandidates: async () => [{ pmoRecordId: existingPmoRecordId, taxId: source.taxId ?? null }],
      });
      await deps.updateCompaniesMirror(existingPmoRecordId, canonical);
      reconciled += 1;
      continue;
    }
    const { canonical, externalRecordId: mintedExternalId } = await adoptParty(source, { findCandidates: deps.findCandidates });
    await deps.insertCompaniesMirror(canonical);
    await deps.recordExternalRef({ pmoRecordId: canonical.id, externalRecordId: mintedExternalId });
    adopted += 1;
  }
  return { adopted, reconciled };
}

/**
 * erpnext/onboarding.ts (task 3.9, AC-ENA-041) — the pull-adopt onboarding orchestration: composes
 * `partyAdopt.ts`'s pure mapping with injected `external_refs`/`companies` I/O so that adopting the
 * SAME ERP party twice (a retried onboarding run) mints exactly ONE `companies` mirror row + ONE
 * `external_refs` mapping — never a duplicate. Mirrors `clickup/onboarding.ts`'s pure/Deno-importable
 * shape (the edge fn `supabase/functions/erpnext-onboard/index.ts` is thin wiring around this).
 */
import { AppError } from '../../appError.ts';
import { adoptParty, externalIdFor, type ErpPartySource, type PartyCandidate } from './partyAdopt.ts';
import { erpnextRequest, ERP_RESPONSE_MAX_BYTES, type ErpClientDeps } from './client.ts';
import { getDoc } from './client.ts';
import { listErpChangesSinceWatermark } from './sweepCursor.ts';
import { contactCanonicalFromDoc, CONTACT_FROM_DOC_FIELDS } from './bodies/contact.ts';
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

/** The response-body cap for the party pull below (#918). `limit_page_length=0` is Frappe's "no
 *  limit", so this is the ONE response whose size is set by the org's data — not by this repo's
 *  pagination. A party row is five short fields (~200 bytes JSON-encoded), so the shared 5 MiB
 *  default covers orgs up to ~25k parties; this raises the ceiling to ~125k — generous room for a
 *  large party master — while still bounding the response so one pull can never buffer without end. */
export const ERP_PARTY_PULL_MAX_BYTES = ERP_RESPONSE_MAX_BYTES * 5;

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
    erpnextRequest(client, { method: 'GET', path: `/api/resource/Supplier?fields=${supplierFields}&limit_page_length=0`, maxResponseBytes: ERP_PARTY_PULL_MAX_BYTES }) as Promise<{ data?: RawSupplierRow[] }>,
    erpnextRequest(client, { method: 'GET', path: `/api/resource/Customer?fields=${customerFields}&limit_page_length=0`, maxResponseBytes: ERP_PARTY_PULL_MAX_BYTES }) as Promise<{ data?: RawCustomerRow[] }>,
  ]);
  const supplierSources: ErpPartySource[] = (suppliers.data ?? []).map((row) => ({
    doctype: 'Supplier',
    id: row.name,
    name: row.supplier_name ?? row.name,
    taxId: row.tax_id ?? null,
    isInternal: row.is_internal_supplier === 1,
  }));
  const customerSources: ErpPartySource[] = (customers.data ?? []).map((row) => ({
    doctype: 'Customer',
    id: row.name,
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
  /** Insert-only claim of the `external_refs` link. Taken BEFORE any company write: it is the adoption lock the
   *  change feed also takes, so a loser of the race (23505) writes no company at all (#1600). */
  recordExternalRef: (mapping: { pmoRecordId: string; externalRecordId: string }) => Promise<void>;
  /** Does the company row for this PMO id exist? `false` for a claimed link whose company never landed
   *  (the run died between the claim and the write): re-written with the SAME id on the next run. */
  mirrorExists: (pmoRecordId: string) => Promise<boolean>;
  /** Tell the org's admins an ERP party was neither linked nor brought in (same text and dedupe as the feed). */
  notifyUnclearMatch: (entry: { doctype: ErpPartySource['doctype']; id: string; name: string; reason: string }) => Promise<void>;
}

export interface OnboardPartiesResult {
  /** Newly minted mirror rows (first-time adopts) this run. */
  adopted: number;
  /** Already-mapped parties re-applied this run (idempotent retry — no new mirror row). */
  reconciled: number;
  /** Parties whose PMO match is unclear (several candidates, or a conflicting tax ID): nothing was
   *  written for them; the rest of the run applied (#1600). */
  needsDecision: Array<{ doctype: ErpPartySource['doctype']; id: string; name: string; reason: string }>;
  /** Internal-type parties are PMO's own org marker, never ERP-flipped: skipped, not an error. */
  skippedInternal: number;
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
  let skippedInternal = 0;
  const needsDecision: OnboardPartiesResult['needsDecision'] = [];
  const flagForDecision = async (entry: OnboardPartiesResult['needsDecision'][number]) => {
    needsDecision.push(entry);
    await deps.notifyUnclearMatch(entry);
  };
  for (const source of sources) {
    if (source.isInternal) {
      skippedInternal += 1;
      continue;
    }
    // Keyed by the ERPNext ID, never the display name, so a ref the sweep minted is found here (#760).
    const externalRecordId = externalIdFor(source.doctype, source.id);
    const existingPmoRecordId = await deps.findPmoRecordId(externalRecordId);
    if (existingPmoRecordId) {
      // Idempotent-retry branch: the mapping is already known — re-derive the canonical shape
      // (picking up any field changes on the ERP side) and UPDATE, never re-mint / re-record-ref.
      const { canonical } = await adoptParty(source, {
        findCandidates: async () => [{ pmoRecordId: existingPmoRecordId, taxId: source.taxId ?? null }],
      });
      if (await deps.mirrorExists(existingPmoRecordId)) {
        await deps.updateCompaniesMirror(existingPmoRecordId, canonical);
        reconciled += 1;
      } else {
        await deps.insertCompaniesMirror(canonical); // claimed link, company never landed: repair with the same id
        adopted += 1;
      }
      continue;
    }
    let adoptedParty;
    try {
      adoptedParty = await adoptParty(source, { findCandidates: deps.findCandidates });
    } catch (err) {
      if (!(err instanceof AppError) || err.code !== 'action-required') throw err;
      await flagForDecision({ doctype: source.doctype, id: source.id, name: source.name, reason: err.details ?? 'unclear-match' });
      continue;
    }
    const { canonical, externalRecordId: mintedExternalId, matched } = adoptedParty;
    // Claim the link FIRST (#1600): a concurrent sweep that already linked this ERP party wins (23505) and no
    // company is written here; a company already linked to another ERP party is a decision, never a re-point.
    try {
      await deps.recordExternalRef({ pmoRecordId: canonical.id, externalRecordId: mintedExternalId });
    } catch (err) {
      if ((err as { code?: string }).code !== '23505') throw err;
      if (await deps.findPmoRecordId(externalRecordId)) {
        reconciled += 1;
      } else {
        await flagForDecision({ doctype: source.doctype, id: source.id, name: source.name, reason: 'already-linked' });
      }
      continue;
    }
    // A matched company already exists under `canonical.id`: link it, never insert it again (#1600).
    if (matched) await deps.updateCompaniesMirror(canonical.id, canonical);
    else await deps.insertCompaniesMirror(canonical);
    adopted += 1;
  }
  return { adopted, reconciled, needsDecision, skippedInternal };
}

/** Contacts require their Dynamic Link children, so enumerate scalars then hydrate each changed doc. */
export async function listErpContactSources(client: ErpClientDeps) {
  return (await listErpChangesSinceWatermark({client, doctype:'Contact', fields:CONTACT_FROM_DOC_FIELDS,
    includeAmendedFrom: false,
    fromDoc:contactCanonicalFromDoc, hydrateDoc:async(name) => await getDoc(client,'Contact',name) as Record<string,unknown>},null)).changes;
}

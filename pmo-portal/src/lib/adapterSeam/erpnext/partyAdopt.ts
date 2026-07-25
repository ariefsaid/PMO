/**
 * erpnext/partyAdopt.ts (task 3.2, FR-ENA-090..093) — the pull-adopt mapping + ambiguous-match +
 * Supplier/Customer collision rule. Confinement: `PartyDoctype`/`isInternal` are the only Frappe
 * vocabulary here, and they stay inside erpnext/** (NFR-ENA-CONTRACT-001).
 *
 * `adoptParty` is a PURE function of its inputs — same source + same existing-candidate snapshot ⇒
 * the identical canonical + externalRecordId every call (partyAdopt.test.ts proves this). The
 * DB-level exactly-once-under-concurrency guarantee is the `external_refs` unique
 * `(org_id,domain,external_record_id)` constraint (1.9); the onboarding fn (3.9) composes this
 * function with that constraint to prove the full "adopted twice ⇒ exactly one mirror" path.
 */
import { AppError } from '../../appError.ts';
import type { PmoRecord } from '../contract.ts';

export type PartyDoctype = 'Supplier' | 'Customer';

/** One ERP Supplier/Customer source document, already field-extracted by the caller (the onboarding
 *  fn / webhook / sweep) — `isInternal` is Frappe's `is_internal_supplier`/`is_internal_customer`
 *  flag (FR-ENA-090/091: "Internal is never ERP-flipped — it is PMO's own org marker"). */
export interface ErpPartySource {
  doctype: PartyDoctype;
  name: string;
  taxId?: string | null;
  /** Customer only (FR-ENA-094) — a pre-resolved `Payment Terms Template Detail.credit_days`, or
   *  undefined when no template is set (defaults to 30 via `deriveErpPaymentTermsDays`). Resolving
   *  the template itself (a separate ERP fetch) is the caller's job — kept out of this pure mapper. */
  paymentTermsDays?: number | null;
  isInternal?: boolean;
}

/** An existing PMO `companies` row this doctype's name might already match (mixed-state onboarding —
 *  a company created in PMO before the org employed ERPNext). */
export interface PartyCandidate {
  pmoRecordId: string;
  taxId: string | null;
}

export interface PartyAdoptDeps {
  /** Existing PMO `companies` candidates matching `(doctype's type, name)` — 0, 1, or many. */
  findCandidates: (doctype: PartyDoctype, name: string) => Promise<PartyCandidate[]>;
}

export interface AdoptedCompany {
  externalRecordId: string;
  canonical: PmoRecord;
}

const DISCRIMINATOR: Record<PartyDoctype, 'Vendor' | 'Client'> = { Supplier: 'Vendor', Customer: 'Client' };

/** `'Supplier:<name>'` / `'Customer:<name>'` — encodes the ERP doctype into the external id so the
 *  Supplier/Customer collision rule (FR-ENA-091) is deterministic under the `unique
 *  (org_id,domain,external_record_id)` constraint (never merges the two doctypes' rows). */
export function externalIdFor(doctype: PartyDoctype, name: string): string {
  return `${doctype}:${name}`;
}

/** FR-ENA-094: `Payment Terms Template Detail.credit_days`, default 30 when no template is resolved. */
export function deriveErpPaymentTermsDays(templateCreditDays: number | null | undefined): number {
  return templateCreditDays ?? 30;
}

// The name+tax-id MATCHING itself (FR-ENA-093: "matching shall be by ERP name and, when present,
// erp_tax_id") happens in the caller's `findCandidates` query — this function only decides what to
// do with the resulting candidate SET: 0 -> new row; 1 -> deterministic adopt; >1 -> the caller's
// matching couldn't narrow to a single row (same name, differing/absent tax id across the
// candidates) -> ambiguous, surfaced for operator resolution, never auto-merged.
function pickCandidate(source: ErpPartySource, candidates: PartyCandidate[]): PartyCandidate | undefined {
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  throw new AppError(
    `ambiguous ${source.doctype} match for "${source.name}" across ${candidates.length} existing PMO companies — resolve manually (FR-ENA-093)`,
    'action-required',
  );
}

/**
 * Map one ERP Supplier/Customer source doc into the PMO `companies` canonical shape + its
 * doctype-encoded external id (FR-ENA-090). Refuses an Internal-shaped source (FR-ENA-091 — never
 * ERP-flipped) and surfaces an ambiguous existing-candidate match as `action-required` rather than
 * auto-merging (FR-ENA-093).
 */
export async function adoptParty(source: ErpPartySource, deps: PartyAdoptDeps): Promise<AdoptedCompany> {
  if (source.isInternal) {
    throw new AppError(
      `refusing to adopt "${source.name}" — Internal-type parties are never ERP-flipped (FR-ENA-090/091)`,
      'config-rejected',
    );
  }
  const candidates = await deps.findCandidates(source.doctype, source.name);
  const matched = pickCandidate(source, candidates);
  const type = DISCRIMINATOR[source.doctype];

  const canonical: PmoRecord = {
    id: matched?.pmoRecordId ?? crypto.randomUUID(),
    name: source.name,
    type,
    erp_party_type: type,
    erp_tax_id: source.taxId ?? null,
    ...(source.doctype === 'Supplier'
      ? { erp_supplier_name: source.name }
      : { erp_customer_name: source.name, erp_payment_terms_days: deriveErpPaymentTermsDays(source.paymentTermsDays) }),
  };

  return { externalRecordId: externalIdFor(source.doctype, source.name), canonical };
}

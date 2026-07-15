/**
 * ADR-0058 §3 recovery probe (task 6.4 + Slice-6 completion) — "did ERP already commit this
 * idempotency key?". Confined to erpnext/** because it speaks Frappe REST vocabulary (`remarks`,
 * `reference_no`, `/api/resource`, doctype names). The money dispatch above the contract
 * (dispatch.ts `probeByRemarksKey`) calls an INJECTED probe closure; this module is that closure's
 * ERPNext body. Deterministic + stock-REST-only (no ERPNext idempotency feature required): list doc
 * `name`s whose per-doctype ANCHOR field (`anchorField` — 'remarks' for PI/Purchase Receipt,
 * 'reference_no' for Payment Entry per the DIRECTOR RULING) carries the key, adopt the first (at most
 * one exists), re-fetch it and map to the PMO canonical via the kind's `fromDoc`, stamping the PMO
 * record id so the adopted mirror keys correctly.
 */
import type { PmoRecord } from '../contract.ts';
import { getDoc, listDocNamesByAnchor, listDocNamesByFilters, type ErpClientDeps, type ErpFilter } from './client.ts';

export interface ErpProbeDeps {
  client: ErpClientDeps;
  doctype: string;
  /** The per-doctype anchor field (doctypeRegistry's `anchorField`) the idempotency key is stamped
   *  into and the probe filters by. 'remarks' for PI/Purchase Receipt, 'reference_no' for Payment
   *  Entry (the DIRECTOR RULING — PE's `validate` overwrites `remarks`; `reference_no` survives). */
  anchorField: string;
  /** The kind's `DOCTYPE_BODIES.fromDoc` — maps the re-fetched ERP doc to the PMO canonical. */
  fromDoc: (doc: unknown) => PmoRecord;
  /** The PMO record id this command owns — stamped onto the adopted canonical so the read-model keys
   *  on the PMO id (never the ERP name), matching the create path (`adapter.ts` commitCreate). */
  pmoRecordId: string;
  /** Luna BLOCK 1 (cross-domain corruption guard): additional SERVER-SIDE filters applied to the
   *  anchor-candidate list query, so a Payment Entry anchor hit can never match a doc of the wrong
   *  `payment_type`/`party_type` (a Receive probe must not adopt a Pay doc and vice-versa). PI /
   *  Purchase Receipt (immutable `remarks` anchor) leave this unset — byte-for-byte. */
  anchorExtraFilters?: ErpFilter[];
  /** Luna BLOCK 1 (defense-in-depth): validates the re-fetched anchor doc BEFORE adopting it. Used by
   *  the mutable-anchor (Payment Entry) composite path to re-confirm `payment_type`/`party_type` on
   *  the fetched doc even when the server-side filter excluded the wrong type. Returns `null` (do not
   *  adopt) when the validator returns false. Omitted for PI/Purchase Receipt. */
  validateAdoptedDoc?: (doc: unknown) => boolean;
}

/**
 * Probe ERP for an orphaned commit stamped with `idempotencyKey` in the doctype's anchor field.
 * Returns the adopted `{ externalRecordId, canonical }` (canonical carries the ERP-derived fields via
 * `fromDoc`, id re-stamped to the PMO record id) or `null` when ERP holds no such doc — the signal for
 * the dispatch to POST a fresh create under the same outbox row.
 */
export async function probeErpByAnchorKey(
  deps: ErpProbeDeps,
  idempotencyKey: string,
): Promise<{ externalRecordId: string; canonical: PmoRecord } | null> {
  // Luna BLOCK 1: when the caller supplies cross-domain discriminator filters (Payment Entry
  // payment_type + party_type), conjoin them with the anchor `like` filter so the anchor-candidate
  // list never returns a doc of the wrong payment_type. PI/Purchase Receipt leave
  // `anchorExtraFilters` unset → the query is byte-for-byte the anchor-only `like` filter.
  const extra = deps.anchorExtraFilters ?? [];
  const names =
    extra.length > 0
      ? await listDocNamesByFilters(deps.client, deps.doctype, [[deps.anchorField, 'like', `%${idempotencyKey}%`], ...extra], 1)
      : await listDocNamesByAnchor(deps.client, deps.doctype, deps.anchorField, idempotencyKey, 1);
  if (names.length === 0) return null;
  const name = names[0];
  const doc = await getDoc(deps.client, deps.doctype, name);
  // Defense-in-depth (Luna BLOCK 1): even if the server-side filter leaked a wrong-type candidate,
  // refuse to adopt a fetched doc the caller's validator rejects (a Receive probe must not adopt a
  // Pay doc, and vice-versa) — return null so the composite conjunction (or hold) decides.
  if (deps.validateAdoptedDoc && !deps.validateAdoptedDoc(doc)) return null;
  return { externalRecordId: name, canonical: { ...deps.fromDoc(doc), id: deps.pmoRecordId } };
}

/** The composite deterministic Payment Entry recovery inputs (C-1 DIRECTOR RULING). All read from our
 *  OWN outbox row payload (persisted at insert) — never from live ERP state — so the sync retry and the
 *  sweep resolve identically. The `paymentType` discriminator (FR-SAR-083, AC-SAR-014) ensures a
 *  PE-receive probe (payment_type='Receive') cannot cross-match a PE-pay (payment_type='Pay') and
 *  vice-versa — they share the same `Payment Entry` doctype but are distinct PMO kinds. */
export interface ErpPaymentCompositeInput {
  partyType: string;
  party: string;
  /** The exact `paid_amount` PMO sent (string or number — compared as an ERP filter value verbatim). */
  paidAmount: string | number;
  /** The referenced Purchase Invoice ERP name(s) PMO's PE cited (matched against the PE `references`
   *  child table, which is NOT server-filterable — so it is matched after `getDoc`). */
  piNames: string[];
  /** The referenced Sales Invoice ERP name(s) for a PE-receive (matched against the PE `references`
   *  child table — same as piNames but for the AR side). */
  siNames: string[];
  /** The claim-window lower bound (ERP `creation >=`) — a doc created before our command began cannot
   *  be ours. Bounds the candidate set to this idempotency attempt's window. */
  createdAfter: string;
  /** C-1 / FR-SAR-083 discriminator: `Pay` for a PE-pay (procurement), `Receive` for a PE-receive
   *  (revenue). A Receive probe MUST NOT match a Pay doc and vice-versa. */
  paymentType: 'Pay' | 'Receive';
}

/**
 * C-1 DIRECTOR RULING — the COMPOSITE DETERMINISTIC Payment Entry recovery probe (ADR-0058 §4 amended).
 * A Payment Entry's anchor (`reference_no`) is MUTABLE — an accountant can edit it after commit — so the
 * anchor `like` filter alone can miss a genuinely-landed PE (and a miss would otherwise trigger a
 * double-pay reissue). This probe adopts a landed PE when EITHER the `reference_no` anchor carries the
 * key OR the deterministic conjunction (party_type + party + exact paid_amount + a `references` row
 * citing the same Purchase Invoice + creation within the claim window) uniquely identifies one — every
 * value sourced from our own outbox payload. A non-unique conjunction match returns `null` (absence is
 * inconclusive → the dispatch HOLDS the row, never reissues). Stock-REST-only.
 */
export async function probeErpByPaymentComposite(
  deps: ErpProbeDeps,
  idempotencyKey: string,
  input: ErpPaymentCompositeInput,
): Promise<{ externalRecordId: string; canonical: PmoRecord } | null> {
  // 1. The immutable-intent fast path: the anchor (reference_no) still carries the key. Luna BLOCK 1:
  //    conjoin the anchor `like` with payment_type + party_type discriminators (and re-validate the
  //    fetched doc) so a Receive probe can never adopt a Pay doc (and vice-versa) via a colliding
  //    reference_no — cross-domain corruption guard.
  // Backwards-compat: default to 'Pay' (procurement PE) and empty siNames for old callers.
  const paymentType = input.paymentType ?? 'Pay';
  const piNames = input.piNames ?? [];
  const siNames = input.siNames ?? [];
  const anchorDeps: ErpProbeDeps = {
    ...deps,
    anchorExtraFilters: [
      ['payment_type', '=', paymentType],
      ['party_type', '=', input.partyType],
    ],
    validateAdoptedDoc: (doc) => {
      const d = doc as { payment_type?: unknown; party_type?: unknown };
      return d.payment_type === paymentType && d.party_type === input.partyType;
    },
  };
  const anchorHit = await probeErpByAnchorKey(anchorDeps, idempotencyKey);
  if (anchorHit) return anchorHit;

  // 2. The composite conjunction on server-filterable columns (references is matched after getDoc).
  const filters: Array<[string, string, string | number]> = [
    ['party_type', '=', input.partyType],
    ['party', '=', input.party],
    ['paid_amount', '=', input.paidAmount],
    ['creation', '>=', input.createdAfter],
    ['payment_type', '=', paymentType], // FR-SAR-083: discriminates Pay vs Receive
    ['docstatus', '<', 2], // exclude cancelled — a cancelled PE is not a live duplicate
  ];
  const names = await listDocNamesByFilters(deps.client, deps.doctype, filters, 20);
  const matches: Array<{ name: string; doc: unknown }> = [];
  for (const name of names) {
    const doc = await getDoc(deps.client, deps.doctype, name);
    const references = (doc as { references?: Array<{ reference_name?: unknown }> }).references ?? [];
    // Match against piNames (PE-pay) OR siNames (PE-receive) — the input carries the correct array
    // based on paymentType, so a PE-receive probe never cross-matches a PE-pay doc.
    if (references.some((r) => piNames.includes(String(r.reference_name)) || siNames.includes(String(r.reference_name)))) {
      matches.push({ name, doc });
    }
  }
  // Deterministic: adopt ONLY a unique match. 0 ⇒ inconclusive absence (hold, never reissue); >1 ⇒
  // ambiguous (also inconclusive — an operator must disambiguate rather than risk adopting the wrong doc).
  if (matches.length !== 1) return null;
  return { externalRecordId: matches[0].name, canonical: { ...deps.fromDoc(matches[0].doc), id: deps.pmoRecordId } };
}
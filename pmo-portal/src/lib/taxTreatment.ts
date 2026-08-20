/**
 * taxTreatment — the tax-basis vocabulary shared by EVERY surface that asks "does this money
 * figure already include its tax?".
 *
 * Promoted here from `pages/procurement/vendorInvoiceTax.ts` (#505) when #513 gave `projects`
 * the same four columns. The options list, the empty-state placeholder and the parse/validate
 * predicate are DOMAIN-NEUTRAL — they encode migration 0196/0197's shared CHECK constraint
 * (`tax_treatment in ('inclusive','exclusive')`) and nothing about invoices or projects. The
 * vendor-invoice module keeps its own copy-that-is-not-a-copy (it re-exports these) plus the
 * genuinely procurement-specific parts: `taxIsPmoAuthored`, `ERP_AUTHORED_TAX` and the
 * invoice-worded required hint.
 *
 * ⛔ There is deliberately NO default treatment exported from this module, and none may ever be
 * added. `tax_treatment` carries no DB default precisely because a defaulted marker is a WRONG
 * value indistinguishable from a deliberate one — the user must choose, so a select starts empty
 * and submit stays blocked until they answer.
 */
import type { TaxTreatment } from '@/src/lib/db/procurementLifecycle';
import { parseMoneyInput } from '@/src/lib/format';

/**
 * The two-value domain, phrased as the question the user is actually answering. The DB CHECK is
 * `tax_treatment in ('inclusive','exclusive')` — these values are that domain verbatim.
 */
export const TAX_TREATMENT_OPTIONS: { value: TaxTreatment; label: string }[] = [
  { value: 'inclusive', label: 'Inclusive — the amount already includes tax' },
  { value: 'exclusive', label: 'Exclusive — tax is on top of the amount' },
];

/** Placeholder for the empty (nothing-chosen-yet) state of the treatment select. */
export const TAX_TREATMENT_PLACEHOLDER = '— choose —';

/** The parsed, write-ready tax facts. */
export interface ParsedTaxFacts {
  taxTreatment: TaxTreatment;
  taxAmount: number;
}

/**
 * Parses the two raw form values, returning null when the form is NOT yet submittable.
 *
 * Rejects: an unchosen (or out-of-domain) treatment; a blank, non-numeric, negative or non-finite
 * tax amount. `0` is explicitly VALID — it is the "no tax" answer, and 0 never means "unknown"
 * (0196/0197's column comments). Callers use `parseTaxFacts(...) === null` as the submit-disabled
 * predicate AND as the guard at submit time, so the two can never disagree.
 *
 * The amount goes through `parseMoneyInput` — "the single parse used for BOTH validation and
 * persistence" (format.ts) — rather than a local `Number()` parse, so this field can never diverge
 * from every other money field in the app (the #468 locale defect is fixed once, in format.ts, and
 * is not re-introduced here).
 */
export function parseTaxFacts(treatmentRaw: string, amountRaw: string): ParsedTaxFacts | null {
  // ⚑ TRIMMED, because everything else on this path is: the importer trims, the RPCs `btrim`, and
  // the DB CHECK is exact. An untrimmed match here made `' exclusive '` acceptable to the importer
  // and the RPC but not to this predicate — three postures for one domain value, in the module whose
  // whole job is that there is only one.
  const treatment = TAX_TREATMENT_OPTIONS.find((o) => o.value === treatmentRaw.trim())?.value;
  if (!treatment) return null;
  const taxAmount = parseMoneyInput(amountRaw);
  if (taxAmount === null || taxAmount < 0) return null;
  return { taxTreatment: treatment, taxAmount };
}

/**
 * #513: the "why is submit blocked" hint for a CONTRACT VALUE (project) — the sibling of
 * `VI_TAX_REQUIRED_HINT`, worded for the thing it actually gates. Separate strings because the
 * reason differs: an invoice total with no marker is unrecoverable, whereas a contract ceiling
 * with no marker makes the work-order drawdown compare two figures on different bases and
 * UNDER-detect over-commitment (migration 0197's header).
 */
export const CONTRACT_TAX_REQUIRED_HINT =
  'State the tax treatment and the tax amount for this contract value — enter 0 if there is no ' +
  'tax. Without it the work-order drawdown compares this ceiling against order values on an ' +
  'unknown basis.';

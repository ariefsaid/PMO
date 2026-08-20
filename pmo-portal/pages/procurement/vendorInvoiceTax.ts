/**
 * vendorInvoiceTax — the shared tax-field vocabulary for the TWO vendor-invoice capture entry
 * points (#505, migration 0196).
 *
 * `VIInlineCapture` (ProcurementDecisionZone.tsx) and `RecordCaptureForm kind="vendor_invoice"`
 * (RecordCaptureForm.tsx) both render the tax treatment + tax amount controls. The OPTIONS and the
 * PARSE/VALIDATE rule live here so the two paths cannot silently diverge — the same reason the
 * `vi-*` testids are single-sourced in vendorInvoiceTestIds.ts.
 *
 * ⛔ There is deliberately NO default treatment exported from this module. `tax_treatment` is NOT
 * NULL with no DB default precisely because a defaulted marker is a WRONG value indistinguishable
 * from a deliberate one — the user must choose, so the select starts empty and submit stays blocked.
 */
import type { TaxTreatment } from '@/src/lib/db/procurementLifecycle';
import { parseMoneyInput } from '@/src/lib/format';
import { routeDomainWrite } from '@/src/lib/adapterSeam/ownershipCache';

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

/**
 * #505 code-quality follow-up: the "why is submit blocked" hint, shown by both entry points when
 * `parseVendorInvoiceTax(...) === null`. Was a duplicated string literal (kept aligned only by a
 * "⚠ KEEP IN SYNC" code comment) in `VIInlineCapture` (ProcurementDecisionZone.tsx) and
 * `RecordCaptureForm kind="vendor_invoice"` — single-sourced here for the same reason as
 * TAX_TREATMENT_OPTIONS/PLACEHOLDER above, and the `vi-*` testids in vendorInvoiceTestIds.ts.
 */
export const VI_TAX_REQUIRED_HINT =
  'State the tax treatment and the tax amount to record this invoice — enter 0 if there is no ' +
  'tax. Whether the amount already includes tax cannot be worked out afterwards.';

/** The parsed, RPC-ready tax facts. */
export interface ParsedVendorInvoiceTax {
  taxTreatment: TaxTreatment;
  taxAmount: number;
}

/**
 * Parses the two raw form values, returning null when the form is NOT yet submittable.
 *
 * Rejects: an unchosen (or out-of-domain) treatment; a blank, non-numeric, negative or non-finite
 * tax amount. `0` is explicitly VALID — it is the "no tax on this invoice" answer, and 0 never
 * means "unknown" (0196's column comment). Callers use `parseVendorInvoiceTax(...) === null` as the
 * submit-disabled predicate AND as the guard at submit time, so the two can never disagree.
 *
 * The amount goes through `parseMoneyInput` — "the single parse used for BOTH validation and
 * persistence" (format.ts) — rather than a local `Number()` parse, so this field can never diverge
 * from every other money field in the app (the #468 locale defect is fixed once, in format.ts, not
 * re-introduced here).
 */
export function parseVendorInvoiceTax(
  treatmentRaw: string,
  amountRaw: string,
): ParsedVendorInvoiceTax | null {
  const treatment = TAX_TREATMENT_OPTIONS.find((o) => o.value === treatmentRaw)?.value;
  if (!treatment) return null;
  const taxAmount = parseMoneyInput(amountRaw);
  if (taxAmount === null || taxAmount < 0) return null;
  return { taxTreatment: treatment, taxAmount };
}

/**
 * Is the tax treatment PMO's to ask for on this org?
 *
 * ⛔ Only when the procurement domain is PMO-owned. On a flipped (ERPNext-owned) org the ERP computes
 * tax from its own template and OWNS the answer: `upsertInvoiceMirror` writes `tax_treatment =
 * 'inclusive'` as a FACT about the `grand_total` it just set. An earlier round of #505 asked anyway
 * and forwarded the answer on the outbound command — where nothing consumed it (`piToBody` sends
 * `{supplier, items}` only), so the user could state *exclusive / 11,000* and get back a row saying
 * *inclusive / 0*: internally consistent, confidently wrong, unrecoverable. That is this issue's own
 * defect, on the other branch of the same `if`.
 *
 * Asking for a fact and discarding it is worse than not asking, so the forms do not render the
 * controls here. Letting the user CHOOSE the ERPNext tax template on this path is a real feature and
 * is tracked separately (#520) — it is not this omission.
 */
export function taxIsPmoAuthored(): boolean {
  return routeDomainWrite('procurement') !== 'external';
}

/**
 * What the form sends on a FLIPPED org, where `taxIsPmoAuthored()` is false.
 *
 * ⚑ This is the one place in the feature that names a treatment nobody chose, and it is not a
 * default: on this path `repositories.procurement.createInvoice` routes to `dispatchCreate` and these
 * values are dropped before they reach any writer — the row's real marker comes from
 * `upsertInvoiceMirror`. It exists only because `CreateInvoiceInput` makes the fields REQUIRED, which
 * is exactly the compile-time guarantee the native path depends on and must not be weakened to suit
 * this one. `procurement.external.test.ts` asserts the outbound command carries none of these keys —
 * that test is what keeps this from quietly becoming a real value.
 */
export const ERP_AUTHORED_TAX: ParsedVendorInvoiceTax = {
  taxTreatment: 'inclusive',
  taxAmount: 0,
};

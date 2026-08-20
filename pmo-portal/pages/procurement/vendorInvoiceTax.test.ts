/**
 * vendorInvoiceTax — parse/validate contract (#505 code-quality follow-up).
 *
 * `parseVendorInvoiceTax` gates the submit-disabled predicate AND the value actually persisted for
 * a money field with a DB CHECK behind it (`tax_amount >= 0`, `tax_treatment in ('inclusive',
 * 'exclusive')`). Before this file the function had NO test at all — deleting `|| taxAmount < 0`
 * left the suite green.
 */
import { describe, it, expect } from 'vitest';
import { parseVendorInvoiceTax, TAX_TREATMENT_OPTIONS } from './vendorInvoiceTax';

describe('parseVendorInvoiceTax', () => {
  it('rejects a negative amount', () => {
    // Kills: deleting `taxAmount < 0` from the guard (the exact regression the review flagged —
    // today the suite stays green with that clause removed).
    expect(parseVendorInvoiceTax('inclusive', '-1')).toBeNull();
  });

  it('rejects a non-finite amount (NaN via arithmetic string)', () => {
    // Kills: replacing `Number.isFinite(taxAmount)` with `true` / dropping the finite check, and
    // kills reverting `parseMoneyInput` back to a bare `Number()` call (which is NOT what NaN comes
    // from here — `parseMoneyInput` already rejects unparseable strings to `null`, so this proves
    // the `=== null` branch of the guard).
    expect(parseVendorInvoiceTax('inclusive', 'NaN')).toBeNull();
  });

  it('rejects a non-numeric amount', () => {
    // Kills: removing the null-check on the parse result, or swapping `parseMoneyInput` for a
    // lenient parser (e.g. `parseFloat`) that would coerce "abc" to NaN and slip past a weakened
    // `isFinite`-only guard.
    expect(parseVendorInvoiceTax('inclusive', 'abc')).toBeNull();
  });

  it('accepts a thousands-separated amount via parseMoneyInput, not a local parse', () => {
    // Kills: reverting to the local `trim().replace(/,/g,'')` + `Number()` re-implementation this
    // fix replaced — that reimplementation and parseMoneyInput agree on "1,000", so this alone
    // doesn't distinguish them, but it does kill "drop the comma-strip entirely" (which would
    // Number("1,000") -> NaN -> null).
    expect(parseVendorInvoiceTax('inclusive', '1,000')).toEqual({
      taxTreatment: 'inclusive',
      taxAmount: 1000,
    });
  });

  it('accepts "0" as an explicit, valid tax amount', () => {
    // Kills: a `taxAmount === 0` falsy-check bug (e.g. `if (!taxAmount) return null`) that would
    // wrongly reject the deliberate "no tax" answer — 0 must never be conflated with "unknown".
    expect(parseVendorInvoiceTax('inclusive', '0')).toEqual({
      taxTreatment: 'inclusive',
      taxAmount: 0,
    });
  });

  it('rejects a blank amount', () => {
    // Kills: dropping the blank-string guard inside parseMoneyInput / here, which would otherwise
    // let `Number('')` (== 0) silently pass as a valid zero.
    expect(parseVendorInvoiceTax('inclusive', '')).toBeNull();
  });

  it('rejects an unchosen treatment', () => {
    // Kills: removing the treatment lookup / defaulting it (the "no default treatment" rule this
    // module documents) — a falsy or unmatched treatment must block submit.
    expect(parseVendorInvoiceTax('', '100')).toBeNull();
  });

  it('rejects an out-of-domain treatment string', () => {
    // Kills: replacing the `TAX_TREATMENT_OPTIONS.find(...)` domain check with a truthiness check
    // (e.g. `if (!treatmentRaw) return null` alone), which would let an arbitrary string through.
    expect(parseVendorInvoiceTax('nonsense', '100')).toBeNull();
  });

  it.each(TAX_TREATMENT_OPTIONS.map((o) => o.value))(
    'accepts the valid tax-treatment value %s',
    (value) => {
      // Kills: hardcoding a single accepted literal (e.g. always comparing against 'inclusive')
      // instead of checking membership in the full exported domain.
      expect(parseVendorInvoiceTax(value, '50')).toEqual({
        taxTreatment: value,
        taxAmount: 50,
      });
    },
  );
});

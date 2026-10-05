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
 * ⛔ There is deliberately NO default treatment exported from THIS module, and none may ever be
 * added. `tax_treatment` carries no DB default precisely because a defaulted marker is a WRONG
 * value indistinguishable from a deliberate one, and a constant compiled into the bundle is the
 * worst version of that — it would be the same marker for every org, forever, chosen by nobody.
 *
 * ⚑ `OD-TAX-1` (#548) changed WHERE a starting value may come from, not whether one may exist:
 * `organizations.default_tax_treatment` (migration 0207) PRE-SELECTS the control in a form that is
 * composing a NEW row, because an org that quotes exclusive every day should not re-answer the
 * same question daily. It is a per-org setting an Admin chose, it is visible and changeable in the
 * form, and — the rule that matters — it is **never consulted at read time and never used to
 * interpret a stored row**. A stored NULL means "no value to interpret", never "inherit the
 * current default": re-deriving an old figure's basis from today's setting silently re-writes
 * history (#478, unrecoverable). Read it with `useOrgTaxDefault`; label a figure with the row's
 * OWN treatment via `TaxBasisLabel`.
 */
import type { TaxTreatment } from '@/src/lib/db/procurementLifecycle';
import { parseMoneyInputAtScale, parseNeutralMoneyInputAtScale } from '@/src/lib/format';

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
 * The on-screen amount goes through the shared locale-aware scale-2 parser — "the single parse used
 * for BOTH validation and persistence" (format.ts) — rather than a local `Number()` parse. Imports
 * use the separately named neutral parser so viewer preferences cannot change file interpretation.
 */
function parseTaxFactsWith(
  treatmentRaw: string,
  amountRaw: string,
  parseAmount: (raw: string) => number | null,
): ParsedTaxFacts | null {
  // ⚑ TRIMMED, because everything else on this path is: the importer trims, the RPCs `btrim`, and
  // the DB CHECK is exact. An untrimmed match here made `' exclusive '` acceptable to the importer
  // and the RPC but not to this predicate — three postures for one domain value, in the module whose
  // whole job is that there is only one.
  const treatment = TAX_TREATMENT_OPTIONS.find((o) => o.value === treatmentRaw.trim())?.value;
  if (!treatment) return null;
  const taxAmount = parseAmount(amountRaw);
  if (taxAmount === null || taxAmount < 0) return null;
  return { taxTreatment: treatment, taxAmount };
}

/** Parses an on-screen tax amount using the viewer's number convention and scale-2 target. */
export function parseTaxFacts(treatmentRaw: string, amountRaw: string): ParsedTaxFacts | null {
  return parseTaxFactsWith(treatmentRaw, amountRaw, (raw) => parseMoneyInputAtScale(raw, 2));
}

/** Parses neutral imported tax facts using dot decimals regardless of the viewer's locale. */
export function parseNeutralTaxFacts(treatmentRaw: string, amountRaw: string): ParsedTaxFacts | null {
  return parseTaxFactsWith(treatmentRaw, amountRaw, (raw) => parseNeutralMoneyInputAtScale(raw, 2));
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

/**
 * Narrows an unknown (a DB column typed `string | null`, an RPC field, a form draft) to the
 * two-value domain. Anything else — null, '', a value from a future CHECK relaxation — is NOT a
 * treatment, and the caller must render NOTHING rather than guess. Rendering "excl. PPN" for an
 * unknown marker is precisely the confidently-wrong money statement OD-TAX-1 exists to prevent.
 */
export function isTaxTreatment(value: unknown): value is TaxTreatment {
  return value === 'inclusive' || value === 'exclusive';
}

/** Exact authored tax-base ratio: keep 11/12 rather than a rounded decimal or an effective rate. */
export interface TaxBaseFraction {
  numerator: number;
  denominator: number;
}

function isTaxBaseFraction(fraction: TaxBaseFraction): boolean {
  return (
    Number.isInteger(fraction.numerator) &&
    Number.isInteger(fraction.denominator) &&
    fraction.numerator > 0 &&
    fraction.denominator >= fraction.numerator &&
    fraction.denominator <= 2147483647
  );
}

/** A blank fraction means the full price; malformed fractions never silently become 1. */
export function parseTaxBaseFraction(raw = ''): TaxBaseFraction | null {
  if (!raw.trim()) return { numerator: 1, denominator: 1 };
  const match = raw.match(/^\s*(\d+)\s*(?:\/\s*(\d+)\s*)?$/);
  if (!match) return null;
  const fraction = { numerator: Number(match[1]), denominator: Number(match[2] ?? '1') };
  return isTaxBaseFraction(fraction) ? fraction : null;
}

export interface StandaloneTaxAmounts {
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
}

/** Convert an already valid decimal to integer units without floating-point multiplication. */
function decimalUnits(value: number, scale: number): bigint | null {
  const decimal = value.toFixed(scale);
  if (Number(decimal) !== value) return null;
  return BigInt(decimal.replace('.', ''));
}

/**
 * Calculate PMO-authored tax only. ERP money is authoritative and must never pass through this
 * calculator (ADR-0048). Amounts follow the existing numeric(14,2) domain and nominal rates the
 * numeric(6,3) domain; a reduced base changes the ratio, never the nominal rate.
 *
 * Exclusive input is the net price. Inclusive input is the gross ceiling, so tax is extracted
 * with e/(1+e), where e is rate × fraction. Integer arithmetic preserves the exact ratio until
 * one final half-up rounding to cents, matching positive Postgres numeric rounding. Net and gross
 * then use the rounded tax so the displayed components always reconcile with the entered amount.
 */
export function calculateStandaloneTax(
  amount: number,
  treatment: string,
  nominalRate: number,
  fraction: TaxBaseFraction = { numerator: 1, denominator: 1 },
): StandaloneTaxAmounts | null {
  if (
    !Number.isFinite(amount) ||
    amount < 0 ||
    amount >= 1e12 ||
    !Number.isFinite(nominalRate) ||
    nominalRate < 0 ||
    nominalRate > 100 ||
    !isTaxTreatment(treatment) ||
    !isTaxBaseFraction(fraction)
  ) {
    return null;
  }

  const amountCents = decimalUnits(amount, 2);
  const rateThousandths = decimalUnits(nominalRate, 3);
  if (amountCents === null || rateThousandths === null) return null;

  const rateNumerator = rateThousandths * BigInt(fraction.numerator);
  const rateDenominator = 100000n * BigInt(fraction.denominator);
  const taxDenominator =
    treatment === 'inclusive' ? rateDenominator + rateNumerator : rateDenominator;
  const taxNumerator = amountCents * rateNumerator;
  const taxCents = (2n * taxNumerator + taxDenominator) / (2n * taxDenominator);
  const netCents = treatment === 'inclusive' ? amountCents - taxCents : amountCents;
  const grossCents = treatment === 'inclusive' ? amountCents : amountCents + taxCents;
  return {
    netAmount: Number(netCents) / 100,
    taxAmount: Number(taxCents) / 100,
    grossAmount: Number(grossCents) / 100,
  };
}

export interface AuthoredTaxFacts extends ParsedTaxFacts {
  taxRate: number | null;
  taxBaseNumerator: number;
  taxBaseDenominator: number;
}

/** Shared submit predicate: known rates calculate tax; unknown rates keep a stated manual amount. */
export function parseStandaloneTaxFacts(
  treatmentRaw: string,
  taxAmountRaw: string,
  amountRaw: string,
  nominalRateRaw: string,
  fractionRaw: string,
): AuthoredTaxFacts | null {
  const fraction = parseTaxBaseFraction(fractionRaw);
  if (!fraction) return null;
  const treatment = treatmentRaw.trim();
  let facts: ParsedTaxFacts | null;
  let taxRate: number | null = null;
  if (nominalRateRaw.trim()) {
    taxRate = parseMoneyInputAtScale(nominalRateRaw, 3);
    const amount = parseMoneyInputAtScale(amountRaw, 2);
    if (taxRate === null || amount === null || !isTaxTreatment(treatment)) return null;
    const calculation = calculateStandaloneTax(amount, treatment, taxRate, fraction);
    if (!calculation) return null;
    facts = { taxTreatment: treatment, taxAmount: calculation.taxAmount };
  } else {
    facts = parseTaxFacts(treatment, taxAmountRaw);
  }
  return facts ? {
    ...facts, taxRate,
    taxBaseNumerator: fraction.numerator,
    taxBaseDenominator: fraction.denominator,
  } : null;
}

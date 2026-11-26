/** Organisation terminology (#2529): rewrite shipped app copy using the active org's terms. */
import registry from './terms.registry.json' with { type: 'json' };

export const TERM_KEYS = [
  'workOrder', 'project', 'clientSuppliedStock', 'purchaseRequest', 'discipline', 'materialRequest',
  // #2712 expansion
  'billOfQuantities', 'contractItem', 'dailyRevenue', 'acceptedQuantity', 'costVariation', 'deliveryNote',
  'stockCount', 'imprest', 'standIn', 'progressClaim',
  // #2799 reach
  'serviceRequest', 'purchaseOrder', 'dailySiteReport', 'surveyQuantity', 'quantityChangeRequest', 'workOrderTransfer',
  'billingPlan', 'billingStep', 'handoverCertificate', 'stockTransfer', 'stockReceipt', 'stockReturn', 'reservation',
  'crew', 'roster', 'issue', 'checkpoint', 'milestone', 'dailyTarget', 'rootCause', 'safetyRecordType',
  'candidateWorkOrder', 'closeOut', 'workOrderPlan', 'foreman',
] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export const TERM_LOCALES = ['en', 'id'] as const;
export type TermLocale = (typeof TERM_LOCALES)[number];

export interface TermForms {
  singular: string;
  plural: string;
}
/** locale → term → the org's override. Absent = shipped wording. */
export type OrgTerms = Partial<Record<TermLocale, Partial<Record<TermKey, TermForms>>>>;

/** The registry is the one list (#2799): key, shipped forms per language, optional namespace scope, known variant spellings.
 *  The `TERM_KEYS` tuple above stays literal for exhaustive typing; `orgTerms.registry.test.ts` and `check-locale-terms.mjs` fail if it drifts. */
interface RegistryForms { singular: string[]; plural: string[] }
export interface RegistryTerm {
  key: string;
  en: RegistryForms;
  id: RegistryForms;
  scope?: string[];
  variants?: { en: string[]; id: string[] };
}
export const TERM_REGISTRY: readonly RegistryTerm[] = registry.terms;

/** The shipped surface forms each term is written as, per language. The first form is the default shown to an Admin. */
export const SHIPPED_FORMS = { en: {}, id: {} } as Record<TermLocale, Record<TermKey, RegistryForms>>;
/**
 * Terms whose shipped word also appears in unrelated sentences (Bahasa "pengganti" = any replacement) are
 * rewritten only in these i18next namespaces. Text built outside i18next (no namespace) is never rewritten
 * for a scoped term. Terms absent here apply everywhere.
 */
export const TERM_SCOPE: Partial<Record<TermKey, readonly string[]>> = {};
for (const term of TERM_REGISTRY) {
  const key = term.key as TermKey;
  SHIPPED_FORMS.en[key] = term.en;
  SHIPPED_FORMS.id[key] = term.id;
  if (term.scope) TERM_SCOPE[key] = term.scope;
}

/** Human-readable shipped name per term, for the settings screen's defaults. */
export function shippedTerm(locale: TermLocale, key: TermKey): TermForms {
  const f = SHIPPED_FORMS[locale][key];
  return { singular: f.singular[0], plural: f.plural[0] };
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Re-case `replacement` to the shape of `matched`: ALL CAPS, Title Case, Capitalised, or as-is. */
export function matchCase(matched: string, replacement: string): string {
  const letters = matched.replace(/[^\p{L}]/gu, '');
  if (letters.length > 1 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) {
    return replacement.toUpperCase();
  }
  if (/^\p{Lu}/u.test(matched)) {
    const words = matched.split(/\s+/);
    const allTitle = words.length > 1 && words.every((w) => /^\p{Lu}/u.test(w));
    if (allTitle) return replacement.replace(/(^|\s)(\p{L})/gu, (_m, sp: string, c: string) => sp + c.toUpperCase());
    return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }
  return /^\p{Ll}/u.test(matched) ? replacement.charAt(0).toLowerCase() + replacement.slice(1) : replacement;
}

/** A renamed term is used exactly as the Admin typed it. Only a term typed with no capital letter at all has no stated casing,
 *  so it follows the shape of the wording it replaces (sentence start, Title Case, ALL CAPS); typing "SPK" or "Perintah Kerja"
 *  is never re-cased to "sPK" or "perintah Kerja". */
function verbatimOrShaped(matched: string, replacement: string): string {
  return replacement === replacement.toLowerCase() ? matchCase(matched, replacement) : replacement;
}

/**
 * Rewrite the shipped wording of every overridden term in `text`. Pure. Plural forms are matched
 * before singular so "work orders" is not left as "<new> s". Matching is whole-word and
 * case-insensitive; the replacement takes the matched text's case shape.
 */
export type TermNumber = 'singular' | 'plural';
export type TermNumberHints = Partial<Record<TermKey, TermNumber | readonly TermNumber[]>>;
export interface TermRenderContext {
  englishReference?: string;
  cursor?: Partial<Record<TermKey, number>>;
  numberOverrides?: TermNumberHints;
  protect?: (value: string) => string;
  /** The i18next namespace the text came from; scoped terms (TERM_SCOPE) apply only inside their namespaces. */
  namespace?: string;
}

export function applyOrgTerms(text: string, locale: string, terms: OrgTerms, context: TermRenderContext = {}): string {
  const { englishReference, cursor = {}, numberOverrides = {}, protect = (value: string) => value, namespace } = context;
  if (!text) return text;
  const loc: TermLocale = locale.startsWith('id') ? 'id' : 'en';
  const overrides = terms[loc];
  if (!overrides) return text;
  const replacements = new Map<string, { key: TermKey; number: 'singular' | 'plural' }>();
  for (const key of TERM_KEYS) {
    if (!overrides[key]) continue;
    const scope = TERM_SCOPE[key];
    if (scope && (!namespace || !scope.includes(namespace))) continue;
    const shipped = SHIPPED_FORMS[loc][key];
    for (const number of ['plural', 'singular'] as const) {
      for (const form of shipped[number]) {
        const normalized = form.toLowerCase();
        if (!replacements.has(normalized) || (number === 'singular' && shipped.plural.some((plural) => plural.toLowerCase() === normalized))) replacements.set(normalized, { key, number });
      }
    }
  }
  if (!replacements.size) return text;
  const forms = [...replacements.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${forms})(?![\\p{L}\\p{N}])`, 'giu');
  return text.replace(re, (match) => {
    const found = replacements.get(match.toLowerCase())!;
    let number = found.number;
    const override = overrides[found.key]!;
    const numberHint = numberOverrides[found.key];
    if (loc === 'id' && numberHint) {
      const index = cursor[found.key] ?? 0;
      cursor[found.key] = index + 1;
      number = typeof numberHint === 'string' ? numberHint : numberHint[index] ?? numberHint[numberHint.length - 1] ?? 'singular';
    } else if (loc === 'id' && englishReference) {
      const english = SHIPPED_FORMS.en[found.key];
      const englishForms = [...new Set([...english.plural, ...english.singular])].sort((a, b) => b.length - a.length);
      const enRe = new RegExp(`(?<![\\p{L}\\p{N}])(?:${englishForms.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
      const occurrences = [...englishReference.matchAll(enRe)].map((m) => m[0].toLowerCase());
      const index = cursor[found.key] ?? 0;
      cursor[found.key] = index + 1;
      const selected = occurrences[index] ?? (occurrences.length === 1 ? occurrences[0] : undefined);
      number = selected && english.plural.includes(selected) && !english.singular.includes(selected) ? 'plural' : 'singular';
    }
    const lowered = match.toLowerCase();
    const suffix = loc === 'id' && found.key === 'project' && lowered === 'proyeknya' ? 'nya' : '';
    const prefix = loc === 'id' && found.key === 'project' && lowered === 'antarproyek' ? 'antar ' : '';
    return protect(verbatimOrShaped(match, prefix + override[number] + suffix));
  });
}

// ── The active org's overrides (module state, set by the provider) ──────────
let active: OrgTerms = {};
export function setOrgTerms(next: OrgTerms): void {
  active = next;
}
export function getOrgTerms(): OrgTerms {
  return active;
}

/** For exports and any string built outside i18next: the same rewrite, active locale and overrides. */
export function withOrgTerms(text: string, locale: string): string {
  return applyOrgTerms(text, locale, active);
}

/** Rewrite a known English app label using the viewer's selected terminology language. */
export function withEnglishOrgTerms(text: string, locale: string): string {
  const terms = locale.startsWith('id') ? active.id : active.en;
  return applyOrgTerms(text, 'en', { en: terms });
}

/** Validate/normalise a DB row set into the OrgTerms map. Unknown keys/locales are dropped. */
export interface OrgTermRow {
  term_key: string;
  locale: string;
  singular: string;
  plural: string;
}
export function rowsToOrgTerms(rows: OrgTermRow[]): OrgTerms {
  const out: OrgTerms = {};
  for (const r of rows) {
    if (!(TERM_KEYS as readonly string[]).includes(r.term_key)) continue;
    if (!(TERM_LOCALES as readonly string[]).includes(r.locale)) continue;
    const loc = r.locale as TermLocale;
    (out[loc] ??= {})[r.term_key as TermKey] = { singular: r.singular, plural: r.plural };
  }
  return out;
}

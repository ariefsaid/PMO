/**
 * Organisation terminology (#2529). An org Admin renames a FIXED set of PMO terms; every string
 * that reaches the screen through i18next (screens, exports, notifications) is rewritten by the
 * `orgTerms` post-processor registered in `index.ts`. Generic terms stay in code.
 *
 * Mechanism: the catalogues keep the shipped wording. At output time each overridable term's
 * shipped surface forms (per language) are replaced by the org's override, preserving the case
 * shape of the matched text. No catalogue is edited per org.
 */

export const TERM_KEYS = ['workOrder', 'project', 'clientSuppliedStock', 'purchaseRequest', 'discipline'] as const;
export type TermKey = (typeof TERM_KEYS)[number];
export const TERM_LOCALES = ['en', 'id'] as const;
export type TermLocale = (typeof TERM_LOCALES)[number];

export interface TermForms {
  singular: string;
  plural: string;
}
/** locale → term → the org's override. Absent = shipped wording. */
export type OrgTerms = Partial<Record<TermLocale, Partial<Record<TermKey, TermForms>>>>;

/** The shipped surface forms each term is written as, per language. Plural forms first matter. */
export const SHIPPED_FORMS: Record<TermLocale, Record<TermKey, { singular: string[]; plural: string[] }>> = {
  en: {
    workOrder: { singular: ['work order'], plural: ['work orders'] },
    project: { singular: ['project'], plural: ['projects'] },
    clientSuppliedStock: { singular: ['client-supplied stock'], plural: ['client-supplied stock'] },
    purchaseRequest: { singular: ['purchase request'], plural: ['purchase requests'] },
    discipline: { singular: ['discipline'], plural: ['disciplines'] },
  },
  id: {
    workOrder: { singular: ['work order', 'SPK'], plural: ['work order', 'SPK'] },
    project: { singular: ['proyek'], plural: ['proyek'] },
    clientSuppliedStock: { singular: ['stok titipan klien'], plural: ['stok titipan klien'] },
    purchaseRequest: { singular: ['permintaan pembelian'], plural: ['permintaan pembelian'] },
    discipline: { singular: ['disiplin'], plural: ['disiplin'] },
  },
};

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

/**
 * Rewrite the shipped wording of every overridden term in `text`. Pure. Plural forms are matched
 * before singular so "work orders" is not left as "<new> s". Matching is whole-word and
 * case-insensitive; the replacement takes the matched text's case shape.
 */
export function applyOrgTerms(text: string, locale: string, terms: OrgTerms): string {
  if (!text) return text;
  const loc: TermLocale = locale.startsWith('id') ? 'id' : 'en';
  const overrides = terms[loc];
  if (!overrides) return text;
  let out = text;
  for (const key of TERM_KEYS) {
    const o = overrides[key];
    if (!o) continue;
    const shipped = SHIPPED_FORMS[loc][key];
    const pairs: Array<[string, string]> = [
      ...shipped.plural.map((f): [string, string] => [f, o.plural]),
      ...shipped.singular.map((f): [string, string] => [f, o.singular]),
    ];
    // Longest shipped form first; a form already seen (id has one form for both numbers) is kept once.
    const seen = new Set<string>();
    pairs.sort((a, b) => b[0].length - a[0].length);
    for (const [form, replacement] of pairs) {
      if (seen.has(form.toLowerCase())) continue;
      seen.add(form.toLowerCase());
      if (form.toLowerCase() === replacement.toLowerCase()) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(form)}(?![\\p{L}\\p{N}])`, 'giu');
      out = out.replace(re, (m) => matchCase(m, replacement));
    }
  }
  return out;
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

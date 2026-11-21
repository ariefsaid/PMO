/** Organisation terminology (#2529): rewrite shipped app copy using the active org's terms. */

export const TERM_KEYS = [
  'workOrder', 'project', 'clientSuppliedStock', 'purchaseRequest', 'discipline', 'materialRequest',
  // #2712 expansion
  'billOfQuantities', 'contractItem', 'dailyRevenue', 'acceptedQuantity', 'costVariation', 'deliveryNote',
  'stockCount', 'imprest', 'standIn', 'progressClaim',
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

/** The shipped surface forms each term is written as, per language. Plural forms first matter. */
export const SHIPPED_FORMS: Record<TermLocale, Record<TermKey, { singular: string[]; plural: string[] }>> = {
  en: {
    workOrder: { singular: ['work order'], plural: ['work orders'] },
    project: { singular: ['project'], plural: ['projects'] },
    clientSuppliedStock: { singular: ['client-supplied stock'], plural: ['client-supplied stock'] },
    purchaseRequest: { singular: ['purchase request'], plural: ['purchase requests'] },
    discipline: { singular: ['discipline'], plural: ['disciplines'] },
    materialRequest: { singular: ['material request'], plural: ['material requests'] },
    billOfQuantities: { singular: ['bill of quantities'], plural: ['bill of quantities'] },
    contractItem: { singular: ['contract item'], plural: ['contract items'] },
    dailyRevenue: { singular: ['day revenue'], plural: ['day revenue'] },
    acceptedQuantity: { singular: ['accepted quantity'], plural: ['accepted quantities'] },
    costVariation: { singular: ['cost variation'], plural: ['cost variations'] },
    deliveryNote: { singular: ['delivery note'], plural: ['delivery notes'] },
    stockCount: { singular: ['stock count'], plural: ['stock counts'] },
    imprest: { singular: ['imprest'], plural: ['imprests'] },
    standIn: { singular: ['stand-in'], plural: ['stand-ins'] },
    progressClaim: { singular: ['progress claim'], plural: ['progress claims'] },
  },
  id: {
    workOrder: { singular: ['work order', 'SPK', 'Work Order / SPK'], plural: ['work order', 'SPK', 'Work Order / SPK'] },
    project: { singular: ['proyek', 'proyeknya', 'antarproyek'], plural: ['proyek', 'proyeknya', 'antarproyek'] },
    clientSuppliedStock: { singular: ['stok titipan klien'], plural: ['stok titipan klien'] },
    purchaseRequest: { singular: ['permintaan pembelian'], plural: ['permintaan pembelian'] },
    discipline: { singular: ['disiplin'], plural: ['disiplin'] },
    materialRequest: { singular: ['permintaan material'], plural: ['permintaan material'] },
    billOfQuantities: { singular: ['bill of quantities', 'daftar kuantitas'], plural: ['bill of quantities', 'daftar kuantitas'] },
    contractItem: { singular: ['item kontrak'], plural: ['item kontrak'] },
    dailyRevenue: { singular: ['pendapatan hari itu'], plural: ['pendapatan hari itu'] },
    acceptedQuantity: { singular: ['kuantitas yang diterima', 'kuantitas diterima'], plural: ['kuantitas yang diterima', 'kuantitas diterima'] },
    costVariation: { singular: ['variasi biaya'], plural: ['variasi biaya'] },
    deliveryNote: { singular: ['surat jalan'], plural: ['surat jalan'] },
    stockCount: { singular: ['stok opname'], plural: ['stok opname'] },
    imprest: { singular: ['kas lapangan'], plural: ['kas lapangan'] },
    standIn: { singular: ['pengganti'], plural: ['pengganti'] },
    progressClaim: { singular: ['klaim progres'], plural: ['klaim progres'] },
  },
};

/**
 * Terms whose shipped word also appears in unrelated sentences (Bahasa "pengganti" = any replacement) are
 * rewritten only in these i18next namespaces. Text built outside i18next (no namespace) is never rewritten
 * for a scoped term. Terms absent here apply everywhere.
 */
export const TERM_SCOPE: Partial<Record<TermKey, readonly string[]>> = {
  standIn: ['materialRequests'],
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
        if (!replacements.has(normalized) || (loc === 'en' && number === 'singular' && shipped.plural.some((plural) => plural.toLowerCase() === normalized))) replacements.set(normalized, { key, number });
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
    return protect(matchCase(match, prefix + override[number] + suffix));
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

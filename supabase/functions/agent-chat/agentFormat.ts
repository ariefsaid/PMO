/**
 * agentFormat.ts — pure helpers for SERVER-composed agent text (#787, ADR-0079 §3). Leaf module: no imports,
 * so it can never join an import cycle (see readEntities.ts's header for the boot crash that rule prevents).
 */

/** Characters that change meaning inside inline markdown. Escaping them makes user-authored text (a task,
 *  project, person or customer name) render as TEXT — never a link, emphasis, code span or raw HTML. */
const MD_INLINE = /[\\`*_{}[\]()#+!<>|~]/g;

export function escapeMarkdownText(raw: string, max = 200): string {
  return raw.replace(/[\r\n]+/g, ' ').slice(0, max).replace(MD_INLINE, (c) => `\\${c}`);
}

/** Today's calendar date (YYYY-MM-DD) in an IANA zone; an unknown zone falls back to UTC. */
export function isoDateInZone(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Whole days from `fromIso` to `toIso` (both YYYY-MM-DD). */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

/** "2 Oct" — English month words to match the English labels (DD-AIN-7); a date-only value never shifts by zone. */
export function formatShortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${iso}T00:00:00Z`));
}

/** Money in the org's number locale and the record's OWN currency (OD-CR-5) — never converted. */
export function formatMoney(amount: number, currency: string, numberLocale: string): string {
  try {
    return new Intl.NumberFormat(numberLocale, { style: 'currency', currency }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** The org's number locale: its explicit setting, else its UI locale, else en-US (0198: NULL = derive). */
export function resolveNumberLocale(
  org: { default_number_locale?: string | null; default_locale?: string | null } | null,
): string {
  return org?.default_number_locale || org?.default_locale || 'en-US';
}

/** A positive scale-2 money amount below the numeric(14,2) ceiling. */
export function isMoney(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 && n < 1e12 && Number(n.toFixed(2)) === n;
}

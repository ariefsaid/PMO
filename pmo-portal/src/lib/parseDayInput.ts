// Typed-date parser for the shared DateField. Accepts the four shapes people type, day first:
// `16 Nov 2026` (month names in English or Bahasa Indonesia), `16/11/2026`, `16-11-2026`, `2026-11-16`.
// Returns the ISO `yyyy-mm-dd` of a real calendar day, or null. A 4-digit year is required so a half-typed
// year never commits.
import type { Month } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import { id as idLocale } from 'date-fns/locale/id';

const MONTH_NAMES: string[][] = Array.from({ length: 12 }, (_, month) =>
  [...new Set(
    [enUS, idLocale].flatMap((locale) =>
      (['abbreviated', 'wide'] as const).map((width) => locale.localize.month(month as Month, { width }).toLowerCase().replace(/\./g, '')),
    ),
  )],
);

function monthFromName(token: string): number | null {
  const name = token.toLowerCase().replace(/\./g, '');
  if (name.length < 3) return null;
  const index = MONTH_NAMES.findIndex((names) => names.some((n) => n === name || (n.length > name.length && n.startsWith(name))));
  return index < 0 ? null : index + 1;
}

export function toIsoDay(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDayInput(raw: string): string | null {
  const text = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (m) return toIsoDay(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(text);
  if (m) return toIsoDay(+m[3], +m[2], +m[1]);
  m = /^(\d{1,2})[\s-]+([\p{L}.]+)[\s,-]+(\d{4})$/u.exec(text);
  if (m) {
    const month = monthFromName(m[2]);
    return month ? toIsoDay(+m[3], month, +m[1]) : null;
  }
  return null;
}

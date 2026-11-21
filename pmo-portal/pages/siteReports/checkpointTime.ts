import { getActiveLocale, getDateLocale } from '@/src/lib/locale/activeLocale';

/** The viewer's resolved timezone, the clock every checkpoint time on screen is shown in (NFR-STC-004). */
export const checkpointTimeZone = (): string => getActiveLocale().timezone;

/** HH:mm of an instant in the viewer's resolved timezone. */
export function formatCheckpointTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(getDateLocale(), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: checkpointTimeZone() }).format(d);
}

/** The calendar day of an instant in the viewer's resolved timezone, as YYYY-MM-DD. */
export function checkpointToday(now: Date = new Date()): string {
  const p = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: checkpointTimeZone() }).format(now);
  return p;
}

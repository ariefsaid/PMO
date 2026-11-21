import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatCalendarDayInTimeZone, formatInstantTime } from '@/src/lib/format';

/** The viewer's resolved timezone, the clock every checkpoint time on screen is shown in (NFR-STC-004). */
export const checkpointTimeZone = (): string => getActiveLocale().timezone;

/** HH:mm of an instant in the viewer's resolved timezone. */
export const formatCheckpointTime = (iso: string | null | undefined): string => formatInstantTime(iso);

/** The calendar day of an instant in the viewer's resolved timezone, as YYYY-MM-DD. */
export const checkpointToday = (now: Date = new Date()): string => formatCalendarDayInTimeZone(now, checkpointTimeZone());

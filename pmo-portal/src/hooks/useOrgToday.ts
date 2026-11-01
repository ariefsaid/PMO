import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatCalendarDayInTimeZone } from '@/src/lib/format';

/** Today as 'YYYY-MM-DD' in the active org/user timezone (format.ts formatCalendarDayInTimeZone). */
export function useOrgToday(): string {
  return formatCalendarDayInTimeZone(new Date(), getActiveLocale().timezone);
}

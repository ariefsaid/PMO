import { useEffect, useState } from 'react';
import { getActiveLocale } from '@/src/lib/locale/activeLocale';
import { formatCalendarDayInTimeZone, zonedDatetimeLocalToInstant } from '@/src/lib/format';

/**
 * Today as 'YYYY-MM-DD' in an explicitly chosen organization or profile business timezone.
 * Refreshes reactively when midnight rolls over without requiring a page refresh.
 */
export function useOrgToday(explicitTimezone?: string): string {
  const timezone = explicitTimezone ?? getActiveLocale().timezone;
  const [today, setToday] = useState(() => formatCalendarDayInTimeZone(new Date(), timezone));

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    function schedule() {
      const now = new Date();
      const current = formatCalendarDayInTimeZone(now, timezone);
      setToday(current);

      const [yearStr, monthStr, dayStr] = current.split('-');
      const year = Number(yearStr);
      const month = Number(monthStr);
      const day = Number(dayStr);
      const nextDayDate = new Date(Date.UTC(year, month - 1, day + 1));
      const nextDayStr = nextDayDate.toISOString().slice(0, 10);

      const nextMidnight = zonedDatetimeLocalToInstant(`${nextDayStr}T00:00:00`, timezone);
      const msUntilMidnight = nextMidnight ? nextMidnight.getTime() - Date.now() : 86_400_000;
      const delay = Math.max(100, Math.min(msUntilMidnight + 50, 86_400_000));

      timer = setTimeout(schedule, delay);
    }

    schedule();

    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [timezone]);

  return today;
}

import { useEffect, useState, useSyncExternalStore } from 'react';
import { getActiveOrgTimezone, subscribeActiveOrgTimezone } from '@/src/lib/locale/activeLocale';
import { firstInstantOfZonedCalendarDay, formatCalendarDayInTimeZone } from '@/src/lib/format';

/** The organisation's day now, for non-hook callers (default args, pure helpers). Never the browser's or the person's own day. */
export function orgDayNow(): string {
  return formatCalendarDayInTimeZone(new Date(), getActiveOrgTimezone());
}

/** The organisation's day now as a local-midnight Date, for code that cuts a month or week out of a Date. */
export function orgDayDate(): Date {
  const [y, m, d] = orgDayNow().split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Today as 'YYYY-MM-DD' in the organisation's business timezone (UTC when unset, as the server's
 * `native_org_today`). Refreshes when the organisation's midnight rolls over.
 */
export function useOrgToday(explicitTimezone?: string): string {
  const orgTimezone = useSyncExternalStore(subscribeActiveOrgTimezone, getActiveOrgTimezone);
  const timezone = explicitTimezone ?? orgTimezone;
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

      // First real instant of the next day: midnight may be skipped by a DST change.
      const nextMidnight = firstInstantOfZonedCalendarDay(nextDayStr, timezone);
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

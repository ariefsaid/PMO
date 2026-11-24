import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns/format';
import { startOfWeek } from 'date-fns/startOfWeek';
import type { TimesheetForReview, TimesheetReviewFilters, TimesheetWithEntries } from '@/src/lib/db/timesheets';
import { repositories } from '@/src/lib/repositories';
import { addDays } from '@/src/lib/reports/months';
import { useAuth } from '@/src/auth/useAuth';

/** Weeks of history read up front, and added each time the stepper goes past the window. */
const WINDOW_WEEKS = 12;
const mondayISO = (d: Date) => format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd');

/**
 * Org+user-scoped timesheet list. queryKey includes org_id + user id so cache is tenant- and
 * user-scoped (FR-QRY-TS-001). Fetches only the signed-in user's own rows.
 *
 * Without `windowWeek` it is the FULL history (dashboards read recent entries across all weeks).
 * With `windowWeek` (the Monday ISO of the week on screen) it reads only a window of weeks —
 * `WINDOW_WEEKS` before the current week — and, when that week or its predecessor ("copy last week")
 * falls before the window, widens it by another `WINDOW_WEEKS` and fetches again. The widened window
 * is its own query (pending until it lands), so a week never renders as empty because it was not
 * loaded yet; the floor only moves back, so stepping forward again reuses the loaded range. Every
 * windowed key sits under ['timesheets', org, user], so existing invalidations refresh all of them.
 */
export function useTimesheets(enabled = true, windowWeek?: string, windowWeeks: number = WINDOW_WEEKS) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  const [floor, setFloor] = useState(() => addDays(mondayISO(new Date()), -7 * windowWeeks));
  // `windowWeeks` narrows the window (the landing page shows a few weeks, not the history); a call that passes
  // it without `windowWeek` is windowed from the floor.
  let fromWeek: string | undefined = windowWeek || windowWeeks !== WINDOW_WEEKS ? floor : undefined;
  if (windowWeek) {
    const needed = addDays(windowWeek, -7);
    fromWeek = needed < floor ? addDays(needed, -7 * windowWeeks) : floor;
    if (fromWeek !== floor) setFloor(fromWeek);
  }
  return useQuery<TimesheetWithEntries[]>({
    queryKey: fromWeek ? ['timesheets', orgId, userId, 'from', fromWeek] : ['timesheets', orgId, userId],
    queryFn: () => (fromWeek
      ? repositories.timesheet.list(userId as string, { fromWeek })
      : repositories.timesheet.list(userId as string)),
    enabled: enabled && Boolean(orgId && userId),
  });
}

/** 1124d-rolescreens: org-scoped read-only timesheet review query (RLS scopes to HR Officer / Admin). */
export function useTimesheetsForReview(filters?: TimesheetReviewFilters, enabled = true) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const userId = currentUser?.id;
  return useQuery<TimesheetForReview[]>({
    queryKey: ['timesheets', 'review', orgId, userId, filters ?? null],
    queryFn: () => repositories.timesheet.listForReview(filters),
    enabled: enabled && Boolean(orgId && userId),
  });
}

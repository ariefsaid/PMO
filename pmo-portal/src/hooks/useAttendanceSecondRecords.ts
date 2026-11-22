import { useMutation, useQueryClient } from '@tanstack/react-query';
import { attendanceSecondRecordRepository as repo, type AttendanceTimeRoles, type DecideInput, type SecondRecordInput } from '@/src/lib/repositories/attendanceSecondRecords';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';
import { useAuth } from '@/src/auth/useAuth';

/** Second records of a worker's day and the two role settings (pay-time), over the repository seam. Keys carry org_id. */
export const REPORT_DAY_HOURS_KEY = 'attendance-report-day-hours';
export const TIME_ROLES_KEY = 'attendance-time-roles';

/** The per-worker hours of a site report's day. Only people who record or decide time get rows (the database says who). */
export function useReportDayHours(reportId: string | undefined) {
  return useOrgQuery([REPORT_DAY_HOURS_KEY, reportId], () => repo.reportDayHours(reportId as string), { enabled: Boolean(reportId), staleness: 'live' });
}

/** A second record or a decision changes the standing hours, so the report's own total refreshes too. */
export function useSecondRecordMutations() {
  const qc = useQueryClient();
  const orgId = useAuth().currentUser?.org_id;
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: [REPORT_DAY_HOURS_KEY] }),
    qc.invalidateQueries({ queryKey: ['daily-site-reports', orgId] }),
  ]);
  return {
    enter: useMutation({
      mutationFn: (v: { workOrderId: string; workDate: string; rows: SecondRecordInput[] }) => repo.enter(v.workOrderId, v.workDate, v.rows),
      onSuccess: refresh,
    }),
    decide: useMutation({ mutationFn: (input: DecideInput) => repo.decide(input), onSuccess: refresh }),
  };
}

export function useAttendanceTimeRoles() {
  return useOrgQuery([TIME_ROLES_KEY], () => repo.timeRoles(), { staleness: 'session' });
}

export function useSaveAttendanceTimeRoles() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (roles: AttendanceTimeRoles) => repo.saveTimeRoles(roles),
    onSuccess: () => qc.invalidateQueries({ queryKey: [TIME_ROLES_KEY] }),
  });
}

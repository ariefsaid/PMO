import { useMutation, useQueryClient } from '@tanstack/react-query';
import { attendanceRateRepository } from '@/src/lib/repositories/crews';
import { useOrgId } from '@/src/hooks/useOrgId';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/**
 * #2706 — the organisation's attendance target and the per-crew rate against it. Keys carry the org id (tenant
 * scope). A target change invalidates the report, because whether the rate view is offered at all depends on it.
 */
export const ATTENDANCE_TARGET_KEY = 'attendance-target';
export const ATTENDANCE_RATE_KEY = 'attendance-rate';

export function useAttendanceTarget() {
  return useOrgQuery([ATTENDANCE_TARGET_KEY], () => attendanceRateRepository.target(), { staleness: 'session' });
}

export function useAttendanceRate(from: string | null, to: string | null) {
  return useOrgQuery(
    [ATTENDANCE_RATE_KEY, from, to],
    () => attendanceRateRepository.byCrew(from as string, to as string),
    { enabled: Boolean(from && to) },
  );
}

export function useSetAttendanceTarget() {
  const orgId = useOrgId();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (value: number | null) => attendanceRateRepository.setTarget(value),
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: [ATTENDANCE_TARGET_KEY, orgId] }),
        qc.invalidateQueries({ queryKey: [ATTENDANCE_RATE_KEY] }),
      ]);
    },
  });
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { attendanceRateRepository } from '@/src/lib/repositories/crews';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';

/**
 * #2706 — the organisation's attendance target and the per-crew rate against it. Keys carry the org id (tenant
 * scope). A target change invalidates the report, because whether the rate view is offered at all depends on it.
 */
export const ATTENDANCE_TARGET_KEY = 'attendance-target';
export const ATTENDANCE_RATE_KEY = 'attendance-rate';

export function useAttendanceTarget() {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery<number | null>({
    queryKey: [ATTENDANCE_TARGET_KEY, orgId],
    queryFn: () => attendanceRateRepository.target(),
    enabled: Boolean(orgId),
    ...SESSION_QUERY_OPTIONS,
  });
}

export function useAttendanceRate(from: string | null, to: string | null) {
  const orgId = useAuth().currentUser?.org_id;
  return useQuery({
    queryKey: [ATTENDANCE_RATE_KEY, orgId, from, to],
    queryFn: () => attendanceRateRepository.byCrew(from as string, to as string),
    enabled: Boolean(orgId && from && to),
  });
}

export function useSetAttendanceTarget() {
  const orgId = useAuth().currentUser?.org_id;
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

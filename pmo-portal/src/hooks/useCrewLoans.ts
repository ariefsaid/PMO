import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { crewLoanRepository, type CrewLoanInput } from '@/src/lib/repositories/crews';
import { ATTENDANCE_QUERY_ROOTS, CREW_QUERY_ROOTS } from '@/src/hooks/useCrews';

/** Crew loans (#2704) over the repository seam. Keys carry org_id (tenant scope). */
export const CREW_LOANS_ENABLED_KEY = 'crew-loans-enabled';

const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;

/** Whether the organisation shows crew loans (the setting, default off). */
export function useCrewLoansEnabled() {
  const orgId = useOrgId();
  return useQuery({
    queryKey: [CREW_LOANS_ENABLED_KEY, orgId], queryFn: () => crewLoanRepository.enabled(), enabled: Boolean(orgId), ...SESSION_QUERY_OPTIONS,
  });
}

export function useCrewLoans(enabled: boolean) {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['crew-loans', orgId], queryFn: () => crewLoanRepository.list(), enabled: Boolean(orgId) && enabled });
}

/** A loan changes who the roster and attendance list, so every crew, roster and attendance read refreshes. */
export function useCrewLoanMutations() {
  const qc = useQueryClient();
  const after = {
    onSuccess: () => {
      void Promise.all([...CREW_QUERY_ROOTS, ...ATTENDANCE_QUERY_ROOTS, 'crew-loans'].map((r) => qc.invalidateQueries({ queryKey: [r] })));
    },
  };
  return {
    lend: useMutation({ mutationFn: (input: CrewLoanInput) => crewLoanRepository.create(input), ...after }),
    endLoan: useMutation({
      mutationFn: (v: { id: string; version: number; valid_from: string; valid_to: string }) =>
        crewLoanRepository.correct(v.id, v.version, { valid_from: v.valid_from, valid_to: v.valid_to }),
      ...after,
    }),
  };
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { crewLoanRepository, type CrewLoanInput } from '@/src/lib/repositories/crews';
import { ATTENDANCE_QUERY_ROOTS, CREW_QUERY_ROOTS } from '@/src/hooks/useCrews';
import { useOrgQuery } from '@/src/hooks/useOrgQuery';

/** Crew loans (#2704) over the repository seam. Keys carry org_id (tenant scope). */

export function useCrewLoans(enabled: boolean) {
  return useOrgQuery(['crew-loans'], () => crewLoanRepository.list(), { enabled });
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

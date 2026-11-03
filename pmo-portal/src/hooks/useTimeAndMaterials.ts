import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type {
  AssembleTmClaimInput, ContractRateLineInput, EndRateAssigneeInput, EndRateLineInput, PrepareTmSignoffInput,
  RateAssigneeInput, TmClaimPreviewInput,
} from '@/src/lib/db/timeAndMaterials';

/**
 * Time-and-materials data layer (#1514 T7) over the repository seam (ADR-0017). Keys carry org_id (tenant scope) and
 * every argument they were fetched with, so one project's rate card can never be served for another.
 *
 * Cache design: EVERY write — a rate, an assignment, an assembly, a deselect, a prepare, a withdraw, a confirm —
 * invalidates EVERY T&M read AND `project-finances`. A sign-off creates the claim record (0517) and the rate card prices
 * every later claim, so all of it moves what a project's money says, and the T&M screen sits beside the finances panel.
 * Invalidate on success only: a refused confirm (separation of duties, a stale fingerprint, a non-approved hour) must
 * leave the cache exactly as it was.
 */
export const TM_QUERY_ROOTS = ['tm-rate-lines', 'tm-rate-assignees', 'tm-claims', 'tm-claim-preview',
  'tm-claim-sources'] as const;
/** `useProjectFinances` exports no root constant, so the literal first key segment is the prefix we invalidate. */
const PROJECT_FINANCES_ROOT = 'project-finances';

const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;
/** An empty range is not a range: the RPC refuses `p_to < p_from` with 22023, so do not ask. */
const rangeIsValid = (from: string, to: string): boolean => Boolean(from && to && to >= from);

export function useTmRateLines(projectId: string, includeHistory = false) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['tm-rate-lines', orgId, projectId, includeHistory],
    queryFn: () => repositories.timeAndMaterials.listRateLines(projectId, { includeHistory }),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

export function useTmRateAssignees(projectId: string) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['tm-rate-assignees', orgId, projectId],
    queryFn: () => repositories.timeAndMaterials.listRateAssignees(projectId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

export function useTmClaims(projectId: string) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['tm-claims', orgId, projectId],
    queryFn: () => repositories.timeAndMaterials.listTmClaims(projectId),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

/** The priced preview of a range plus its unrated groups. A stable read (writes nothing), so it is a query. */
export function useTmClaimPreview(range: TmClaimPreviewInput) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['tm-claim-preview', orgId, range.projectId, range.from, range.to],
    queryFn: () => repositories.timeAndMaterials.previewTmClaim(range),
    enabled: Boolean(orgId) && Boolean(range.projectId) && rangeIsValid(range.from, range.to),
  });
}

/** The sources behind one claim's lines (the detail drill-down). */
export function useTmClaimSources(claimId: string) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['tm-claim-sources', orgId, claimId],
    queryFn: () => repositories.timeAndMaterials.listTmClaimSources(claimId),
    enabled: Boolean(orgId) && Boolean(claimId),
  });
}

function useTmMutation<A, R>(fn: (arg: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const root of [...TM_QUERY_ROOTS, PROJECT_FINANCES_ROOT]) void qc.invalidateQueries({ queryKey: [root] });
    },
  });
}

export const useSaveTmRateLine = () => useTmMutation((input: ContractRateLineInput) => repositories.timeAndMaterials.saveContractRateLine(input));
export const useEndTmRateLine = () => useTmMutation((input: EndRateLineInput) => repositories.timeAndMaterials.endContractRateLine(input));
export const useSetTmRateAssignee = () => useTmMutation((input: RateAssigneeInput) => repositories.timeAndMaterials.setContractRateAssignee(input));
export const useEndTmRateAssignee = () => useTmMutation((input: EndRateAssigneeInput) => repositories.timeAndMaterials.endContractRateAssignee(input));
export const useAssembleTmClaim = () => useTmMutation((input: AssembleTmClaimInput) => repositories.timeAndMaterials.assembleTmClaim(input));
/** `claimSourceId` is the `tm_claim_sources` row id (0516 matches `s.id`), not the timesheet entry's `source_id`. */
export const useDeselectTmSource = () =>
  useTmMutation((arg: { claimId: string; claimSourceId: string }) =>
    repositories.timeAndMaterials.deselectTmSource(arg.claimId, arg.claimSourceId));
export const usePrepareTmSignoff = () => useTmMutation((input: PrepareTmSignoffInput) => repositories.timeAndMaterials.prepareTmSignoff(input));
export const useWithdrawTmSignoff = () => useTmMutation((claimId: string) => repositories.timeAndMaterials.withdrawTmSignoff(claimId));
export const useConfirmTmSignoff = () => useTmMutation((claimId: string) => repositories.timeAndMaterials.confirmTmSignoff(claimId));

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useOrgId } from '@/src/hooks/useOrgId';
import type { BudgetCategory } from '@/src/lib/db/imprest';
import { EXPENSE_QUERY_ROOTS } from './useExpenseClaims';
import { expenseClaimsAwaitingKey } from './approvalsQueryKeys';

/** Site imprest (#1515) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
export const IMPREST_QUERY_ROOTS = ['imprest-floats', 'imprest-float', 'imprest-position', 'imprest-plan-usage', 'imprest-open-requests', 'imprest-plans',
  'imprest-replenishments', 'imprest-counts', 'imprest-float-choices', 'imprest-float-claims', 'imprest-limit', 'imprest-awaiting', 'imprest-float-changes', 'imprest-posting-states'] as const;


export function useImprestFloats() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['imprest-floats', orgId], queryFn: () => repositories.imprest.listFloats(), enabled: Boolean(orgId) });
}
/** One numbered page of the Site cash list (#843), plus the server count for "Showing 1–50 of 205". The previous page stays on screen while the next loads. */
export function useImprestFloatPages(page = 1) {
  const orgId = useOrgId();
  const pages = useQuery({
    queryKey: ['imprest-floats', orgId, 'pages', page],
    queryFn: () => repositories.imprest.listFloats(page),
    placeholderData: keepPreviousData,
    enabled: Boolean(orgId),
  });
  const count = useQuery({
    queryKey: ['imprest-floats', orgId, 'count'],
    queryFn: async () => {
      try {
        return await repositories.imprest.countFloats();
      } catch {
        return undefined;
      }
    },
    enabled: Boolean(orgId),
  });
  return { ...pages, total: count.data };
}
/** One float by id (a record page must not search the capped list). Its own root (`imprest-float`, listed in IMPREST_QUERY_ROOTS) so every write refreshes it; the shell crumb reads the same key. */
export function useImprestFloat(floatId: string | null | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-float', orgId, floatId],
    queryFn: () => repositories.imprest.getFloat(floatId as string),
    enabled: Boolean(orgId) && Boolean(floatId),
  });
}
export function useImprestPosition(floatId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-position', orgId, floatId],
    queryFn: () => repositories.imprest.getPosition(floatId as string),
    enabled: Boolean(orgId) && Boolean(floatId),
  });
}
export function useImprestPostingStates(floatId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-posting-states', orgId, floatId],
    queryFn: () => repositories.imprest.listPostingStates(floatId as string),
    enabled: Boolean(orgId) && Boolean(floatId),
  });
}
export function useImprestPlans(floatId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-plans', orgId, floatId],
    queryFn: () => repositories.imprest.listPlans(floatId as string),
    enabled: Boolean(orgId) && Boolean(floatId),
  });
}
export function useImprestPlanLines(planId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-plans', orgId, 'lines', planId],
    queryFn: () => repositories.imprest.listPlanLines(planId as string),
    enabled: Boolean(orgId) && Boolean(planId),
  });
}
/** The open purchase requests of the float's project: a read-only suggestion beside the plan. */
export function useImprestOpenRequests(floatId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-open-requests', orgId, floatId],
    queryFn: () => repositories.imprest.getOpenRequests(floatId as string),
    enabled: Boolean(orgId) && Boolean(floatId),
  });
}
export function useImprestReplenishments(floatId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-replenishments', orgId, floatId],
    queryFn: () => repositories.imprest.listReplenishments(floatId as string),
    enabled: Boolean(orgId) && Boolean(floatId),
  });
}
export function useImprestFloatChanges(floatId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-float-changes', orgId, floatId],
    queryFn: () => repositories.imprest.listFloatChanges(floatId as string),
    enabled: Boolean(orgId) && Boolean(floatId),
  });
}
export function useImprestCounts(floatId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-counts', orgId, floatId],
    queryFn: () => repositories.imprest.listCounts(floatId as string),
    enabled: Boolean(orgId) && Boolean(floatId),
  });
}
export function useImprestFloatClaims(floatId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-float-claims', orgId, floatId],
    queryFn: () => repositories.imprest.listFloatClaims(floatId as string),
    enabled: Boolean(orgId) && Boolean(floatId),
  });
}
export function useImprestAwaiting() {
  const orgId = useOrgId();
  const query = useQuery({ queryKey: ['imprest-awaiting', orgId], queryFn: () => repositories.imprest.listAwaitingImprest(), enabled: Boolean(orgId) });
  return { ...query, enabled: Boolean(orgId) };
}
export function useImprestProcurementLimit() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['imprest-limit', orgId], queryFn: () => repositories.imprest.getProcurementLimit(), enabled: Boolean(orgId) });
}
export function useImprestFloatChoices(projectId: string | undefined, category: BudgetCategory | null) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-float-choices', orgId, projectId, category],
    queryFn: () => repositories.imprest.floatChoices(projectId as string, category),
    enabled: Boolean(orgId) && Boolean(projectId),
  });
}

/** Every write refreshes every imprest read plus the expense reads and the approvals inbox: one set of facts on screens
 *  that sit side by side (a float record's pay moves the position; a replenishment moves the receipts). */
function useImprestMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const root of [...IMPREST_QUERY_ROOTS, ...EXPENSE_QUERY_ROOTS, expenseClaimsAwaitingKey(undefined)[0]]) {
        void qc.invalidateQueries({ queryKey: [root] });
      }
    },
  });
}

type Repo = typeof repositories.imprest;
type Transition = Parameters<Repo['transitionReplenishment']>;
export const useCreatePlan = () => useImprestMutation((a: { floatId: string; month: string }) => repositories.imprest.createPlan(a.floatId, a.month));
export const useSavePlanLine = () => useImprestMutation((a: { planId: string; category: BudgetCategory; amount: number }) =>
  repositories.imprest.savePlanLine(a.planId, a.category, a.amount));
export const useDeletePlanLine = () => useImprestMutation((lineId: string) => repositories.imprest.deletePlanLine(lineId));
export const useSetProcurementLimit = () => useImprestMutation((amount: number) => repositories.imprest.setProcurementLimit(amount));
export const useEstablishFloat = () => useImprestMutation((a: { projectId: string; custodianId: string; amount: number }) =>
  repositories.imprest.establishFloat(a.projectId, a.custodianId, a.amount));
export const useProposeFloatAmount = () => useImprestMutation((a: { floatId: string; amount: number }) =>
  repositories.imprest.proposeFloatAmount(a.floatId, a.amount));
export const useDecideFloatChange = () => useImprestMutation((a: { changeId: string; approve: boolean; notes?: string }) =>
  repositories.imprest.decideFloatChange(a.changeId, a.approve, a.notes));
export const useTransitionPlan = () => useImprestMutation((a: { id: string; to: Parameters<Repo['transitionPlan']>[1]; notes?: string }) =>
  repositories.imprest.transitionPlan(a.id, a.to, a.notes));
export const useRequestReplenishment = () => useImprestMutation((a: { floatId: string; kind?: 'replenishment' | 'funding' }) =>
  repositories.imprest.requestReplenishment(a.floatId, a.kind));
export const useTransitionReplenishment = () => useImprestMutation((a: { id: string; to: Transition[1]; notes?: string; paymentReference?: string }) =>
  repositories.imprest.transitionReplenishment(a.id, a.to, { notes: a.notes, paymentReference: a.paymentReference }));
export const useSetCashAccount = () => useImprestMutation((a: { floatId: string; account: string }) => repositories.imprest.setCashAccount(a.floatId, a.account));
export const useRecordCount = () => useImprestMutation((a: { floatId: string; counted: number; note?: string }) =>
  repositories.imprest.recordCount(a.floatId, a.counted, a.note));
export const useSetClaimFloat = () => useImprestMutation((a: { claimId: string; floatId: string | null }) => repositories.imprest.setClaimFloat(a.claimId, a.floatId));

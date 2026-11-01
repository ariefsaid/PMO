import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { useAuth } from '@/src/auth/useAuth';
import type { BudgetCategory } from '@/src/lib/db/imprest';
import { EXPENSE_QUERY_ROOTS } from './useExpenseClaims';
import { expenseClaimsAwaitingKey } from './approvalsQueryKeys';

/** Site imprest (#1515) over the repository seam (ADR-0017). Keys carry org_id (tenant scope). */
export const IMPREST_QUERY_ROOTS = ['imprest-floats', 'imprest-position', 'imprest-plan-usage', 'imprest-plans',
  'imprest-replenishments', 'imprest-counts', 'imprest-float-choices', 'imprest-float-claims', 'imprest-limit', 'imprest-awaiting', 'imprest-float-changes'] as const;

const useOrgId = (): string | undefined => useAuth().currentUser?.org_id;

export function useImprestFloats() {
  const orgId = useOrgId();
  return useQuery({ queryKey: ['imprest-floats', orgId], queryFn: () => repositories.imprest.listFloats(), enabled: Boolean(orgId) });
}
export function useImprestPosition(floatId: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-position', orgId, floatId],
    queryFn: () => repositories.imprest.getPosition(floatId as string),
    enabled: Boolean(orgId) && Boolean(floatId),
  });
}
export function useImprestPlanUsage(floatId: string | undefined, month: string | undefined) {
  const orgId = useOrgId();
  return useQuery({
    queryKey: ['imprest-plan-usage', orgId, floatId, month],
    queryFn: () => repositories.imprest.getPlanUsage(floatId as string, month as string),
    enabled: Boolean(orgId) && Boolean(floatId) && Boolean(month),
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
  return useQuery({ queryKey: ['imprest-awaiting', orgId], queryFn: () => repositories.imprest.listAwaitingImprest(), enabled: Boolean(orgId) });
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
export const useRecordCount = () => useImprestMutation((a: { floatId: string; counted: number; note?: string }) =>
  repositories.imprest.recordCount(a.floatId, a.counted, a.note));
export const useSetClaimFloat = () => useImprestMutation((a: { claimId: string; floatId: string | null }) => repositories.imprest.setClaimFloat(a.claimId, a.floatId));

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { safeTrack, trackBudgetActivated } from '@/src/lib/analytics';
import { repositories } from '@/src/lib/repositories';
import type { BudgetVersionWithItems, BudgetVersionRow, BudgetLineItemRow, NewLineItem, ActivateVersionResult, ArchiveVersionResult, BudgetArchiveLiveTarget, BudgetActivationMode } from '@/src/lib/db/budgets';

// ---------------------------------------------------------------------------
// Query key factories — org-scoped (AC-726, FR-QRY-PROC-001 mirror)
// ---------------------------------------------------------------------------
const budgetKey = (orgId: string | undefined, projectId: string) =>
  ['budget', orgId, projectId] as const;

const budgetVersionsKey = (orgId: string | undefined, projectId: string) =>
  ['budget-versions', orgId, projectId] as const;

// ---------------------------------------------------------------------------
// Read hooks (T12)
// ---------------------------------------------------------------------------

/** Derived budget: Σ Active version line-items. Org-scoped via RLS. */
export function useProjectBudget(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<number>({
    queryKey: budgetKey(orgId, projectId),
    queryFn: () => repositories.budget.deriveProjectBudget(projectId),
    enabled: Boolean(orgId && projectId),
  });
}

/** RPC contract: budget_activation_mode's complete set of mode strings. */
export function useBudgetActivationMode(versionId: string | undefined) {
  const { currentUser } = useAuth();
  return useQuery<BudgetActivationMode>({
    queryKey: ['budget-activation-mode', versionId, currentUser?.org_id, currentUser?.id, currentUser?.role],
    queryFn: () => repositories.budget.getActivationMode(versionId!),
    enabled: Boolean(versionId && currentUser?.id),
  });
}

/** Runs the same read-only server gate as the ERP push for the selected Draft. */
export function useBudgetActivationPrecheck(versionId: string | undefined) {
  return useQuery({
    queryKey: ['budget-activation-precheck', versionId],
    queryFn: () => repositories.budget.precheckActivation(versionId!),
    enabled: Boolean(versionId),
    staleTime: 0,
  });
}

export function useBudgetVersions(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<BudgetVersionWithItems[]>({
    queryKey: budgetVersionsKey(orgId, projectId),
    queryFn: () => repositories.budget.listVersions(projectId),
    enabled: Boolean(orgId && projectId),
  });
}

export function useBudgetArchiveTargets(versionIds: readonly string[], pollWhileLive = false) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const stableIds = [...versionIds].sort();
  return useQuery<BudgetArchiveLiveTarget[]>({
    queryKey: ['budget-archive-live-targets', orgId, stableIds],
    queryFn: () => repositories.budget.listArchiveLiveTargets(stableIds),
    enabled: Boolean(orgId && stableIds.length > 0),
    refetchInterval: (query) => pollWhileLive && (query.state.data?.length ?? 0) > 0 ? 30_000 : false,
  });
}

// ---------------------------------------------------------------------------
// Mutation hook (T13)
// ---------------------------------------------------------------------------

/** All budget lifecycle + line-item mutations. Each invalidates both read keys on success. */
export function useBudgetMutations(projectId: string) {
  const queryClient = useQueryClient();
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const realRole = useOptionalRealRole();

  const invalidateBoth = () => {
    queryClient.invalidateQueries({ queryKey: budgetKey(orgId, projectId) });
    queryClient.invalidateQueries({ queryKey: budgetVersionsKey(orgId, projectId) });
    queryClient.invalidateQueries({ queryKey: ['budget-activation-precheck'] });
    queryClient.invalidateQueries({ queryKey: ['project-finances', orgId, projectId] });
  };

  const invalidateMoneyCollections = () => {
    queryClient.invalidateQueries({ queryKey: ['projects-money', orgId] });
    queryClient.invalidateQueries({ queryKey: ['finance-budget-review', orgId] });
  };

  const createVersion = useMutation<BudgetVersionRow, Error, { projectId: string; name: string }>({
    mutationFn: ({ projectId: pid, name }) => repositories.budget.createVersion(pid, name),
    onSuccess: invalidateBoth,
  });

  const cloneVersion = useMutation<string, Error, string>({
    mutationFn: (versionId) => repositories.budget.cloneVersion(versionId),
    onSuccess: invalidateBoth,
  });

  const activate = useMutation<ActivateVersionResult, Error, string>({
    mutationFn: (versionId) => repositories.budget.activateVersion(versionId),
    onSuccess: () => {
      invalidateBoth();
      invalidateMoneyCollections();
      safeTrack(() => trackBudgetActivated(realRole ?? 'unknown'));
    },
  });

  const archive = useMutation<ArchiveVersionResult, Error, { versionId: string; cancelErp: boolean }>({
    mutationFn: ({ versionId, cancelErp }) => repositories.budget.archiveVersion(versionId, cancelErp),
    onSuccess: () => {
      invalidateBoth();
      invalidateMoneyCollections();
      queryClient.invalidateQueries({ queryKey: ['budget-archive-live-targets', orgId] });
    },
  });

  const deleteDraft = useMutation<void, Error, string>({
    mutationFn: (versionId) => repositories.budget.deleteDraftVersion(versionId),
    onSuccess: invalidateBoth,
  });

  const createLineItemMutation = useMutation<
    BudgetLineItemRow,
    Error,
    { versionId: string; item: NewLineItem }
  >({
    mutationFn: ({ versionId, item }) => repositories.budget.createLineItem(versionId, item),
    onSuccess: invalidateBoth,
  });

  const updateLineItemMutation = useMutation<
    void,
    Error,
    { id: string; patch: Parameters<typeof repositories.budget.updateLineItem>[1] }
  >({
    mutationFn: ({ id, patch }) => repositories.budget.updateLineItem(id, patch),
    onSuccess: invalidateBoth,
  });

  const deleteLineItemMutation = useMutation<void, Error, string>({
    mutationFn: (id) => repositories.budget.deleteLineItem(id),
    onSuccess: invalidateBoth,
  });

  return {
    createVersion,
    cloneVersion,
    activate,
    archive,
    deleteDraft,
    createLineItem: createLineItemMutation,
    updateLineItem: updateLineItemMutation,
    deleteLineItem: deleteLineItemMutation,
  };
}

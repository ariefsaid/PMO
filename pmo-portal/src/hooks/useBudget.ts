import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import {
  deriveProjectBudget,
  getBudgetActivationMode,
  precheckBudgetActivation,
  listBudgetVersions,
  createBudgetVersion,
  cloneVersion as dalCloneVersion,
  activateVersion,
  archiveVersion,
  deleteDraftVersion,
  createLineItem,
  updateLineItem,
  deleteLineItem,
  type BudgetVersionWithItems,
  type BudgetVersionRow,
  type BudgetLineItemRow,
  type NewLineItem,
  type ActivateVersionResult,
  type ArchiveVersionResult,
  type BudgetArchiveLiveTarget,
  type BudgetActivationMode,
  listBudgetArchiveLiveTargets,
} from '@/src/lib/db/budgets';

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
    queryFn: () => deriveProjectBudget(projectId),
    enabled: Boolean(orgId && projectId),
  });
}

/** RPC contract: budget_activation_mode's complete set of mode strings. */
export function useBudgetActivationMode(versionId: string | undefined) {
  const { currentUser } = useAuth();
  return useQuery<BudgetActivationMode>({
    queryKey: ['budget-activation-mode', versionId, currentUser?.org_id, currentUser?.id, currentUser?.role],
    queryFn: () => getBudgetActivationMode(versionId!),
    enabled: Boolean(versionId && currentUser?.id),
  });
}

/** Runs the same read-only server gate as the ERP push for the selected Draft. */
export function useBudgetActivationPrecheck(versionId: string | undefined) {
  return useQuery({
    queryKey: ['budget-activation-precheck', versionId],
    queryFn: () => precheckBudgetActivation(versionId!),
    enabled: Boolean(versionId),
    staleTime: 0,
  });
}

export function useBudgetVersions(projectId: string) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<BudgetVersionWithItems[]>({
    queryKey: budgetVersionsKey(orgId, projectId),
    queryFn: () => listBudgetVersions(projectId),
    enabled: Boolean(orgId && projectId),
  });
}

export function useBudgetArchiveTargets(versionIds: readonly string[], pollWhileLive = false) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const stableIds = [...versionIds].sort();
  return useQuery<BudgetArchiveLiveTarget[]>({
    queryKey: ['budget-archive-live-targets', orgId, stableIds],
    queryFn: () => listBudgetArchiveLiveTargets(stableIds),
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

  const invalidateBoth = () => {
    queryClient.invalidateQueries({ queryKey: budgetKey(orgId, projectId) });
    queryClient.invalidateQueries({ queryKey: budgetVersionsKey(orgId, projectId) });
    queryClient.invalidateQueries({ queryKey: ['budget-activation-precheck'] });
    queryClient.invalidateQueries({ queryKey: ['project-finances', orgId, projectId] });
  };

  const createVersion = useMutation<BudgetVersionRow, Error, { projectId: string; name: string }>({
    mutationFn: ({ projectId: pid, name }) => createBudgetVersion(pid, name),
    onSuccess: invalidateBoth,
  });

  const cloneVersion = useMutation<string, Error, string>({
    mutationFn: (versionId) => dalCloneVersion(versionId),
    onSuccess: invalidateBoth,
  });

  const activate = useMutation<ActivateVersionResult, Error, string>({
    mutationFn: (versionId) => activateVersion(versionId),
    onSuccess: invalidateBoth,
  });

  const archive = useMutation<ArchiveVersionResult, Error, { versionId: string; cancelErp: boolean }>({
    mutationFn: ({ versionId, cancelErp }) => archiveVersion(versionId, cancelErp),
    onSuccess: () => {
      invalidateBoth();
      queryClient.invalidateQueries({ queryKey: ['budget-archive-live-targets', orgId] });
    },
  });

  const deleteDraft = useMutation<void, Error, string>({
    mutationFn: (versionId) => deleteDraftVersion(versionId),
    onSuccess: invalidateBoth,
  });

  const createLineItemMutation = useMutation<
    BudgetLineItemRow,
    Error,
    { versionId: string; item: NewLineItem }
  >({
    mutationFn: ({ versionId, item }) => createLineItem(versionId, item),
    onSuccess: invalidateBoth,
  });

  const updateLineItemMutation = useMutation<
    void,
    Error,
    { id: string; patch: Parameters<typeof updateLineItem>[1] }
  >({
    mutationFn: ({ id, patch }) => updateLineItem(id, patch),
    onSuccess: invalidateBoth,
  });

  const deleteLineItemMutation = useMutation<void, Error, string>({
    mutationFn: (id) => deleteLineItem(id),
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

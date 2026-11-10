import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useAuth } from '@/src/auth/useAuth';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { safeTrack, trackBudgetActivated } from '@/src/lib/analytics';
import { repositories } from '@/src/lib/repositories';
import type { BudgetPushStatusRow } from '@/src/lib/repositories/budgetProjection';
import type { BudgetVersionWithItems, BudgetVersionRow, BudgetLineItemRow, NewLineItem, ActivateVersionResult, ArchiveVersionResult, BudgetArchiveLiveTarget, BudgetActivationMode, BudgetDistributionPlan, BudgetVersionMode } from '@/src/lib/db/budgets';

// ---------------------------------------------------------------------------
// Query key factories — org-scoped (AC-726, FR-QRY-PROC-001 mirror)
// ---------------------------------------------------------------------------
const budgetKey = (orgId: string | undefined, projectId: string) =>
  ['budget', orgId, projectId] as const;

const budgetVersionsKey = (orgId: string | undefined, projectId: string) =>
  ['budget-versions', orgId, projectId] as const;

/** `versionId` omitted = the whole project's prefix (invalidation); given = one version's saved plan. */
export const budgetDistributionKey = (orgId: string | undefined, projectId: string, versionId?: string) =>
  (versionId === undefined
    ? ['budget-distribution', orgId, projectId]
    : ['budget-distribution', orgId, projectId, versionId]) as readonly unknown[];

/**
 * Shared awaited refresh for budget writes. Existing matching budget, readiness, finance,
 * distribution, comparison, and projection queries are marked stale; each active query is then
 * refetched individually so every read is awaited. Inactive queries stay stale until requested.
 */
export function refreshBudgetQueries(
  queryClient: QueryClient,
  orgId: string | undefined,
  projectId: string,
): Promise<void> {
  const forecastFamilies = [
    'budget-comparison',
    'budget-projection',
    'active-budget-category-phasing',
    'budget-fiscal-years',
  ] as const;
  const prefixes: readonly (readonly unknown[])[] = [
    budgetKey(orgId, projectId),
    budgetVersionsKey(orgId, projectId),
    ['budget-activation-precheck'],
    ['project-finances', orgId, projectId],
    budgetDistributionKey(orgId, projectId),
    ...forecastFamilies.flatMap((family) => [
      [family, projectId],
      [family, orgId, projectId],
    ]),
  ] as const;
  const matchedQueries = new Map(
    prefixes.flatMap((queryKey) => queryClient.getQueryCache()
      .findAll({ queryKey })
      .map((query) => [query.queryHash, query] as const)),
  );
  const matchedHashes = new Set(matchedQueries.keys());

  // Mark only the queries captured above stale. refetchType:none prevents TanStack's grouped
  // prefix refetch from starting reads this function cannot individually await.
  return queryClient.invalidateQueries(
    {
      predicate: (query) => matchedHashes.has(query.queryHash),
      refetchType: 'none',
    },
  ).then(async () => {
    const activeQueries = [...matchedQueries.values()].filter((query) => query.isActive());
    const settlements = await Promise.allSettled(activeQueries.map((query) =>
      queryClient.refetchQueries(
        { queryKey: query.queryKey, exact: true, type: 'active' },
        { throwOnError: true },
      ),
    ));
    const failedRead = settlements.find((settlement) => settlement.status === 'rejected');
    if (failedRead?.status === 'rejected') throw failedRead.reason;
  });
}

/** Existing mutation flows keep their fire-and-forget completion behavior. */
export function invalidateBudgetQueries(queryClient: QueryClient, orgId: string | undefined, projectId: string): void {
  void refreshBudgetQueries(queryClient, orgId, projectId).catch(() => undefined);
}

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

/** #1273 — org-wide Draft budgets for the review-and-activate list. */
export function useOrgBudgetDrafts(enabled: boolean) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery({
    queryKey: ['org-budget-drafts', orgId],
    queryFn: () => repositories.budget.listOrgDrafts(),
    enabled: Boolean(orgId && enabled),
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

/** One version's saved whole-project distribution plan (`null` before the first save).
 *  Enabled only with org identity + version; a save invalidates it (see useBudgetMutations). */
export function useBudgetDistribution(projectId: string, versionId: string | undefined) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  return useQuery<BudgetDistributionPlan | null>({
    queryKey: budgetDistributionKey(orgId, projectId, versionId),
    queryFn: () => repositories.budget.getDistribution(versionId!),
    enabled: Boolean(orgId && projectId && versionId),
  });
}

export function useBudgetArchiveTargets(versionIds: readonly string[], pollWhileLive = false) {
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id;
  const stableIds = [...versionIds].sort();
  return useQuery<BudgetArchiveLiveTarget[]>({
    queryKey: ['budget-archive-live-targets', orgId, stableIds],
    // #1462 — BOTH mirror kinds in ONE read that fails closed: an error in either query rejects and the
    // surface says it could not check, rather than rendering a partial list as the whole truth.
    queryFn: async () => {
      const [account, legacy] = await Promise.all([
        repositories.budget.listArchiveLiveTargets(stableIds),
        repositories.budget.listLegacyArchiveLiveTargets(stableIds),
      ]);
      return [...account, ...legacy];
    },
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

  const invalidateBoth = () => invalidateBudgetQueries(queryClient, orgId, projectId);

  const invalidateMoneyCollections = () => {
    queryClient.invalidateQueries({ queryKey: ['projects-money', orgId] });
    queryClient.invalidateQueries({ queryKey: ['finance-budget-review', orgId] });
  };

  const createVersion = useMutation<BudgetVersionRow, Error, { projectId: string; name: string; budgetMode?: BudgetVersionMode }>({
    mutationFn: ({ projectId: pid, name, budgetMode }) => repositories.budget.createVersion(pid, name, undefined, budgetMode),
    onSuccess: invalidateBoth,
  });

  const cloneVersion = useMutation<string, Error, string>({
    mutationFn: (versionId) => repositories.budget.cloneVersion(versionId),
    onSuccess: invalidateBoth,
  });

  const activate = useMutation<ActivateVersionResult, Error, string>({
    mutationFn: async (versionId) => {
      let settled = false;
      const result = await repositories.budget.activateVersion(versionId, () => {
        settled = true;
        // ADR-0062: the background push ended — re-read the per-year push status the badge renders.
        void queryClient.invalidateQueries({ queryKey: ['budget-push-status', projectId] });
        invalidateBoth();
      });
      // #1030: the push runs in the background and writes no mirror row yet, so a re-read now says
      // "never pushed". Seed a pending row; the settle callback above invalidates it for the durable
      // truth. Skipped when the push already settled (a fast failure), else the seed would outlive it.
      if (!settled) {
        queryClient.setQueryData<BudgetPushStatusRow[]>(['budget-push-status', projectId], [{
          pushState: 'pending', pushError: null, unmappedCategories: null, erpBudgetName: null,
          fiscalYear: null, pushedAt: null, holdReleasable: false, staleAttribution: false,
        }]);
      }
      return result;
    },
    onSuccess: () => {
      invalidateBoth();
      invalidateMoneyCollections();
      safeTrack(() => trackBudgetActivated(realRole ?? 'unknown'));
    },
  });

  const returnVersion = useMutation<void, Error, { versionId: string; reason: string }>({
    mutationFn: ({ versionId, reason }) => repositories.budget.returnVersion(versionId, reason),
    onSuccess: invalidateBoth,
  });

  const resubmitVersion = useMutation<void, Error, string>({
    mutationFn: (versionId) => repositories.budget.resubmitVersion(versionId),
    onSuccess: invalidateBoth,
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

  /** #1472 S6A: persists the confirmed snapshot; on success the shared invalidation re-reads the
   *  plan, the version list, the precheck and project finances. No optimistic save — a rejection
   *  leaves the prior cached plan untouched for re-review. */
  const saveDistribution = useMutation<void, Error, { versionId: string; plan: BudgetDistributionPlan }>({
    mutationFn: ({ versionId, plan }) => repositories.budget.saveDistribution(versionId, plan),
    onSuccess: invalidateBoth,
  });

  const switchDraftMode = useMutation<void, Error, {
    versionId: string;
    targetMode: BudgetVersionMode;
    expectedLines: Parameters<typeof repositories.budget.switchDraftMode>[2];
    assignments: Parameters<typeof repositories.budget.switchDraftMode>[3];
  }>({
    mutationFn: ({ versionId, targetMode, expectedLines, assignments }) =>
      repositories.budget.switchDraftMode(versionId, targetMode, expectedLines, assignments),
    onSuccess: invalidateBoth,
  });

  return {
    createVersion,
    cloneVersion,
    activate,
    returnVersion,
    resubmitVersion,
    archive,
    deleteDraft,
    createLineItem: createLineItemMutation,
    updateLineItem: updateLineItemMutation,
    deleteLineItem: deleteLineItemMutation,
    saveDistribution,
    switchDraftMode,
  };
}

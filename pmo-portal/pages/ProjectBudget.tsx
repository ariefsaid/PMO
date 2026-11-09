import React, { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import {
  useProjectBudget,
  useBudgetVersions,
  useBudgetMutations,
  useBudgetArchiveTargets,
  useBudgetDistribution,
} from '@/src/hooks/useBudget';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useUsers } from '@/src/hooks/useUsers';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { useErpnextBinding } from '@/src/hooks/useErpnextBinding';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import {
  formatCurrency,
  formatNumberMax2,
  formatShortMoney,
  formatInstantDate,
} from '@/src/lib/format';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatExactCents, parseExactCents } from '@/src/lib/exactDecimal';
import { yearsInSpan } from '@/src/lib/budget/budgetDistribution';
import { staleDistributionBasis } from '@/src/lib/budget/distributionStaleness';
import { budgetVersionVariant } from '@/src/lib/status/statusVariants';
import {
  Button,
  useToast,
  Card,
  CardHead,
  CardPad,
  Icon,
  ListState,
  DataTable,
  type Column,
  type RowMenuItem,
  TaxBasisLabel,
  StatusPill,
  Tooltip,
  KPIRow,
  KPITile,
  ViewToggle,
  ProgressBar,
  Drawer,
  MenuButton,
} from '@/src/components/ui';
import type { BudgetDistributionPlan, BudgetVersionWithItems } from '@/src/lib/db/budgets';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { useBudgetPosition } from '@/src/hooks/useProjectPosition';
import BudgetVersionsDrawer from './project-detail/budget/BudgetVersionsDrawer';
import BudgetErpNotice from './project-detail/budget/BudgetErpNotice';
import { BudgetOdooActuals, BudgetOdooCategoryLines } from './project-detail/budget/BudgetOdooActuals';
import { useOdooProjectActuals } from '@/src/hooks/useOdooLedger';
import { buildBudgetSummaryRows, committedTotal, type BudgetSummaryRow } from '@/src/lib/budget/budgetModel';
import BudgetProjection from './BudgetProjection';
import { buildBudgetProjectionCsv, type BudgetProjectionExport } from '@/src/lib/budget/budgetProjectionExport';
import { AttributedSpendingNote } from './project-detail/AttributedSpendingNote';
import BudgetLineItemEditor from './project-budget/BudgetLineItemEditor';
import DistributionGrid, { type DistributionReadinessStatus, type DistributionSourceWitness } from './project-budget/DistributionGrid';
import BudgetModeSwitchDialog, { type BudgetModeSwitchRequest } from './project-budget/BudgetModeSwitchDialog';
import { useBudgetReadiness } from './project-budget/BudgetReadiness';
import { useBudgetVersionActions } from './project-budget/BudgetVersionActions';
import { fetchBudgetPushStatus, type BudgetPushStatusRow } from '@/src/lib/repositories/budgetProjection';
import { repositories } from '@/src/lib/repositories';

// ---------------------------------------------------------------------------
// Main page component (NFR-BV-UI-001)
// ---------------------------------------------------------------------------
interface ProjectBudgetProps {
  projectId: string;
  project: ProjectWithRefs;
}

type AuthoringRecoveryKind = 'saved-read-failed' | 'saved-changed' | 'stale-read-failed' | 'stale-rejected' | 'uncertain' | 'rereview';

interface AuthoringSnapshotExpectation {
  projectId: string;
  versionNumber: number;
  mode: 'whole_project' | 'per_year';
  lines: DistributionSourceWitness[];
  distribution: BudgetDistributionPlan | null;
}

interface AuthoringRecovery {
  kind: AuthoringRecoveryKind;
  versionId: string;
  expected?: AuthoringSnapshotExpectation;
}

interface AuthoringRefreshResult {
  status: 'current' | 'changed' | 'failed';
}

function sourceWitnesses(version: BudgetVersionWithItems): DistributionSourceWitness[] | null {
  const lines = version.line_items.map((line) => {
    const cents = parseExactCents(String(line.budgeted_amount));
    if (cents === null) return null;
    return {
      id: line.id,
      category: line.category,
      budgeted_amount: formatExactCents(cents),
      fiscal_year: line.fiscal_year ?? null,
    };
  });
  if (lines.some((line) => line === null)) return null;
  return (lines as DistributionSourceWitness[]).sort((left, right) => left.id.localeCompare(right.id));
}

function canonicalBudgetPlan(plan: BudgetDistributionPlan | null): string {
  if (!plan) return 'null';
  const rows = [...plan.rows].sort((left, right) => left.category.localeCompare(right.category) || left.ordinal - right.ordinal || left.fiscal_year.localeCompare(right.fiscal_year));
  const sortKeys = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortKeys);
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, sortKeys(entry)]));
  };
  return JSON.stringify(sortKeys({ ...plan, rows }));
}

function expectedModeSnapshot(request: BudgetModeSwitchRequest, projectId: string, versionNumber: number): AuthoringSnapshotExpectation {
  const assignmentById = new Map(request.assignments.map((assignment) => [assignment.id, assignment.fiscal_year]));
  const lines = request.expectedLines.map((line) => ({
    id: line.id,
    category: line.category,
    budgeted_amount: line.budgeted_amount,
    fiscal_year: request.targetMode === 'whole_project' ? null : assignmentById.get(line.id) ?? null,
  })).sort((left, right) => left.id.localeCompare(right.id));
  return { projectId, versionNumber, mode: request.targetMode, lines, distribution: null };
}

const ProjectBudget: React.FC<ProjectBudgetProps> = ({ projectId, project }) => {
  const { t } = useTranslation('finance');
  const { toast } = useToast();
  const can = usePermission();
  const { realRole } = useEffectiveRole();
  const canWrite = can('edit', 'budgetLine');
  const canReadMoney = can('view', 'salesInvoice');
  const canReadProcurements = can('view', 'procurement');
  const canManageAccounting = can('manage', 'orgAccounting');
  // #1402 scopes ERP push status to Finance and Admin.
  const canViewBudgetEnforcement = realRole === 'Admin' || realRole === 'Finance';
  const { currentUser } = useAuth();
  const queryClient = useQueryClient();
  const usersQuery = useUsers();
  const erpBindingQuery = useErpnextBinding();
  // #1507 S7 (FR-ODA-052): an Odoo-ledger project with no linked cost account shows no actual cost rather than a zero.
  const odooActuals = useOdooProjectActuals(projectId);
  const currentUserId = currentUser?.id ?? null;
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedForecast = searchParams.get('budgetView') === 'forecast';
  const setBudgetView = (nextView: 'actual' | 'forecast') => {
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    if (nextView === 'forecast') next.set('budgetView', 'forecast');
    else next.delete('budgetView');
    setSearchParams(next, { replace: true });
  };
  const openCategory = (row: BudgetSummaryRow) => {
    const next = new URLSearchParams(searchParams);
    next.set('open', row.category);
    setSearchParams(next);
  };
  const closeCategory = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('open');
    setSearchParams(next, { replace: true });
  };

  const budgetQuery = useProjectBudget(projectId);
  const versionsQuery = useBudgetVersions(projectId);
  const mutations = useBudgetMutations(projectId);
  const position = useBudgetPosition(project);
  const procurementsQuery = useProjectProcurements(canReadProcurements ? projectId : null);
  const pushStatusQuery = useQuery<BudgetPushStatusRow[]>({
    queryKey: ['budget-push-status', projectId],
    queryFn: () => fetchBudgetPushStatus(projectId),
    enabled: canViewBudgetEnforcement && Boolean(projectId),
  });

  const [versionsOpen, setVersionsOpen] = useState(false);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [draftEditorOpen, setDraftEditorOpen] = useState(false);
  const [hasOpenLineBuffers, setHasOpenLineBuffers] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Set<string>>(() => new Set());
  const [modeSwitchOpen, setModeSwitchOpen] = useState(false);
  const [modeSwitchStaleNonce, setModeSwitchStaleNonce] = useState(0);
  const [distributionReadiness, setDistributionReadiness] = useState<{ versionId: string | null; status: DistributionReadinessStatus }>({ versionId: null, status: 'loading' });
  const [authoringRecovery, setAuthoringRecovery] = useState<AuthoringRecovery | null>(null);
  const [authoringRefreshPending, setAuthoringRefreshPending] = useState(false);
  const authoringRefreshNeeded = authoringRecovery !== null;

  const versions = useMemo<BudgetVersionWithItems[]>(
    () => (versionsQuery.data ?? []) as BudgetVersionWithItems[],
    [versionsQuery.data],
  );
  const activeVersion = versions.find((version) => version.status === 'Active');
  const approvedBudgetYears = useMemo(() => activeVersion?.budget_mode === 'per_year'
    ? [...new Set(activeVersion.line_items.flatMap((line) => line.fiscal_year ? [line.fiscal_year] : []))]
    : [], [activeVersion]);
  const draftVersion = versions.find((version) => version.status === 'Draft');
  const draftMode = draftVersion?.budget_mode === 'whole_project' ? 'whole_project' : 'per_year';
  const budgetDistributionQuery = useBudgetDistribution(
    projectId,
    draftVersion?.budget_mode === 'whole_project' ? draftVersion.id : undefined,
  );
  // FR-022: read-only look at the Active whole-project plan; nothing here writes or pushes.
  const activeDistributionQuery = useBudgetDistribution(
    projectId,
    activeVersion?.budget_mode === 'whole_project' ? activeVersion.id : undefined,
  );
  const archiveTargetsQuery = useBudgetArchiveTargets(
    versions.map((version) => version.id),
    versions.some((version) => version.status === 'Archived'),
  );
  const archiveTargetsLoading = archiveTargetsQuery.isPending || (archiveTargetsQuery.isFetching && (archiveTargetsQuery.isError || !archiveTargetsQuery.data));
  const archiveTargets = archiveTargetsQuery.data ?? [];
  const pushedActiveGrains = new Set(
    archiveTargets.flatMap((target) => {
      const matchingActiveVersion = versions.find((version) =>
        version.id === target.budget_version_id &&
        version.status === 'Active' &&
        version.activated_at === target.activated_at_witness,
      );
      if (
        !matchingActiveVersion || target.budget_intent !== 'ensure' || target.push_state !== 'pushed' ||
        target.erp_cancelled_at !== null || target.erp_docstatus === 2
      ) return [];
      return [JSON.stringify([target.erp_account, target.fiscal_year])];
    }),
  );
  const archivedLiveTargets = archiveTargets.filter((target) =>
    versions.some((version) => version.id === target.budget_version_id && version.status === 'Archived') &&
    typeof target.erp_budget_name === 'string' && target.erp_budget_name.trim() !== '' &&
    target.erp_cancelled_at === null && target.erp_docstatus !== 2 &&
    !pushedActiveGrains.has(JSON.stringify([target.erp_account, target.fiscal_year])),
  );
  const hasActiveErpBinding = erpBindingQuery.data?.status === 'active';
  const view = requestedForecast && hasActiveErpBinding && activeVersion ? 'forecast' : 'actual';
  const orderedVersions = [...versions].sort((a, b) => a.version - b.version);
  const selectedVersion = view === 'forecast'
    ? activeVersion
    : versions.find((version) => version.id === selectedVersionId) ?? activeVersion ?? draftVersion ?? orderedVersions.at(-1);

  const distributionReadinessStatus: DistributionReadinessStatus = draftMode !== 'whole_project'
    ? 'current'
    : budgetDistributionQuery.isError
      ? 'error'
      : budgetDistributionQuery.isPending || budgetDistributionQuery.isFetching
        ? 'loading'
        : distributionReadiness.versionId === draftVersion?.id
          ? distributionReadiness.status
          : budgetDistributionQuery.data
            ? 'stale'
            : 'absent';
  const acceptDistributionReadiness = useCallback((readiness: { versionId: string; status: DistributionReadinessStatus }) => {
    setDistributionReadiness((current) => current.versionId === readiness.versionId && current.status === readiness.status
      ? current
      : readiness);
  }, []);

  const { readinessMessages, canConfirmActivation, canActivate, activateBlockedReason, soleOperator, activationPrecheckQuery } = useBudgetReadiness(draftVersion, currentUserId, hasOpenLineBuffers, distributionReadinessStatus);

  const { newVersionForm, showNewVersionForm, setShowNewVersionForm, pendingConfirm, budgetConfirm, dismissActivationNotice, requestActivate, requestClone, requestArchive, requestDeleteDraft, requestDeleteLineItem } = useBudgetVersionActions({ projectId, versions, draftVersion, canActivate, canConfirmActivation, hasOpenLineBuffers, soleOperator, activateBlockedReason, readinessMessages, archiveTargetsQuery, activationPrecheckQuery, mutations, setSelectedVersionId, setDraftEditorOpen, setBudgetView });

  const fiscalYears = activationPrecheckQuery.data?.fiscalYears ?? null;
  const fiscalYearNames = (() => {
    if (!project.start_date || !fiscalYears) return [];
    try {
      return yearsInSpan(project.start_date, project.end_date, fiscalYears).map((year) => year.name);
    } catch {
      return [];
    }
  })();
  const staleActivePlan = activeVersion && activeDistributionQuery.data
    ? staleDistributionBasis(activeDistributionQuery.data.basis, project.start_date ?? null, project.end_date ?? null, fiscalYears)
    : null;
  const modeSwitchContextKey = JSON.stringify([
    modeSwitchStaleNonce,
    draftVersion?.id,
    draftMode,
    currentUserId,
    realRole,
    canWrite,
    project.start_date,
    project.end_date,
    fiscalYears,
    draftVersion?.line_items.map((line) => [line.id, line.category, String(line.budgeted_amount), line.fiscal_year]),
  ]);
  const refreshAuthoringSnapshot = async (versionId: string, expected?: AuthoringSnapshotExpectation): Promise<AuthoringRefreshResult> => {
    const results = await Promise.allSettled([
      budgetQuery.refetch(),
      versionsQuery.refetch(),
      activationPrecheckQuery.refetch(),
      queryClient.fetchQuery({
        queryKey: ['budget-distribution', currentUser?.org_id, projectId, versionId],
        queryFn: () => repositories.budget.getDistribution(versionId),
        staleTime: 0,
      }),
    ]);
    const healthy = results.every((result) => result.status === 'fulfilled' && !(
      typeof result.value === 'object' && result.value !== null && 'isError' in result.value && result.value.isError
    ));
    if (!healthy) return { status: 'failed' };
    const budgetRead = results[0].status === 'fulfilled' ? results[0].value as { data?: unknown } : undefined;
    const versionsRead = results[1].status === 'fulfilled' ? results[1].value as { data?: unknown } : undefined;
    const precheckRead = results[2].status === 'fulfilled' ? results[2].value as { data?: unknown } : undefined;
    const distributionRead = results[3].status === 'fulfilled' ? results[3].value as BudgetDistributionPlan | null : undefined;
    if (budgetRead?.data === undefined || !Array.isArray(versionsRead?.data) || precheckRead?.data === undefined || distributionRead === undefined) {
      return { status: 'failed' };
    }
    if (!expected) return { status: 'current' };

    const refreshedVersion = (versionsRead.data as BudgetVersionWithItems[]).find((version) => version.id === versionId);
    const refreshedSource = refreshedVersion ? sourceWitnesses(refreshedVersion) : null;
    if (!refreshedVersion || refreshedVersion.project_id !== expected.projectId || refreshedVersion.version !== expected.versionNumber ||
      refreshedVersion.status !== 'Draft' || refreshedVersion.budget_mode !== expected.mode ||
      refreshedSource === null || JSON.stringify(refreshedSource) !== JSON.stringify(expected.lines) ||
      canonicalBudgetPlan(distributionRead) !== canonicalBudgetPlan(expected.distribution)) {
      return { status: 'changed' };
    }
    return { status: 'current' };
  };
  const retryAuthoringRefresh = async () => {
    if (!authoringRecovery) return;
    setAuthoringRefreshPending(true);
    try {
      const refreshed = await refreshAuthoringSnapshot(authoringRecovery.versionId, authoringRecovery.expected);
      if (refreshed.status === 'failed') {
        if (authoringRecovery.kind === 'stale-read-failed') setAuthoringRecovery({ ...authoringRecovery, kind: 'stale-read-failed' });
        return;
      }
      if (authoringRecovery.kind === 'saved-read-failed' && refreshed.status === 'current') {
        setAuthoringRecovery(null);
        toast(t('projectDetail.budget.budgetRefreshComplete', 'Budget data is current again.'), undefined, 'success');
        return;
      }
      setAuthoringRecovery({ kind: refreshed.status === 'changed' && authoringRecovery.expected ? 'saved-changed' : 'rereview', versionId: authoringRecovery.versionId });
      setDraftEditorOpen(true);
    } finally {
      setAuthoringRefreshPending(false);
    }
  };
  const changeDraftMode = async (request: BudgetModeSwitchRequest) => {
    const { versionId, targetMode, expectedLines, assignments } = request;
    const expected = expectedModeSnapshot(request, projectId, draftVersion?.id === versionId ? draftVersion.version : -1);
    try {
      await mutations.switchDraftMode.mutateAsync({ versionId, targetMode, expectedLines, assignments });
      setModeSwitchOpen(false);
      setAuthoringRecovery({ kind: 'saved-read-failed', versionId, expected });
      setDraftEditorOpen(true);
      const refreshed = await refreshAuthoringSnapshot(versionId, expected);
      if (refreshed.status === 'failed') return;
      if (refreshed.status === 'changed') {
        setAuthoringRecovery({ kind: 'saved-changed', versionId, expected });
        setDraftEditorOpen(true);
        return;
      }
      setAuthoringRecovery(null);
      toast(t('projectDetail.budget.modeChanged', 'Budget mode changed'), undefined, 'success');
    } catch (error) {
      if ((error as { code?: string })?.code === '40001') {
        setModeSwitchOpen(false);
        setDraftEditorOpen(true);
        setAuthoringRecovery({ kind: 'stale-read-failed', versionId });
        const refreshed = await refreshAuthoringSnapshot(versionId);
        setAuthoringRecovery({ kind: refreshed.status === 'failed' ? 'stale-read-failed' : 'stale-rejected', versionId });
        setModeSwitchStaleNonce((current) => current + 1);
        return;
      }
      if (!(error as { code?: string })?.code) {
        setModeSwitchOpen(false);
        setDraftEditorOpen(true);
        setAuthoringRecovery({ kind: 'uncertain', versionId });
        return;
      }
      const { headline, detail } = classifyMutationError(error);
      toast(headline, detail, 'warning');
    }
  };
  const saveDistribution = async (plan: BudgetDistributionPlan, source: DistributionSourceWitness[]) => {
    if (!draftVersion) return false;
    const expected: AuthoringSnapshotExpectation = {
      projectId,
      versionNumber: draftVersion.version,
      mode: 'whole_project',
      lines: source,
      distribution: plan,
    };
    try {
      await mutations.saveDistribution.mutateAsync({ versionId: draftVersion.id, plan });
      setAuthoringRecovery({ kind: 'saved-read-failed', versionId: draftVersion.id, expected });
      setDraftEditorOpen(true);
      const refreshed = await refreshAuthoringSnapshot(draftVersion.id, expected);
      if (refreshed.status === 'failed') return false;
      if (refreshed.status === 'changed') {
        setAuthoringRecovery({ kind: 'saved-changed', versionId: draftVersion.id, expected });
        setDraftEditorOpen(true);
        return false;
      }
      setAuthoringRecovery(null);
      toast(t('projectDetail.budget.distributionSavedToast', 'Fiscal-year distribution saved'), undefined, 'success');
      return true;
    } catch (error) {
      if ((error as { code?: string })?.code === '40001') {
        setDraftEditorOpen(true);
        setAuthoringRecovery({ kind: 'stale-read-failed', versionId: draftVersion.id });
        const refreshed = await refreshAuthoringSnapshot(draftVersion.id);
        setAuthoringRecovery({ kind: refreshed.status === 'failed' ? 'stale-read-failed' : 'stale-rejected', versionId: draftVersion.id });
        setModeSwitchStaleNonce((current) => current + 1);
        return false;
      }
      if (!(error as { code?: string })?.code) {
        setDraftEditorOpen(true);
        setAuthoringRecovery({ kind: 'uncertain', versionId: draftVersion.id });
        return false;
      }
      const { headline, detail } = classifyMutationError(error);
      toast(headline, detail, 'warning');
      return false;
    }
  };

  const authoringRecoveryMessage = authoringRecovery ? (() => {
    switch (authoringRecovery.kind) {
      case 'saved-read-failed': return t('projectDetail.budget.authoringSavedReadFailed', 'A change was saved, but a selected budget read failed. Refresh to reconcile the saved version and distribution before another write.');
      case 'saved-changed': return t('projectDetail.budget.authoringSavedChanged', 'The change was saved, but the refreshed draft differs from what you reviewed. Review the current draft before continuing.');
      case 'stale-read-failed': return t('projectDetail.budget.authoringStaleReadFailed', 'The server rejected this change because the draft changed; it was not saved. The current draft could not be refreshed. Retry the read before reviewing it.');
      case 'stale-rejected': return t('projectDetail.budget.authoringStaleRejected', 'The server rejected this change because the draft changed; it was not saved. Review the current draft before trying again.');
      case 'uncertain': return t('projectDetail.budget.authoringOutcomeUncertain', 'The save outcome is uncertain. Refresh budget data before deciding what to do; no write was retried.');
      case 'rereview': return t('projectDetail.budget.authoringRereviewRequired', 'The current budget data is loaded. Review the draft before continuing.');
    }
  })() : null;
  const authoringRecoveryNotice = authoringRecovery && authoringRecoveryMessage ? (
    <div role="alert" className="rounded-md border border-warning/40 bg-warning/[0.07] px-3 py-3 text-sm text-foreground" data-testid="budget-authoring-recovery">
      <p>{authoringRecoveryMessage}</p>
      {['saved-read-failed', 'stale-read-failed', 'uncertain'].includes(authoringRecovery.kind) ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => void retryAuthoringRefresh()} disabled={authoringRefreshPending}>
          {authoringRefreshPending ? t('projectDetail.budget.budgetRefreshPending', 'Refreshing…') : t('projectDetail.budget.retryBudgetRefresh', 'Refresh budget data')}
        </Button>
      ) : (
        <Button variant="outline" size="sm" className="mt-2" onClick={() => {
          setSelectedVersionId(authoringRecovery.versionId);
          setDraftEditorOpen(true);
          setModeSwitchStaleNonce((current) => current + 1);
          setAuthoringRecovery(null);
        }}>
          {t('projectDetail.budget.reviewCurrentDraft', 'Review current draft')}
        </Button>
      )}
    </div>
  ) : null;

  if (budgetQuery.isPending || versionsQuery.isPending) {
    return <div data-testid="budget-loading" className="space-y-3">{authoringRecoveryNotice}<ListState variant="loading" shape="detail" rows={4} /></div>;
  }
  if (budgetQuery.isError || versionsQuery.isError) {
    return (
      <div className="space-y-3">
        {authoringRecoveryNotice}
        <ListState
          variant="error"
          title={t('financeCopy.budgetLoadFailed', "Couldn't load budget")}
          sub={t('financeCopy.somethingWentWrongFetchingTheBudgetData', 'Something went wrong fetching the budget data.')}
          onRetry={() => {
            if (authoringRecovery) void retryAuthoringRefresh();
            else {
              void budgetQuery.refetch();
              void versionsQuery.refetch();
            }
          }}
        />
      </div>
    );
  }

  const canSeeActuals = canReadMoney && position.canSeeActual && !odooActuals.unlinked;
  const canSeeCommitments = canReadMoney && canReadProcurements && !procurementsQuery.isPending && !procurementsQuery.isError;
  const summaryRows = selectedVersion && canReadMoney ? buildBudgetSummaryRows({
    lines: selectedVersion.line_items,
    actuals: position.spendRows ?? position.rows,
    procurements: procurementsQuery.data,
    canReadProcurements: canSeeCommitments,
    currency: project.currency,
  }) : [];
  const selectedCurrency = selectedVersion?.currency || project.currency;
  // #2066: every figure carries its own currency (the Odoo spend in the Odoo company's, the budget in its version's, commitments in the project's); Left needs all three equal.
  const spendCurrency = position.spendCurrency ?? project.currency;
  const compatibleBasis = selectedCurrency === spendCurrency && spendCurrency === project.currency;
  const enrichedRows = summaryRows.map((row) => {
    const actualKnown = canSeeActuals && row.spent !== null;
    const committedKnown = canSeeCommitments && row.committed !== null;
    const left = compatibleBasis && actualKnown && committedKnown ? row.budget - (row.spent ?? 0) - (row.committed ?? 0) : null;
    const used = compatibleBasis && row.budget > 0 && actualKnown && committedKnown
      ? ((row.spent ?? 0) + (row.committed ?? 0)) / row.budget * 100
      : null;
    return { ...row, left, used };
  });
  const selectedCategory = view === 'actual'
    ? enrichedRows.find((row) => row.category === searchParams.get('open')) ?? null
    : null;
  const totalBudget = activeVersion?.total ?? null;
  // When the active version has no recorded currency, use the project currency for display.
  const activeBudgetCurrency = activeVersion?.currency || project.currency;
  const tableBudgetTotal = selectedVersion?.total ?? null;
  // On the Odoo ledger a category with no mapped account reads "—" and is listed beside the table as not counted, so the total is the sum of the figures the table shows.
  const spentRows = enrichedRows.filter((row) => row.spent !== null);
  // Spent and Left say so when they leave out budget categories that have no Odoo account.
  const spentExcluded = odooActuals.onLedger ? enrichedRows.length - spentRows.length : 0;
  const totalSpent = canSeeActuals && spentRows.length > 0 && (odooActuals.onLedger || spentRows.length === enrichedRows.length)
    ? spentRows.reduce((sum, row) => sum + (row.spent ?? 0), 0)
    : null;
  // L12: one committed calculation for the whole project — the Overview reads the same shared total.
  const totalCommitted = canSeeCommitments ? committedTotal(enrichedRows) : null;
  const totalLeft = compatibleBasis && tableBudgetTotal !== null && totalSpent !== null && totalCommitted !== null
    ? tableBudgetTotal - totalSpent - totalCommitted
    : null;
  const tableLeftTotal = compatibleBasis && tableBudgetTotal !== null && totalSpent !== null && totalCommitted !== null
    ? tableBudgetTotal - totalSpent - totalCommitted
    : null;
  // C4: an unknown author or date is left out of the line, never printed as "unavailable".
  const authorName = (version: BudgetVersionWithItems) => version.created_by != null && version.created_by === currentUserId
    ? t('common.you', 'You')
    : usersQuery.data?.find((user) => user.id === version.created_by)?.full_name ?? null;
  const versionMeta = (version: BudgetVersionWithItems) => [
    version.created_at ? formatInstantDate(version.created_at) : null,
    authorName(version),
  ].filter(Boolean).join(' · ');
  /** A row's budget status, or null when spending or commitments are unknown (the page states that reason once). */
  const getStatus = (row: { budget: number; spent: number | null; committed: number | null; used: number | null; left: number | null }) => {
    if (row.budget === 0 && row.left !== null && row.left < 0) return { variant: 'warn' as const, label: t('projectDetail.budget.notBudgeted', 'Not budgeted') };
    if (row.used === null || row.left === null) return null;
    if (row.left < 0) return { variant: 'lost' as const, label: t('projectDetail.budget.overBudget', 'Over budget') };
    if (row.used >= 90) return { variant: 'lost' as const, label: t('projectDetail.budget.atRisk', 'At risk') };
    if (row.used >= 70) return { variant: 'warn' as const, label: t('projectDetail.budget.watch', 'Watch') };
    return { variant: 'won' as const, label: t('projectDetail.budget.onTrack', 'On track') };
  };
  // C5/C6: whole units use the project heading; foreign budget figures carry their own basis.
  // C5 + money precision: no trailing .00 on whole amounts, but a real fraction (1,234.5) is never rounded away.
  const formatAmount = (value: number | null) => value === null ? '—' : formatNumberMax2(value);
  const formatBudget = (value: number | null) => value === null ? '—' : selectedCurrency === project.currency ? formatAmount(value) : `${selectedCurrency} ${formatAmount(value)}`;
  const formatSpent = (value: number | null) => value === null ? '—' : spendCurrency === project.currency ? formatAmount(value) : `${spendCurrency} ${formatAmount(value)}`;
  // F11: KPI tiles carry the short amount; the full amount stays on hover and for screen readers.
  const tileAmount = (value: number | null, currency = project.currency) => {
    if (value === null) return { value: '—' };
    const short = formatShortMoney(value, currency);
    const exact = formatCurrency(value, currency);
    return short === exact ? { value: short } : { value: short, exactValue: exact };
  };
  const budgetUnit = <span className="text-xs text-muted-foreground">{project.currency}{project.tax_treatment && <> · <TaxBasisLabel treatment={project.tax_treatment} showDetails={false} className="text-xs" /></>}</span>;
  const spentExcludedNote = spentExcluded > 0 && totalSpent !== null
    ? t('projectDetail.budget.spentExcludes', 'Spent excludes categories with no Odoo account ({{count}})', { count: spentExcluded })
    : undefined;
  const actualSource = odooActuals.onLedger
    ? t('projectDetail.budget.actualsSourceOdoo', 'Source: the Odoo ledger by budget category. Accounts without a budget category are listed above the table and not counted.')
    : t('projectDetail.budget.actualsSource', 'Source: project finance by category; this is an as-of aggregate, with no transaction trend in this view.');
  const exportRows = (rows: BudgetSummaryRow[], filename: string) => {
    const header = ['Category', `Budget (${selectedCurrency})`, `Spent (${spendCurrency})`, `Committed (${project.currency})`, `Left (${project.currency})`];
    const csv = [header, ...rows.map((row) => {
      const left = compatibleBasis && canSeeActuals && row.spent !== null && canSeeCommitments && row.committed !== null
        ? row.budget - row.spent - row.committed
        : null;
      return [budgetCategoryLabel(row.category, t), row.budget, row.spent ?? '', row.committed ?? '', left ?? ''];
    })].map((line) => line.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const openDraftEditor = () => {
    if (draftVersion) {
      setBudgetView('actual');
      setSelectedVersionId(draftVersion.id);
      setDraftEditorOpen(true);
    }
  };
  const adjustInDraft = () => {
    if (draftVersion) openDraftEditor();
    else {
      closeCategory();
      setBudgetView('actual');
      if (activeVersion && canWrite) requestClone(activeVersion.id);
      else if (canWrite) {
        dismissActivationNotice();
        setShowNewVersionForm(true);
      }
    }
  };

  const actualColumns: Column<(typeof enrichedRows)[number]>[] = [
    {
      key: 'category',
      header: t('financeCopy.category', 'Category'),
      kind: 'primary',
      rowHeader: true,
      size: 250,
      cell: (row) => {
        const name = budgetCategoryLabel(row.category, t);
        return <button type="button" className="min-w-0 truncate text-left font-medium text-foreground underline-offset-2 hover:underline" aria-label={t('projectDetail.budget.openCategory', 'Open {{category}} budget details', { category: name })} onClick={(event) => { event.stopPropagation(); openCategory(row); }}>{name}</button>;
      },
      secondaryCell: () => null,
    },
    {
      key: 'budget', header: t('financeCopy.budget', 'Budget'), kind: 'money', align: 'num', size: 125, minSize: 100,
      cell: (row) => <Tooltip content={t('projectDetail.budget.budgetSource', 'Source: selected budget version line items, grouped by category.')}><span>{formatBudget(row.budget)}</span></Tooltip>,
    },
    {
      key: 'spent', header: t('projectDetail.budget.spent', 'Spent'), kind: 'money', align: 'num', size: 125, minSize: 100,
      cell: (row) => <Tooltip content={actualSource}><span>{canSeeActuals ? formatSpent(row.spent) : '—'}</span></Tooltip>,
    },
    {
      key: 'committed', header: t('projectDetail.budget.committed', 'Committed'), kind: 'money', align: 'num', size: 125, minSize: 100,
      cell: (row) => <Tooltip content={t('projectDetail.budget.committedSource', 'Source: ordered, received, supplier-invoiced and paid procurement totals in the project currency, including those with no budget category.')}><span>{canSeeCommitments ? formatAmount(row.committed) : '—'}</span></Tooltip>,
    },
    {
      key: 'left', header: t('projectDetail.budget.left', 'Left'), kind: 'money', align: 'num', size: 125, minSize: 100,
      cell: (row) => <Tooltip content={t('projectDetail.budget.leftFormula', 'Calculated as budget minus spent and committed.')}><span className={row.left !== null && row.left < 0 ? 'text-destructive-text' : undefined}>{formatAmount(row.left)}</span></Tooltip>,
    },
    {
      key: 'used', header: t('projectDetail.budget.percentUsed', '% used'), kind: 'percent', align: 'num', size: 100, minSize: 80,
      cell: (row) => row.used === null
        ? <Tooltip content={t('projectDetail.budget.utilizationUnknown', 'Utilization is unavailable when budget, spending, or commitments are unknown, or when budget is zero.')}><span>—</span></Tooltip>
        : <Tooltip content={t('projectDetail.budget.utilizationFormula', 'Calculated as (spent + committed) divided by budget.')}><span tabIndex={0}><ProgressBar compact value={Math.round(row.used)} showValue aria-label={t('projectDetail.budget.percentUsedFor', '{{category}} percent used', { category: budgetCategoryLabel(row.category, t) })} /></span></Tooltip>,
    },
    {
      key: 'status', header: t('projectDetail.budget.status', 'Status'), kind: 'status', size: 125, minSize: 112,
      cell: (row) => { const status = getStatus(row); return status ? <StatusPill variant={status.variant}>{status.label}</StatusPill> : null; },
    },
  ];
  const actualTotals = enrichedRows.length ? [{
    key: 'total', label: t('financeCopy.total', 'Total'),
    values: {
      budget: <Tooltip content={t('projectDetail.budget.budgetSource', 'Source: selected budget version line items, grouped by category.')}><span tabIndex={0}>{formatBudget(tableBudgetTotal)}</span></Tooltip>,
      spent: <Tooltip content={actualSource}><span tabIndex={0}>{formatSpent(totalSpent)}</span></Tooltip>,
      committed: <Tooltip content={t('projectDetail.budget.committedSource', 'Source: ordered, received, supplier-invoiced and paid procurement totals in the project currency, including those with no budget category.')}><span tabIndex={0}>{formatAmount(totalCommitted)}</span></Tooltip>,
      left: <Tooltip content={t('projectDetail.budget.leftFormula', 'Calculated as budget minus spent and committed.')}><span tabIndex={0}>{formatAmount(tableLeftTotal)}</span></Tooltip>,
      used: compatibleBasis && tableBudgetTotal && totalSpent !== null && totalCommitted !== null
        ? <Tooltip content={t('projectDetail.budget.utilizationFormula', 'Calculated as (spent + committed) divided by budget.')}><span tabIndex={0}>{Math.round((totalSpent + totalCommitted) / tableBudgetTotal * 100)}%</span></Tooltip>
        : '—',
    },
  }] : [];
  const categoryMenu = (row: (typeof enrichedRows)[number]): RowMenuItem[] => [
    ...(canWrite ? [{ label: t('projectDetail.budget.adjustInDraft', 'Adjust in a draft'), onClick: adjustInDraft }] : []),
    { label: t('projectDetail.budget.exportCategory', 'Export category'), onClick: () => exportRows([row], `Budget_${row.category}`) },
  ];
  const versionRows = orderedVersions.slice().reverse();
  const versionColumns: Column<BudgetVersionWithItems>[] = [
    {
      key: 'version', header: t('projectDetail.budget.version', 'Version'), kind: 'primary', rowHeader: true,
      cell: (version) => <span><span className="font-mono text-xs text-muted-foreground">v{version.version}</span> <span className="font-semibold">{version.name}</span></span>,
      secondaryCell: (version) => versionMeta(version) ? <span className="text-xs text-muted-foreground">{versionMeta(version)}</span> : null,
    },
    { key: 'status', header: t('projectDetail.budget.status', 'Status'), kind: 'status', cell: (version) => <StatusPill variant={budgetVersionVariant(version.status)}>{version.status}</StatusPill> },
    { key: 'total', header: t('financeCopy.total', 'Total'), kind: 'money', align: 'num', cell: (version) => <Tooltip content={t('projectDetail.budget.versionTotalSource', 'Source: sum of the budget line items in this version.')}><span tabIndex={0}>{`${version.currency || project.currency} ${formatAmount(version.total)}`}</span></Tooltip> },
    { key: 'change', header: t('projectDetail.budget.change', 'Change'), kind: 'money', align: 'num', cell: (version) => {
      const index = orderedVersions.findIndex((item) => item.id === version.id);
      const previous = index > 0 ? orderedVersions[index - 1] : null;
      return previous && (version.currency || project.currency) === (previous.currency || project.currency) ? <Tooltip content={t('projectDetail.budget.versionChangeSource', 'Calculated as this version total minus the prior numbered version total.')}><span tabIndex={0} className={version.total > previous.total ? 'text-destructive-text' : undefined}>{version.total > previous.total ? t('projectDetail.budget.changeIncrease', '+') : ''}{`${version.currency || project.currency} ${formatAmount(version.total - previous.total)}`}</span></Tooltip> : '—';
    } },
    ...(canViewBudgetEnforcement ? [{ key: 'accounting', header: t('projectDetail.budget.accountingSystem', 'Accounting system'), cell: (version: BudgetVersionWithItems) => {
      if (version.status !== 'Active') return '—';
      if (pushStatusQuery.isPending) return <span className="text-muted-foreground">{t('projectDetail.budget.checkingPushState', 'Checking')}</span>;
      if (pushStatusQuery.isError) return <span className="inline-flex items-center gap-1 text-muted-foreground">{t('projectDetail.budget.pushStateError', "Couldn't check")}<Button variant="ghost" size="sm" onClick={() => void pushStatusQuery.refetch()}>{t('common.retry', 'Retry')}</Button></span>;
      const states = (pushStatusQuery.data ?? []).filter((row) => row.pushState !== null);
      if (!states.length) return <StatusPill variant="neutral">{t('projectDetail.budget.pushNotEnforced', 'Not enforced')}</StatusPill>;
      const labels: Record<string, { label: string; variant: 'won' | 'warn' | 'lost' | 'progress' }> = {
        pushed: { label: t('financeCopy.enforcedByERPNext', 'Enforced by ERPNext'), variant: 'won' },
        pending: { label: t('projectDetail.budget.pushQueued', 'Queued'), variant: 'progress' },
        pushing: { label: t('projectDetail.budget.pushSending', 'Sending'), variant: 'progress' },
        failed: { label: t('projectDetail.budget.pushFailed', 'Not sent'), variant: 'lost' },
        held: { label: t('projectDetail.budget.pushHeld', 'On hold'), variant: 'warn' },
        'never-pushed': { label: t('projectDetail.budget.neverPushed', 'No ERP budget yet'), variant: 'lost' },
        'unstamped-activation': { label: t('projectDetail.budget.activationDateNeeded', 'Add an activation date'), variant: 'lost' },
      };
      return <span className="flex flex-wrap gap-x-3 gap-y-1">{states.map((row, index) => {
        const state = labels[row.pushState ?? ''] ?? { label: t('projectDetail.budget.pushNotEnforced', 'Not enforced'), variant: 'lost' as const };
        return <StatusPill key={`${row.fiscalYear ?? 'project'}-${index}`} variant={state.variant}>{state.label}{row.fiscalYear ? ` · ${row.fiscalYear}` : ''}</StatusPill>;
      })}</span>;
    } } satisfies Column<BudgetVersionWithItems>] : []),
  ];
  const versionMenu = (version: BudgetVersionWithItems): RowMenuItem[] => [
    { label: t('projectDetail.budget.openVersion', 'Open version'), onClick: () => { setBudgetView('actual'); setSelectedVersionId(version.id); setVersionsOpen(true); } },
    { label: t('projectDetail.budget.compare', 'Compare'), onClick: () => setVersionsOpen(true) },
    ...(!authoringRefreshNeeded && canWrite && !draftVersion && (version.status === 'Active' || version.status === 'Archived') ? [{ label: t('financeCopy.cloneToRevise', 'Clone to revise'), onClick: () => requestClone(version.id) }] : []),
    ...(!authoringRefreshNeeded && canWrite && version.status === 'Active' ? [{ label: t('financeCopy.archive', 'Archive'), onClick: () => requestArchive(version.id), danger: true }] : []),
    ...(!authoringRefreshNeeded && canWrite && version.status === 'Draft' && canActivate ? [{ label: t('financeCopy.activate', 'Activate'), onClick: () => requestActivate(version.id) }] : []),
    ...(!authoringRefreshNeeded && canWrite && version.status === 'Draft' ? [{ label: t('financeCopy.deleteDraft', 'Delete draft'), onClick: () => requestDeleteDraft(version.id), danger: true }] : []),
  ];

  const draftEditor = draftVersion && canWrite ? (
    <section hidden={!draftEditorOpen || selectedVersion?.id !== draftVersion.id || view !== 'actual'} aria-label={t('projectDetail.budget.draftEditor', 'Draft budget editor')} className="min-w-0 space-y-3" data-testid="budget-draft-editor">
      <fieldset disabled={authoringRefreshNeeded} className="min-w-0 space-y-3 border-0 p-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{draftVersion.name} · v{draftVersion.version}</h3>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setModeSwitchOpen(true)}>{t('projectDetail.budget.changeBudgetMode', 'Change budget mode')}</Button>
          <Button variant="ghost" size="sm" onClick={() => setDraftEditorOpen(false)}>{t('common.close', 'Close')}</Button>
        </div>
      </div>
      <BudgetLineItemEditor
        key={draftVersion.id}
        lineItems={draftVersion.line_items}
        currency={draftVersion.currency || project.currency}
        onCreateLineItem={(item) => mutations.createLineItem.mutateAsync({ versionId: draftVersion.id, item })}
        onDeleteLineItem={requestDeleteLineItem}
        onUpdateLineItem={(id, patch) => mutations.updateLineItem.mutateAsync({ id, patch })}
        onOpenBuffersChange={setHasOpenLineBuffers}
        onSaveSuccess={() => toast(t('financeCopy.lineItemUpdated', 'Line item updated'), undefined, 'success')}
        createIsPending={mutations.createLineItem.isPending}
        updateIsPending={mutations.updateLineItem.isPending}
        onSaveError={(error) => {
          const { headline, detail } = classifyMutationError(error);
          toast(headline, detail, 'warning');
        }}
        fiscalYearNames={activationPrecheckQuery.data?.fiscalYearNames ?? null}
        // budget_mode is DB-check-constrained to 'whole_project' | 'per_year'; anything else (a
        // legacy fixture without the column) must behave per_year — the historic default.
        budgetMode={draftMode}
      />
      {draftMode === 'whole_project' && (
        <DistributionGrid
          versionId={draftVersion.id}
          lines={draftVersion.line_items}
          projectStart={project.start_date}
          projectEnd={project.end_date}
          fiscalYears={fiscalYears}
          currency={draftVersion.currency || project.currency}
          editorIdentity={`${currentUserId ?? 'anonymous'}:${realRole}:${canWrite}`}
          savedPlan={budgetDistributionQuery.data ?? null}
          savedPlanLoading={budgetDistributionQuery.isPending || budgetDistributionQuery.isFetching}
          savedPlanError={budgetDistributionQuery.isError}
          saving={mutations.saveDistribution.isPending}
          writesDisabled={authoringRefreshNeeded}
          onRetryRead={() => { void budgetDistributionQuery.refetch(); }}
          onReadinessChange={acceptDistributionReadiness}
          onSave={saveDistribution}
        />
      )}
      </fieldset>
    </section>
  ) : null;
  const readonlyDistributionReadiness = draftVersion && draftMode === 'whole_project' && !canWrite ? (
    <div hidden aria-hidden="true">
      <DistributionGrid
        versionId={draftVersion.id}
        lines={draftVersion.line_items}
        projectStart={project.start_date}
        projectEnd={project.end_date}
        fiscalYears={fiscalYears}
        currency={draftVersion.currency || project.currency}
        editorIdentity={`${currentUserId ?? 'anonymous'}:${realRole}:read-only`}
        savedPlan={budgetDistributionQuery.data ?? null}
        savedPlanLoading={budgetDistributionQuery.isPending || budgetDistributionQuery.isFetching}
        savedPlanError={budgetDistributionQuery.isError}
        editable={false}
        onReadinessChange={acceptDistributionReadiness}
        onSave={async () => false}
      />
    </div>
  ) : null;

  if (!canReadMoney) {
    return (
      <Card data-testid="budget-option-a">
        <CardHead id="budget-title">{t('projectDetail.budget.title', 'Project budget')}</CardHead>
        <CardPad><p className="text-sm text-muted-foreground">{t('projectDetail.budget.noMoneyAccess', 'Budget details are available to project management and finance.')}</p></CardPad>
      </Card>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-[var(--space-panel-gap)]" data-testid={versions.length === 0 ? 'budget-empty' : 'budget-option-a'}>
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        {/* Project currency and tax basis apply to project spending and commitments. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <h2 className="text-page font-bold tracking-[-0.02em] text-foreground">{t('projectDetail.budget.title', 'Project budget')}</h2>
          {budgetUnit}
        </div>
      </header>

      {authoringRecoveryNotice}

      {activeVersion && staleActivePlan && (
        <section aria-label={t('projectDetail.budget.staleDistributionTitle', 'Budget no longer covers the project')} className="panel-card flex min-w-0 flex-wrap items-center justify-between gap-3 p-[var(--panel-inset)]" data-testid="budget-stale-distribution">
          <p role="status" className="min-w-0 text-sm text-foreground">
            {staleActivePlan.projectEnd
              ? t('projectDetail.budget.staleDistribution', 'The project now runs to {{date}}; this budget covers {{years}}.', { date: staleActivePlan.projectEnd, years: staleActivePlan.coveredYears.join(', ') })
              : t('projectDetail.budget.staleDistributionOpenEnd', 'The project no longer has an end date; this budget covers {{years}}.', { years: staleActivePlan.coveredYears.join(', ') })}
          </p>
          {canWrite && !draftVersion && !authoringRefreshNeeded && (
            <Button variant="outline" size="sm" onClick={() => requestClone(activeVersion.id)}>{t('projectDetail.budget.prepareNewDraft', 'Prepare new draft')}</Button>
          )}
        </section>
      )}

      {draftVersion && (
        <section aria-label={t('projectDetail.budget.draftWaiting', 'Draft waiting for approval')} className="panel-card flex min-w-0 flex-wrap items-center justify-between gap-3 p-[var(--panel-inset)]" data-testid="budget-draft-banner">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <StatusPill variant="draft">{t('financeCopy.statusDraft', 'Draft')}</StatusPill>
              <h3 className="font-semibold">{t('projectDetail.budget.draftWaiting', 'Draft waiting for approval')}</h3>
              <span className="text-sm text-muted-foreground">{draftVersion.name} · v{draftVersion.version}</span>
            </div>
            {!canActivate && <p role="status" className="mt-1 text-sm text-muted-foreground">{activateBlockedReason ?? t('projectDetail.budget.waitingForFinance', 'Waiting for approval by finance')}</p>}
            {canActivate && !hasOpenLineBuffers && <p className="mt-1 text-sm text-muted-foreground">{t('projectDetail.budget.draftReady', 'This draft is ready for an eligible approver to activate.')}</p>}
            {canActivate && hasOpenLineBuffers && <p role="status" className="mt-1 text-sm text-muted-foreground">{t('projectDetail.budget.saveOrDiscardLines', 'Save or discard all open line item edits before activating.')}</p>}
            <div data-testid="budget-readiness-summary" aria-live="polite" className="mt-2 text-[13px] text-muted-foreground">
              {readinessMessages.map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}
            </div>
            {!canWrite && draftMode === 'whole_project' && budgetDistributionQuery.isError && (
              <Button variant="outline" size="sm" className="mt-2" onClick={() => { void budgetDistributionQuery.refetch(); }}>
                {t('projectDetail.budget.retryDistributionRead', 'Retry saved distribution read')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {canWrite && <Button variant="outline" size="sm" onClick={() => { setSelectedVersionId(draftVersion.id); setDraftEditorOpen(true); }}>{t('projectDetail.budget.editDraft', 'Edit draft')}</Button>}
            {canActivate && !authoringRefreshNeeded && <Button variant="primary" size="sm" disabled={hasOpenLineBuffers || (draftMode === 'whole_project' && distributionReadinessStatus !== 'current')} onClick={() => requestActivate(draftVersion.id)}>{t('projectDetail.budget.activateVersionNamed', 'Activate v{{version}}', { version: draftVersion.version })}</Button>}
          </div>
        </section>
      )}
      {/* SUB-D: with no versions at all, the empty state below says it once. */}
      {!activeVersion && versions.length > 0 && <p role="status" className="text-sm text-muted-foreground">{t('projectDetail.budget.noActiveBudget', 'No active budget')}</p>}

      {showNewVersionForm && canWrite && newVersionForm}

      {versions.length === 0 && <ListState variant="empty" icon="dollar" title={t('financeCopy.noBudgetVersionsYet', 'No budget versions yet')} sub={t('financeCopy.createADraftVersionToStartPlanningTheProjectBudget', 'Create a Draft version to start planning the project budget.')} action={canWrite ? { label: t('projectDetail.budget.createBudget', 'Create budget'), onClick: () => { dismissActivationNotice(); setShowNewVersionForm(true); } } : undefined} />}

      <KPIRow aria-label={t('projectDetail.budget.figures', 'Budget figures')} className="grid-cols-2 lg:grid-cols-4">
        <KPITile icon="dollar" tone="blue" label={t('financeCopy.budget', 'Budget')} {...tileAmount(totalBudget, activeBudgetCurrency)} help={t('projectDetail.budget.activeBudgetSource', 'Source: active budget version line items, grouped by category.')} />
        <KPITile icon="chart-column" tone="violet" label={t('projectDetail.budget.spent', 'Spent')} {...tileAmount(totalSpent, spendCurrency)} vs={spentExcludedNote} unavailableReason={totalSpent === null ? t('projectDetail.budget.spendingUnavailable', 'Spending is unknown or unavailable.') : undefined} help={actualSource} />
        <KPITile icon="invoices" tone="amber" label={t('projectDetail.budget.committed', 'Committed')} {...tileAmount(totalCommitted)} unavailableReason={totalCommitted === null ? t('projectDetail.budget.commitmentsUnavailable', 'Commitments are unknown or unavailable.') : undefined} help={t('projectDetail.budget.committedSource', 'Source: ordered, received, supplier-invoiced and paid procurement totals in the project currency, including those with no budget category.')} />
        <KPITile icon="down" tone={totalLeft !== null && totalLeft < 0 ? 'red' : 'green'} label={t('projectDetail.budget.left', 'Left')} {...tileAmount(totalLeft)} vs={spentExcludedNote} negative={totalLeft !== null && totalLeft < 0} unavailableReason={totalLeft === null ? (compatibleBasis ? t('projectDetail.budget.leftUnavailable', 'Left is unknown while spending or commitments are unavailable.') : t('projectDetail.budget.currencyComparisonUnavailable', 'Comparison unavailable because budget and spending use different currencies.')) : undefined} help={t('projectDetail.budget.leftFormula', 'Calculated as budget minus spent and committed.')} />
      </KPIRow>

      <Card role="region" aria-label={t('projectDetail.budget.budgetVsActual', 'Budget vs actual')} className="min-w-0">
        <CardHead className="pb-1">{t('projectDetail.budget.budgetVsActual', 'Budget vs actual')}</CardHead>
        <CardPad className="space-y-3 pt-2">
        {selectedRows.size > 0 && view === 'actual' ? (
          <div className="flex min-w-0 flex-wrap items-center gap-2" role="toolbar" aria-label={t('projectDetail.budget.selectedCategories', 'Selected categories')}>
            <span className="text-sm font-medium">{t('projectDetail.budget.selectedCount', '{{count}} selected', { count: selectedRows.size })}</span>
            {canWrite && <Button variant="outline" size="sm" onClick={adjustInDraft}>{t('projectDetail.budget.adjustInDraft', 'Adjust in a draft')}</Button>}
            <Button variant="outline" size="sm" onClick={() => exportRows(enrichedRows.filter((row) => selectedRows.has(row.category)), 'ProjectBudgetSelected')}>{t('projectDetail.budget.exportRows', 'Export rows')}</Button>
            <Button variant="ghost" size="sm" onClick={() => setSelectedRows(new Set())}>{t('common.clear', 'Clear')}</Button>
          </div>
        ) : <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <ViewToggle
              ariaLabel={t('projectDetail.budget.budgetView', 'Budget view')}
              value={view}
              onChange={(next) => { setBudgetView(next); setSelectedRows(new Set()); if (next === 'forecast') setDraftEditorOpen(false); }}
              options={[
                { value: 'actual', label: t('projectDetail.budget.budgetVsActual', 'Budget vs actual') },
                ...(hasActiveErpBinding && activeVersion ? [{ value: 'forecast' as const, label: t('projectDetail.budget.forecast', 'Forecast') }] : []),
              ]}
            />
            <span className="text-xs font-medium text-muted-foreground">{view === 'actual' ? t('projectDetail.budget.wholeProject', 'Whole project') : t('projectDetail.budget.fiscalYearInForecast', 'Fiscal year in forecast')}</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span>{t('projectDetail.budget.version', 'Version')}</span>
              <select aria-label={t('projectDetail.budget.version', 'Version')} value={selectedVersion?.id ?? ''} disabled={view === 'forecast'} onChange={(event) => { setSelectedVersionId(event.target.value); setDraftEditorOpen(false); }} className="h-[30px] max-w-52 rounded-md border border-input bg-background px-2 text-xs text-foreground disabled:opacity-70">
                {versions.map((version) => <option key={version.id} value={version.id}>v{version.version} · {version.status}</option>)}
              </select>
            </label>
            <div className="h-4 w-px bg-border" aria-hidden="true" />
            {canWrite && !authoringRefreshNeeded && activeVersion && !draftVersion && <Button variant="outline" size="sm" onClick={() => requestClone(activeVersion.id)}>{t('projectDetail.budget.updateBudget', 'Update budget')}</Button>}
            {view === 'actual' && <Button variant="outline" size="sm" onClick={() => exportRows(enrichedRows, 'ProjectBudget')}>{t('projectDetail.budget.export', 'Export')}</Button>}
          </div>
        </div>}
        {view === 'actual' && selectedVersion && selectedVersion.status !== 'Active' && <p className="text-sm text-muted-foreground">{t('projectDetail.budget.viewingVersion', 'Viewing {{status}} v{{version}}; project spending and commitments reflect the current project totals.', { status: selectedVersion.status, version: selectedVersion.version })}</p>}
        {draftEditor}
      {readonlyDistributionReadiness}
        {view === 'actual' ? (
          selectedVersion ? <>
            {!compatibleBasis && <p role="status" className="text-sm text-muted-foreground">{t('projectDetail.budget.currencyBasisNotice', 'Budget: {{budgetCurrency}}. Spending and commitments: {{projectCurrency}}. Comparisons are unavailable across currencies.', { budgetCurrency: selectedCurrency, projectCurrency: project.currency })}</p>}
            <BudgetOdooActuals projectId={projectId} />
            <DataTable
              embedded
              rows={enrichedRows}
              columns={actualColumns}
              rowKey={(row) => row.category}
              onActivate={openCategory}
              selectedKey={selectedCategory?.category}
              selection={{
                selectedIds: selectedRows,
                onChange: setSelectedRows,
                rowLabel: (row) => t('projectDetail.budget.selectCategory', 'Select {{category}}', { category: budgetCategoryLabel(row.category, t) }),
              }}
              rowMenu={categoryMenu}
              tableId="project-budget-option-a"
              accessibleName={t('projectDetail.budget.actualTable', 'Budget vs actual by category')}
              cardBelow={600}
              totals={actualTotals}
              emptyTitle={t('projectDetail.budget.noCategories', 'No budget categories in this version')}
              emptySub={t('projectDetail.budget.noCategoriesSub', 'Add budget lines to show the category breakdown.')}
            />
            {position.actualsPending && <p role="status" className="text-sm text-muted-foreground">{t('projectDetail.cost.spendingChecking', 'Checking spending…')}</p>}
            {position.actualsError && <p role="status" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">{t('projectDetail.budget.actualsError', "Couldn't check spending.")}<Button variant="ghost" size="sm" onClick={() => void position.refetchActuals()}>{t('common.retry', 'Retry')}</Button></p>}
            {canSeeActuals && position.unknown > 0 && !position.currencyDiffers && !position.actualsPending && !position.actualsError && <p className="text-sm text-muted-foreground">{t('projectDetail.cost.spendingUnlinked', "Spending isn't linked yet.")} {canManageAccounting ? <a href="/administration/accounting#budget-account-map" className="font-medium text-primary-text underline underline-offset-2">{t('projectDetail.cost.finishSetup', 'Finish spending setup')}</a> : t('projectDetail.cost.askAdmin', 'An administrator can finish the setup.')}</p>}
          </> : versions.length === 0 ? null : <ListState variant="empty" title={t('projectDetail.budget.noActiveBudget', 'No active budget')} sub={t('financeCopy.createADraftVersionToStartPlanningTheProjectBudget', 'Create a Draft version to start planning the project budget.')} />
        ) : activeVersion ? <><AttributedSpendingNote projectId={projectId} /><BudgetProjection projectId={projectId} orgId={currentUser?.org_id} budgetVersionId={activeVersion.id} projectStartDate={project.start_date ?? null} projectEndDate={project.end_date ?? null} budgetMode={activeVersion.budget_mode} approvedBudgetYears={approvedBudgetYears} currency={project.currency} budgetCurrency={activeBudgetCurrency} canEdit={canWrite} committedByCategory={Object.fromEntries(summaryRows.map((row) => [row.category, canSeeCommitments ? row.committed : null]))} canReadCommitments={canSeeCommitments} onAdjustInDraft={adjustInDraft} onExport={(payload: BudgetProjectionExport) => {
          const csv = buildBudgetProjectionCsv(payload, {
            budgetCurrency: activeBudgetCurrency,
            projectCurrency: project.currency,
            categoryLabel: (category) => budgetCategoryLabel(category, t),
          });
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
          const link = document.createElement('a'); link.href = url; link.download = payload.scope.kind === 'all' ? 'ProjectBudgetComparison.csv' : 'ProjectBudgetForecast.csv'; link.click(); URL.revokeObjectURL(url);
        }} /></> : <ListState variant="empty" title={t('projectDetail.budget.forecastNeedsActive', 'Activate a budget to view its forecast')} />}
        </CardPad>
      </Card>

      <Card role="region" aria-label={t('projectDetail.budget.versionsTitle', 'Budget versions')} className="min-w-0">
        <CardHead actions={<>
            {canWrite && !authoringRefreshNeeded && versions.length > 0 && !draftVersion && <Button variant="outline" size="sm" onClick={() => { dismissActivationNotice(); setShowNewVersionForm(true); }}>{t('projectDetail.budget.newVersion', 'New version')}</Button>}
            {versions.length > 0 && <Button id="budget-versions-trigger" variant="ghost" size="sm" onClick={() => setVersionsOpen(true)}>{t('projectDetail.budget.manageVersions', 'Manage versions')}</Button>}
          </>}>
          {t('projectDetail.budget.versionsTitle', 'Budget versions')}
        </CardHead>
        {versions.length > 0 ? <DataTable
          embedded
          rows={versionRows}
          columns={versionColumns}
          rowKey={(version) => version.id}
          onActivate={(version) => { setBudgetView('actual'); setSelectedVersionId(version.id); setVersionsOpen(true); }}
          selectedKey={selectedVersion?.id}
          rowMenu={versionMenu}
          tableId="project-budget-versions-card"
          accessibleName={t('projectDetail.budget.versionsTitle', 'Budget versions')}
          cardBelow={600}
        /> : null}
      </Card>

      {versions.some((version) => version.status === 'Archived') && archiveTargetsLoading && (
        <p role="status" className="text-sm text-muted-foreground">{t('budgetArchive.checkingArchivedBudget', 'Checking archived budget status…')}</p>
      )}
      {versions.some((version) => version.status === 'Archived') && !archiveTargetsLoading && archiveTargetsQuery.isError && (
        <div role="alert" className="rounded-lg border border-warning/30 bg-warning/[0.07] px-3.5 py-3 text-sm text-foreground">
          <p>{t('budgetArchive.archivedBudgetStatusError', 'Could not check archived budget status.')}</p>
          <Button variant="ghost" size="sm" onClick={() => void archiveTargetsQuery.refetch()}>{t('budgetArchive.retryArchivedBudget', 'Retry archived budget check')}</Button>
        </div>
      )}
      {!archiveTargetsLoading && !archiveTargetsQuery.isError && archivedLiveTargets.length > 0 && (
        <div role="alert" className="rounded-lg border border-warning/30 bg-warning/[0.07] px-3.5 py-3 text-sm text-foreground">
          {t('budgetArchive.archivedBudgetStillLiveInErp')}
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground" aria-label={t('budgetArchive.stillLiveListAria', 'ERPNext Budget documents that may still be live')}>
            {archivedLiveTargets.map((target, index) => {
              const yearLabel = target.to_fiscal_year
                ? `${target.fiscal_year}–${target.to_fiscal_year}`
                : target.fiscal_year;
              const status = target.push_state === 'pending'
                ? { label: t('projectDetail.budget.pushQueued', 'Queued'), variant: 'progress' as const }
                : target.push_state === 'held'
                  ? { label: t('projectDetail.budget.pushHeld', 'On hold'), variant: 'warn' as const }
                  : target.push_state === 'failed'
                    ? { label: t('projectDetail.budget.pushFailed', 'Not sent'), variant: 'lost' as const }
                    : null;
              return (
                <li key={`${target.source_kind}:${target.fiscal_year}:${target.erp_budget_name}:${index}`} className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>{target.source_kind === 'legacy'
                    ? t('budgetArchive.legacyTargetLine', '{{year}} — {{name}} (older push)', { year: yearLabel, name: target.erp_budget_name })
                    : t('budgetArchive.targetLine', '{{year}} — {{name}}', { year: yearLabel, name: target.erp_budget_name })}</span>
                  {status && <StatusPill variant={status.variant}>{status.label}</StatusPill>}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canViewBudgetEnforcement && <details className="rounded-lg border border-border bg-card p-3 sm:p-4">
        <summary className="touch-target cursor-pointer text-sm font-semibold">{t('projectDetail.budget.sourcesEnforcement', 'Sources and budget enforcement')}</summary>
        <div className="mt-3 space-y-3">
          <p className="text-sm text-muted-foreground">{t('projectDetail.budget.sourceDescription', 'Budget totals come from version line items. Spent comes from project finance. Commitments come from qualifying procurement records. Forecasts use the ERP ledger and estimates for the selected client fiscal year.')}</p>
          <BudgetErpNotice
            projectId={projectId}
            activeVersion={activeVersion}
            hasDraft={Boolean(draftVersion)}
            onOpenDraft={canWrite ? (draftVersionId) => { setBudgetView('actual'); setSelectedVersionId(draftVersionId); setDraftEditorOpen(true); } : undefined}
            onRecover={!canWrite ? undefined : () => {
              setBudgetView('actual');
              if (draftVersion) {
                setSelectedVersionId(draftVersion.id);
                setDraftEditorOpen(true);
              } else if (activeVersion) {
                requestClone(activeVersion.id);
              }
            }}
          />
        </div>
      </details>}

      <Drawer
        open={Boolean(selectedCategory)}
        title={selectedCategory ? budgetCategoryLabel(selectedCategory.category, t) : ''}
        icon={<Icon name="dollar" />}
        status={selectedCategory && (() => { const status = getStatus(selectedCategory); return status ? <StatusPill variant={status.variant}>{status.label}</StatusPill> : undefined; })()}
        onClose={closeCategory}
        width="lg"
        nestedOpen={Boolean(pendingConfirm)}
        headerActions={selectedCategory && <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          {canWrite && <Button variant="primary" size="sm" onClick={adjustInDraft}>{t('projectDetail.budget.adjustInDraft', 'Adjust in a draft')}</Button>}
          <Link className="touch-target inline-flex min-h-9 items-center rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground hover:bg-accent" to={`/projects/${encodeURIComponent(projectId)}/budget`}>{t('projectDetail.budget.openFullPage', 'Open full page')}</Link>
          {/* B1: the same drawer header as every record — main action · Open full page · ⋯. */}
          <MenuButton items={[{ label: t('projectDetail.budget.exportCategory', 'Export category'), onClick: () => exportRows([selectedCategory], `Budget_${selectedCategory.category}`) }]}
            ariaLabel={t('projectDetail.budget.categoryActions', '{{category}} actions', { category: budgetCategoryLabel(selectedCategory.category, t) })} />
        </div>}
      >
        {selectedCategory && <div className="space-y-5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <h2 className="text-sm font-semibold">{t('projectDetail.budget.categoryFigures', 'Figures')}</h2>
            {budgetUnit}
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {[
              [t('financeCopy.budget', 'Budget'), formatBudget(selectedCategory.budget), t('projectDetail.budget.budgetSource', 'Source: selected budget version line items, grouped by category.')],
              [t('projectDetail.budget.spent', 'Spent'), canSeeActuals ? formatAmount(selectedCategory.spent) : '—', actualSource],
              [t('projectDetail.budget.committed', 'Committed'), canSeeCommitments ? formatAmount(selectedCategory.committed) : '—', t('projectDetail.budget.committedSource', 'Source: ordered, received, supplier-invoiced and paid procurement totals in the project currency, including those with no budget category.')],
              [t('projectDetail.budget.left', 'Left'), formatAmount(selectedCategory.left), t('projectDetail.budget.leftFormula', 'Calculated as budget minus spent and committed.')],
            ].map(([label, value, source]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 font-semibold tabular-nums"><Tooltip content={source}><span tabIndex={0}>{value}</span></Tooltip></dd></div>)}
          </dl>
          {/* C4: cost to finish and forecast final are per fiscal year, so they live in Forecast — pointed to, not printed as placeholders. */}
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            {t('projectDetail.budget.forecastPointer', 'Cost to finish and forecast final are set per fiscal year in Forecast.')}
            {hasActiveErpBinding && activeVersion && <button type="button" className="touch-target rounded-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => setBudgetView('forecast')}>{t('projectDetail.budget.openForecast', 'Open Forecast')}</button>}
          </p>
          {selectedCategory.used !== null && <div className="flex flex-col items-start gap-1.5"><Tooltip content={t('projectDetail.budget.utilizationFormula', 'Calculated as (spent + committed) divided by budget.')}><span tabIndex={0} className="text-sm font-medium">{t('projectDetail.budget.percentUsed', '% used')}</span></Tooltip><ProgressBar value={Math.round(selectedCategory.used)} showValue aria-label={t('projectDetail.budget.percentUsedFor', '{{category}} percent used', { category: budgetCategoryLabel(selectedCategory.category, t) })} /></div>}
          <section aria-labelledby="budget-records-heading" className="space-y-2">
            <h2 id="budget-records-heading" className="text-sm font-semibold">{t('projectDetail.budget.recordsBehindSpending', 'Records behind the spending')}</h2>
            <BudgetOdooCategoryLines projectId={projectId} category={selectedCategory.category} fallback={
              <p className="text-sm text-muted-foreground">{t('projectDetail.budget.ledgerRowsUnavailable', 'Transaction-level ledger records are unavailable in the project finance summary.')}</p>
            } />
          </section>
          <section aria-labelledby="budget-category-lines-heading" className="space-y-2">
            <h2 id="budget-category-lines-heading" className="text-sm font-semibold">{t('projectDetail.budget.budgetLineItems', 'Budget line items')}</h2>
            <ul className="divide-y divide-border" aria-label={t('projectDetail.budget.budgetLineItems', 'Budget line items')}>
              {selectedCategory.lines.map((line) => <li key={line.id ?? `${line.category}-${line.description}`} className="flex min-w-0 items-start justify-between gap-3 py-2 text-sm"><span className="min-w-0 break-words text-muted-foreground">{line.description || '—'}<span className="ml-2 text-xs">{t('financeCopy.fiscalYear', 'Fiscal year')}: {line.fiscal_year ?? t('financeCopy.unPhased', 'Un-phased')}</span></span><Tooltip content={t('projectDetail.budget.budgetLineSource', 'Source: selected budget version line item.')}><span tabIndex={0} className="shrink-0 tabular-nums">{formatBudget(Number(line.budgeted_amount))}</span></Tooltip></li>)}
              {selectedCategory.lines.length === 0 && <li className="py-2 text-sm text-muted-foreground">{t('projectDetail.budget.noLineItems', 'No budget line items are recorded for this category.')}</li>}
            </ul>
          </section>
          <section aria-labelledby="budget-notes-heading" className="space-y-2">
            <h2 id="budget-notes-heading" className="text-sm font-semibold">{t('projectDetail.budget.notes', 'Notes')}</h2>
            <p className="text-sm text-muted-foreground">{t('projectDetail.budget.categoryNotesUnavailable', 'No category notes are recorded.')}</p>
          </section>
        </div>}
      </Drawer>

      <BudgetVersionsDrawer
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        versions={versions}
        fallbackCurrency={project.currency}
        canWrite={canWrite}
        hasDraft={Boolean(draftVersion)}
        nestedOpen={Boolean(pendingConfirm)}
        readinessSummary={draftVersion ? (
          <div data-testid="budget-readiness-summary" aria-live="polite" className="mt-2 text-[13px] text-muted-foreground">
            {readinessMessages.map((message, index) => <p key={`${index}-${message}`}>{message}</p>)}
          </div>
        ) : null}
        onArchive={requestArchive}
        onClone={requestClone}
        onDeleteDraft={requestDeleteDraft}
      />
      {draftVersion && (
        <BudgetModeSwitchDialog
          open={modeSwitchOpen && !authoringRefreshNeeded}
          versionId={draftVersion.id}
          currentMode={draftMode}
          lines={draftVersion.line_items}
          fiscalYearNames={fiscalYearNames}
          currency={draftVersion.currency || project.currency}
          contextKey={modeSwitchContextKey}
          loading={mutations.switchDraftMode.isPending}
          onConfirm={changeDraftMode}
          onCancel={() => setModeSwitchOpen(false)}
        />
      )}
      {!authoringRefreshNeeded && budgetConfirm}
    </div>
  );
};

export default ProjectBudget;

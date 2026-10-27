import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { Button, ConfirmDialog, ListState, StatusPill, useToast } from '@/src/components/ui';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { formatInstantDate, formatNumberWhole } from '@/src/lib/format';
import { budgetVersionVariant } from '@/src/lib/status/statusVariants';
import { useBudgetActivationMode, useBudgetMutations, useBudgetVersions, useProjectBudget } from '@/src/hooks/useBudget';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { useBudgetPosition } from '../useProjectPosition';
import { buildBudgetSummaryRows, compareBudgetVersions } from '../budget/budgetModel';
import { useUsers } from '@/src/hooks/useUsers';

interface BudgetBProps {
  projectId: string;
  project: ProjectWithRefs;
}

type PendingAction =
  | { kind: 'activate'; version: BudgetVersionWithItems }
  | { kind: 'clone'; version: BudgetVersionWithItems }
  | { kind: 'create'; name: string };

const BudgetB: React.FC<BudgetBProps> = ({ projectId, project }) => {
  const { t } = useTranslation();
  const can = usePermission();
  const { currentUser } = useAuth();
  const usersQuery = useUsers();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const budgetQuery = useProjectBudget(projectId);
  const versionsQuery = useBudgetVersions(projectId);
  const mutations = useBudgetMutations(projectId);
  const canReadMoney = can('view', 'salesInvoice');
  const canReadProcurements = can('view', 'procurement');
  const position = useBudgetPosition(project);
  const procurementsQuery = useProjectProcurements(canReadProcurements ? projectId : null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [newVersionName, setNewVersionName] = useState('');

  const versions = useMemo(
    () => (versionsQuery.data ?? []) as BudgetVersionWithItems[],
    [versionsQuery.data],
  );
  const activeVersion = versions.find((version) => version.status === 'Active');
  const draftVersion = versions.find((version) => version.status === 'Draft');
  const activationMode = useBudgetActivationMode(draftVersion?.id);
  const canWrite = can('edit', 'budgetLine');
  const canActivate = Boolean(draftVersion && (
    activationMode.data === 'sole_operator'
    || can('transition', 'budgetVersion', {
      currentUserId: currentUser?.id ?? null,
      record: {
        status: draftVersion.status,
        created_by: draftVersion.created_by,
        editor_ids: draftVersion.editor_ids,
      },
    })
  ));

  const railVersions = useMemo(() => {
    const ascending = [...versions].sort((left, right) => left.version - right.version);
    return [
      ...(draftVersion ? [draftVersion] : []),
      ...ascending.filter((version) => version.id !== draftVersion?.id).reverse(),
    ];
  }, [versions, draftVersion]);
  const selectedVersion = versions.find((version) => version.id === selectedId)
    ?? draftVersion
    ?? activeVersion
    ?? railVersions[0];
  const headlineVersion = activeVersion ?? draftVersion;
  const ordered = [...versions].sort((left, right) => left.version - right.version);
  const selectedIndex = selectedVersion ? ordered.findIndex((version) => version.id === selectedVersion.id) : -1;
  const previousVersion = selectedIndex > 0 ? ordered[selectedIndex - 1] : undefined;
  const comparison = selectedVersion && previousVersion
    ? compareBudgetVersions(previousVersion.line_items, selectedVersion.line_items)
    : [];
  const activeIndex = activeVersion ? ordered.findIndex((version) => version.id === activeVersion.id) : -1;
  const priorActive = activeIndex > 0 ? ordered[activeIndex - 1] : undefined;
  const headlineChange = activeVersion && priorActive
    ? activeVersion.total - priorActive.total
    : null;
  const activeRows = useMemo(() => activeVersion && canReadMoney
    ? buildBudgetSummaryRows({
      lines: activeVersion.line_items,
      actuals: position.rows,
      procurements: procurementsQuery.data,
      canReadProcurements: canReadProcurements && !procurementsQuery.isPending && !procurementsQuery.isError,
      currency: project.currency,
    })
    : [], [activeVersion, canReadMoney, position.rows, procurementsQuery.data, procurementsQuery.isPending, procurementsQuery.isError, canReadProcurements, project.currency]);

  if (budgetQuery.isPending || versionsQuery.isPending) {
    return <div data-testid="budget-loading"><ListState variant="loading" rows={4} /></div>;
  }
  if (budgetQuery.isError || versionsQuery.isError) {
    return (
      <ListState
        variant="error"
        title={t('financeCopy.budgetLoadFailed', "Couldn't load budget")}
        sub={t('financeCopy.somethingWentWrongFetchingTheBudgetData', 'Something went wrong fetching the budget data.')}
        onRetry={() => { void budgetQuery.refetch(); void versionsQuery.refetch(); }}
      />
    );
  }

  const versionLabel = (version: BudgetVersionWithItems) => `${version.name} (v${version.version})`;
  const commitAction = async () => {
    if (!pendingAction) return;
    try {
      if (pendingAction.kind === 'activate') {
        const { pushState } = await mutations.activate.mutateAsync(pendingAction.version.id);
        void queryClient.invalidateQueries({ queryKey: ['budget-push-status', projectId] });
        if (pushState === 'failed') {
          toast(t('financeCopy.versionActivatedERPNotUpdated', 'Version activated — but ERPNext was not updated'), undefined, 'warning');
        } else if (pushState === 'nothing-to-push') {
          toast(t('financeCopy.versionActivatedNothingSent', 'Version activated — nothing was sent to ERPNext'), undefined, 'warning');
        } else {
          toast(t('financeCopy.versionActivated', 'Version activated'), versionLabel(pendingAction.version), 'success');
        }
      } else if (pendingAction.kind === 'clone') {
        await mutations.cloneVersion.mutateAsync(pendingAction.version.id);
        toast(t('financeCopy.versionCloned', 'Version cloned'), t('financeCopy.newDraftFrom', 'New draft from {{version}}', { version: versionLabel(pendingAction.version) }), 'success');
      } else {
        await mutations.createVersion.mutateAsync({ projectId, name: pendingAction.name });
        setNewVersionName('');
        toast(t('financeCopy.budgetVersionCreated', 'Budget version created'), pendingAction.name, 'success');
      }
    } catch (error) {
      toast(t('financeCopy.actionFailed', 'Action failed'), error instanceof Error ? error.message : undefined, 'warning');
    } finally {
      setPendingAction(null);
    }
  };

  const busy = mutations.activate.isPending || mutations.cloneVersion.isPending || mutations.createVersion.isPending;
  const answer = activeVersion && canReadMoney
    ? `Active v${activeVersion.version} · ${formatNumberWhole(activeVersion.total)}${headlineChange === null ? '' : ` · ${headlineChange > 0 ? '+' : ''}${formatNumberWhole(headlineChange)} vs v${priorActive?.version}`}`
    : activeVersion
      ? t('projectDetail.budget.availableToFinance', 'Budget details are available to project management and finance.')
      : draftVersion && canReadMoney
        ? `Draft v${draftVersion.version} · ${formatNumberWhole(draftVersion.total)}`
        : draftVersion
          ? t('projectDetail.budget.availableToFinance', 'Budget details are available to project management and finance.')
          : t('projectDetail.budget.noActiveBudget', 'No active budget');

  const getAuthorLabel = (version: BudgetVersionWithItems) => version.created_by === currentUser?.id
    ? t('common.you', 'You')
    : usersQuery.data?.find((user) => user.id === version.created_by)?.full_name
      ?? t('projectDetail.budget.projectTeam', 'Project team');
  const statusLabel = (status: BudgetVersionWithItems['status']) => {
    const labels: Record<BudgetVersionWithItems['status'], string> = {
      Draft: t('financeCopy.statusDraft', 'Draft'),
      Active: t('financeCopy.statusActive', 'Active'),
      Archived: t('financeCopy.statusArchived', 'Archived'),
    };
    return labels[status];
  };

  return (
    <div className="min-w-0 space-y-5" data-testid="budget-option-b">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('projectDetail.budget.title', 'Project budget')}</h2>
          {canReadMoney && <p className="mt-1 text-xs text-muted-foreground">{project.currency}</p>}
        </div>
        {activeVersion && !draftVersion && canWrite && (
          <Button variant="outline" size="sm" onClick={() => setPendingAction({ kind: 'clone', version: activeVersion })}>
            {t('projectDetail.budget.updateBudget', 'Update budget')}
          </Button>
        )}
      </header>

      <p className="text-xl font-semibold tabular-nums" data-testid="budget-answer">{answer}</p>
      {activeVersion && !canReadMoney && (
        <p className="text-sm text-muted-foreground">{t('projectDetail.budget.noMoneyAccess', 'Budget amounts are available to project management and finance.')}</p>
      )}

      {!versions.length && canWrite && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (newVersionName.trim()) setPendingAction({ kind: 'create', name: newVersionName.trim() });
        }}>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t('financeCopy.versionName', 'Version name')}
            <input value={newVersionName} onChange={(event) => setNewVersionName(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
          </label>
          <Button variant="outline" type="submit" disabled={!newVersionName.trim()}>{t('projectDetail.budget.createBudget', 'Create budget')}</Button>
        </form>
      )}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,1.6fr)]">
        <nav aria-label={t('projectDetail.budget.versionsTitle', 'Budget versions')} className="min-w-0">
          <h3 className="mb-2 text-sm font-semibold">{t('projectDetail.budget.versionsTitle', 'Budget versions')}</h3>
          {railVersions.length === 0 ? (
            <p className="border-t border-border py-3 text-sm text-muted-foreground">{t('financeCopy.noBudgetVersionsYet', 'No budget versions yet')}</p>
          ) : (
            <ol className="divide-y divide-border border-y border-border">
              {railVersions.map((version) => {
                const selected = version.id === selectedVersion?.id;
                return (
                  <li key={version.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setSelectedId(version.id)}
                      className={`touch-target w-full py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${selected ? 'bg-secondary/60' : 'hover:bg-secondary/40'}`}
                    >
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 px-2">
                        <span className="font-mono text-xs text-muted-foreground">v{version.version}</span>
                        <span className="font-semibold">{version.name}</span>
                        <StatusPill variant={budgetVersionVariant(version.status)}>{statusLabel(version.status)}</StatusPill>
                        {version.status === 'Active' && <span className="text-xs font-medium text-success-text">{t('projectDetail.budget.currentlyActive', 'Current')}</span>}
                      </span>
                      {canReadMoney && version.id !== headlineVersion?.id && <span className="mt-1 block px-2 text-sm tabular-nums">{formatNumberWhole(version.total)}</span>}
                      <span className="mt-1 block px-2 text-xs text-muted-foreground">{formatInstantDate(version.created_at)} · {getAuthorLabel(version)}</span>
                    </button>
                    {version.status === 'Draft' && (
                      <div className="flex flex-wrap items-center gap-2 px-2 pb-3">
                        {canActivate
                          ? <Button variant="outline" size="sm" disabled={busy} onClick={() => setPendingAction({ kind: 'activate', version })}>{t('financeCopy.activate', 'Activate')}</Button>
                          : <span className="text-xs text-muted-foreground">{t('projectDetail.budget.waitingForFinance', 'Waiting for approval by finance')}</span>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </nav>

        <section aria-label={t('projectDetail.budget.versionChanges', 'Version changes')} className="min-w-0">
          <h3 className="text-sm font-semibold">
            {selectedVersion && previousVersion
              ? t('projectDetail.budget.versionComparedWith', 'v{{current}} compared with v{{previous}}', { current: selectedVersion.version, previous: previousVersion.version })
              : selectedVersion?.name ?? t('projectDetail.budget.versionChanges', 'Version changes')}
          </h3>
          {selectedVersion && previousVersion ? (
            <ul className="mt-2 divide-y divide-border border-y border-border" aria-label={t('projectDetail.budget.comparisonTable', 'Version comparison')}>
              {comparison.map((row) => {
                const activePosition = activeVersion?.id === selectedVersion.id
                  ? activeRows.find((item) => item.category === row.category)
                  : undefined;
                const remaining = activePosition?.spent === null || activePosition?.spent === undefined
                  ? null
                  : activePosition.budget - activePosition.spent;
                return (
                  <li key={row.category} className="grid min-w-0 gap-x-3 gap-y-1 py-3 sm:grid-cols-[minmax(7rem,1fr)_minmax(0,1.3fr)_auto] sm:items-baseline">
                    <span className="font-medium">{budgetCategoryLabel(row.category, t)}</span>
                    {canReadMoney ? (
                      <span className="min-w-0 text-sm tabular-nums">
                        {formatNumberWhole(row.a)} <span aria-hidden>→</span> <strong>{formatNumberWhole(row.b)}</strong>
                        {' · '}{row.change > 0 ? '+' : ''}{formatNumberWhole(row.change)}
                      </span>
                    ) : <span className="text-sm text-muted-foreground">{t('projectDetail.budget.noMoneyAccess', 'Budget amounts are available to project management and finance.')}</span>}
                    {activePosition && canReadMoney && activePosition.spent !== null && (
                      <span className="text-xs text-muted-foreground sm:text-right">{t('projectDetail.budget.spent', 'Spent')} {formatNumberWhole(activePosition.spent)} · {remaining !== null && remaining < 0 ? t('projectDetail.budget.over', '{{amount}} over', { amount: formatNumberWhole(Math.abs(remaining)) }) : `${formatNumberWhole(remaining ?? 0)} ${t('projectDetail.budget.left', 'left')}`}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : selectedVersion ? (
            <p className="mt-2 border-y border-border py-3 text-sm text-muted-foreground">{t('projectDetail.budget.noPreviousVersion', 'There is no earlier version to compare.')}</p>
          ) : (
            <ListState variant="empty" title={t('financeCopy.noBudgetVersionsYet', 'No budget versions yet')} sub={t('financeCopy.createADraftVersionToStartPlanningTheProjectBudget', 'Create a Draft version to start planning the project budget.')} />
          )}

          {activeVersion && canReadMoney && position.actualsPending && <p className="mt-3 text-sm text-muted-foreground">{t('projectDetail.cost.spendingChecking', 'Checking spending…')}</p>}
          {activeVersion && canReadMoney && position.unknown > 0 && !position.actualsPending && !position.actualsError && (
            <p className="mt-3 text-sm text-muted-foreground">{t('projectDetail.cost.spendingUnlinked', "Spending isn't linked yet.")} {t('projectDetail.cost.askAdmin', 'An administrator can finish the setup.')}</p>
          )}
          {activeVersion && canReadMoney && position.actualsError && <p role="status" className="mt-3 text-sm text-muted-foreground">{t('projectDetail.budget.actualsError', "Couldn't check spending.")} <Button variant="ghost" size="sm" onClick={() => void position.refetchActuals()}>{t('common.retry', 'Retry')}</Button></p>}
        </section>
      </div>

      {pendingAction && (
        <ConfirmDialog
          open
          title={pendingAction.kind === 'activate' ? t('financeCopy.makeThisTheActiveBudget', 'Make this the active budget?') : pendingAction.kind === 'clone' ? t('financeCopy.cloneToANewDraft', 'Clone to a new draft?') : t('financeCopy.createBudgetVersion', 'Create budget version?')}
          description={pendingAction.kind === 'activate'
            ? t('financeCopy.confirmActivateDescription', 'This makes {{version}} the live active budget and supersedes the current active version.', { version: versionLabel(pendingAction.version) })
            : pendingAction.kind === 'clone'
              ? t('financeCopy.confirmCloneDescription', 'This copies {{version}} into a new editable Draft.', { version: versionLabel(pendingAction.version) })
              : t('financeCopy.confirmCreateDescription', 'This creates a new Draft budget version named "{{name}}".', { name: pendingAction.name })}
          confirmLabel={pendingAction.kind === 'activate' ? t('financeCopy.activateVersion', 'Activate version') : pendingAction.kind === 'clone' ? t('financeCopy.cloneVersion', 'Clone version') : t('financeCopy.createVersion', 'Create version')}
          loading={busy}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void commitAction()}
        />
      )}
    </div>
  );
};

export default BudgetB;

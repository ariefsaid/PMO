import React, { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import {
  Button,
  ConfirmDialog,
  ListState,
  MenuButton,
  useToast,
  type RowMenuItem,
} from '@/src/components/ui';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import { formatNumberWhole } from '@/src/lib/format';
import { useBudgetMutations, useBudgetVersions, useProjectBudget } from '@/src/hooks/useBudget';
import { useProjectProcurements } from '@/src/hooks/useProcurements';
import { useBudgetPosition } from '../useProjectPosition';
import { buildBudgetSummaryRows, type BudgetSummaryRow } from '../budget/budgetModel';
import BudgetVersionsDrawer from '../budget/BudgetVersionsDrawer';

interface BudgetCProps {
  projectId: string;
  project: ProjectWithRefs;
}

type PendingAction =
  | { kind: 'clone'; version: BudgetVersionWithItems }
  | { kind: 'archive'; version: BudgetVersionWithItems }
  | { kind: 'deleteDraft'; version: BudgetVersionWithItems }
  | { kind: 'create'; name: string };

const usedAmount = (row: BudgetSummaryRow) => (row.spent ?? 0) + (row.committed ?? 0);
const usedRatio = (row: BudgetSummaryRow) => row.budget > 0
  ? usedAmount(row) / row.budget
  : usedAmount(row) > 0 ? Number.POSITIVE_INFINITY : 0;
const isOverBudget = (row: BudgetSummaryRow) => row.spent !== null && row.spent > row.budget;

const BudgetC: React.FC<BudgetCProps> = ({ projectId, project }) => {
  const { t } = useTranslation();
  const can = usePermission();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const budgetQuery = useProjectBudget(projectId);
  const versionsQuery = useBudgetVersions(projectId);
  const mutations = useBudgetMutations(projectId);
  const canReadMoney = can('view', 'salesInvoice');
  const canReadProcurements = can('view', 'procurement');
  const canManageAccounting = can('manage', 'orgAccounting');
  const canWrite = can('edit', 'budgetLine');
  const position = useBudgetPosition(project);
  const procurementsQuery = useProjectProcurements(canReadProcurements ? projectId : null);
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [newVersionName, setNewVersionName] = useState('');

  const versions = useMemo(
    () => (versionsQuery.data ?? []) as BudgetVersionWithItems[],
    [versionsQuery.data],
  );
  const activeVersion = versions.find((version) => version.status === 'Active');
  const draftVersion = versions.find((version) => version.status === 'Draft');
  const canReadCommitments = canReadProcurements && !procurementsQuery.isPending && !procurementsQuery.isError;
  const rows = useMemo(() => activeVersion && canReadMoney
    ? buildBudgetSummaryRows({
      lines: activeVersion.line_items,
      actuals: position.rows,
      procurements: procurementsQuery.data,
      canReadProcurements: canReadCommitments,
      currency: project.currency,
    }).sort((left, right) => Number(isOverBudget(right)) - Number(isOverBudget(left)) || usedRatio(right) - usedRatio(left))
    : [], [activeVersion, canReadMoney, position.rows, procurementsQuery.data, canReadCommitments, project.currency]);

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

  const totalBudget = rows.reduce((sum, row) => sum + row.budget, 0);
  const allSpentKnown = rows.length > 0 && rows.every((row) => row.spent !== null);
  const totalSpent = allSpentKnown ? rows.reduce((sum, row) => sum + (row.spent ?? 0), 0) : null;
  const projectOver = totalSpent === null ? null : totalSpent - totalBudget;
  const overRows = rows.filter(isOverBudget).sort((left, right) => (right.spent! - right.budget) - (left.spent! - left.budget));
  const highestUsed = rows[0];
  const headline = !canReadMoney
    ? t('projectDetail.budget.noMoneyAccess', 'Budget amounts are available to project management and finance.')
    : !activeVersion
      ? t('projectDetail.budget.noActiveBudget', 'No active budget')
      : position.actualsPending
        ? t('projectDetail.cost.spendingChecking', 'Checking spending…')
        : totalSpent === null
          ? t('projectDetail.budget.spendingUnknown', 'Budget is active · spending is not linked yet')
          : projectOver !== null && projectOver > 0
            ? `${formatNumberWhole(projectOver)} ${t('projectDetail.budget.over', 'over')} · ${t('projectDetail.budget.mostlyCategory', 'mostly {{category}}', { category: budgetCategoryLabel(overRows[0]?.category ?? rows[0]?.category ?? 'Other', t) })}`
            : `${formatNumberWhole(totalBudget - totalSpent)} ${t('projectDetail.budget.left', 'left')} · ${t('projectDetail.budget.mostUsedCategory', 'most used {{category}}', { category: highestUsed ? budgetCategoryLabel(highestUsed.category, t) : t('financeCopy.category', 'category') })}`;

  const commitAction = async () => {
    if (!pendingAction) return;
    try {
      if (pendingAction.kind === 'clone') {
        await mutations.cloneVersion.mutateAsync(pendingAction.version.id);
        toast(t('financeCopy.versionCloned', 'Version cloned'), pendingAction.version.name, 'success');
      } else if (pendingAction.kind === 'archive') {
        await mutations.archive.mutateAsync(pendingAction.version.id);
        void queryClient.invalidateQueries({ queryKey: ['budget-push-status', projectId] });
        toast(t('financeCopy.versionArchived', 'Version archived'), pendingAction.version.name, 'success');
      } else if (pendingAction.kind === 'deleteDraft') {
        await mutations.deleteDraft.mutateAsync(pendingAction.version.id);
        toast(t('financeCopy.draftDeleted', 'Draft deleted'), pendingAction.version.name, 'success');
      } else if (pendingAction.kind === 'create') {
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

  const confirmBusy = mutations.cloneVersion.isPending || mutations.archive.isPending || mutations.deleteDraft.isPending || mutations.createVersion.isPending;
  const menuItems: RowMenuItem[] = [
    { label: t('projectDetail.budget.versionsTitle', 'Budget versions'), onClick: () => setVersionsOpen(true) },
    ...(canWrite && activeVersion && !draftVersion
      ? [{ label: t('projectDetail.budget.updateBudget', 'Update budget'), onClick: () => setPendingAction({ kind: 'clone', version: activeVersion }) }]
      : []),
    ...(!versions.length && canWrite
      ? [{ label: t('projectDetail.budget.createBudget', 'Create budget'), onClick: () => setNewVersionName(t('projectDetail.budget.newVersionDefault', 'Project budget')) }]
      : []),
  ];

  return (
    <div className="min-w-0 space-y-5" data-testid="budget-option-c">
      <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{t('projectDetail.budget.title', 'Project budget')}</h2>
          {canReadMoney && <p className="mt-1 text-xs text-muted-foreground">{project.currency}</p>}
        </div>
        {menuItems.length > 0 && <MenuButton ariaLabel={t('projectDetail.budget.budgetActions', 'Budget actions')} items={menuItems} />}
      </header>

      <p className="text-xl font-semibold tabular-nums" data-testid="budget-answer">{headline}</p>

      {!versions.length && canWrite && newVersionName && (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          if (newVersionName.trim()) setPendingAction({ kind: 'create', name: newVersionName.trim() });
        }}>
          <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-muted-foreground">
            {t('financeCopy.versionName', 'Version name')}
            <input autoFocus value={newVersionName} onChange={(event) => setNewVersionName(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground" />
          </label>
          <Button variant="outline" type="submit" disabled={!newVersionName.trim()}>{t('financeCopy.createVersion', 'Create version')}</Button>
        </form>
      )}

      {activeVersion && canReadMoney ? (
        <section aria-label={t('projectDetail.budget.tableName', 'Budget categories')}>
          <ul className="divide-y divide-border border-y border-border">
            {rows.map((row) => {
              const expanded = expandedCategory === row.category;
              const committed = row.committed ?? 0;
              const used = (row.spent ?? 0) + committed;
              const ratio = row.budget > 0 ? used / row.budget : used > 0 ? 1.5 : 0;
              const barWidth = Math.min(Math.max(ratio * 100, used > 0 ? 1 : 0), 150);
              const spentWidth = row.budget > 0 ? Math.min(Math.max((row.spent ?? 0) / row.budget * 100, 0), 150) : used > 0 ? 150 : 0;
              const committedWidth = row.budget > 0 ? Math.max(0, Math.min(barWidth - spentWidth, 150 - spentWidth)) : 0;
              return (
                <li key={row.category} className="min-w-0">
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setExpandedCategory((current) => current === row.category ? null : row.category)}
                    className="touch-target grid w-full min-w-0 gap-2 py-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:grid-cols-[minmax(8rem,0.65fr)_minmax(12rem,1.2fr)_minmax(12rem,1fr)] sm:items-center sm:gap-4"
                  >
                    <span className="font-medium">{budgetCategoryLabel(row.category, t)}</span>
                    <span aria-hidden className="relative block h-3 w-full rounded-full bg-secondary">
                      <span className={`absolute inset-y-0 left-0 rounded-l-full ${isOverBudget(row) ? 'bg-destructive' : 'bg-foreground'}`} style={{ width: `${Math.min(spentWidth, 100)}%` }} />
                      {committedWidth > 0 && <span className="absolute inset-y-0 rounded-r-full bg-muted-foreground/45" style={{ left: `${Math.min(spentWidth, 100)}%`, width: `${Math.min(committedWidth, Math.max(100 - spentWidth, 0))}%` }} />}
                      <span aria-hidden className="absolute inset-y-[-2px] right-0 w-px bg-foreground" />
                      {barWidth > 100 && <span aria-hidden className="absolute inset-y-0 right-0 w-1/4 rounded-r-full bg-destructive" />}
                    </span>
                    <span className="text-xs tabular-nums text-muted-foreground sm:text-right">
                      {row.spent !== null && `${formatNumberWhole(row.spent)} ${t('projectDetail.budget.spent', 'spent')}`}
                      {row.committed !== null && row.committed > 0 && <span className="text-foreground"> · +{formatNumberWhole(row.committed)} {t('projectDetail.budget.committed', 'committed')}</span>}
                      {' · '}{formatNumberWhole(row.budget)} {t('projectDetail.budget.budget', 'budget')}
                    </span>
                  </button>
                  {expanded && (
                    <div className="pb-3 pl-2 sm:pl-[calc(26%+1rem)]" aria-label={t('projectDetail.budget.lineItemsFor', '{{category}} line items', { category: budgetCategoryLabel(row.category, t) })}>
                      {row.lines.length ? (
                        <ul className="divide-y divide-border border-t border-border">
                          {row.lines.map((line, index) => (
                            <li key={line.id ?? `${row.category}-${index}`} className="flex min-w-0 justify-between gap-3 py-2 text-sm">
                              <span className="min-w-0 break-words text-muted-foreground">{line.description || '—'}</span>
                              <span className="shrink-0 tabular-nums">{formatNumberWhole(Number(line.budgeted_amount))}</span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="border-t border-border py-2 text-sm text-muted-foreground">{t('projectDetail.budget.noLineItems', 'No budget line items')}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : activeVersion ? (
        <p className="border-y border-border py-3 text-sm text-muted-foreground">{t('projectDetail.budget.noMoneyAccess', 'Budget amounts are available to project management and finance.')}</p>
      ) : (
        <ListState variant="empty" title={t('uxs04.noActiveBudget', 'No active budget')} sub={t('projectDetail.budget.draftVisible', 'A draft budget is being prepared for approval.')} />
      )}

      {activeVersion && canReadMoney && position.actualsPending && <p className="text-sm text-muted-foreground">{t('projectDetail.cost.spendingChecking', 'Checking spending…')}</p>}
      {activeVersion && canReadMoney && position.unknown > 0 && !position.actualsPending && !position.actualsError && (
        <p className="text-sm text-muted-foreground">{t('projectDetail.cost.spendingUnlinked', "Spending isn't linked yet.")} {canManageAccounting ? <Link to="/administration/accounting#budget-account-map" className="font-medium text-primary-text underline underline-offset-2 hover:text-foreground">{t('projectDetail.cost.finishSetup', 'Finish spending setup')}</Link> : t('projectDetail.cost.askAdmin', 'An administrator can finish the setup.')}</p>
      )}
      {activeVersion && canReadMoney && position.actualsError && <p role="status" className="text-sm text-muted-foreground">{t('projectDetail.budget.actualsError', "Couldn't check spending.")} <Button variant="ghost" size="sm" onClick={() => void position.refetchActuals()}>{t('common.retry', 'Retry')}</Button></p>}
      {activeVersion && canReadMoney && canReadProcurements && procurementsQuery.isError && <p role="status" className="text-sm text-muted-foreground">{t('projectDetail.budget.commitmentsError', "Couldn't check procurement commitments.")} <Button variant="ghost" size="sm" onClick={() => void procurementsQuery.refetch()}>{t('common.retry', 'Retry')}</Button></p>}

      <BudgetVersionsDrawer
        open={versionsOpen}
        onClose={() => setVersionsOpen(false)}
        versions={versions}
        canWrite={canWrite}
        hasDraft={Boolean(draftVersion)}
        nestedOpen={Boolean(pendingAction)}
        onArchive={(id) => {
          const version = versions.find((item) => item.id === id);
          if (version) setPendingAction({ kind: 'archive', version });
        }}
        onClone={(id) => {
          const version = versions.find((item) => item.id === id);
          if (version) setPendingAction({ kind: 'clone', version });
        }}
        onDeleteDraft={(id) => {
          const version = versions.find((item) => item.id === id);
          if (version) setPendingAction({ kind: 'deleteDraft', version });
        }}
      />
      {pendingAction && (
        <ConfirmDialog
          open
          tone={pendingAction.kind === 'archive' || pendingAction.kind === 'deleteDraft' ? 'destructive' : 'default'}
          title={pendingAction.kind === 'clone' ? t('financeCopy.cloneToANewDraft', 'Clone to a new draft?') : pendingAction.kind === 'archive' ? t('financeCopy.archiveThisVersion', 'Archive this version?') : pendingAction.kind === 'deleteDraft' ? t('financeCopy.deleteThisDraft', 'Delete this draft?') : t('financeCopy.createBudgetVersion', 'Create budget version?')}
          description={pendingAction.kind === 'clone'
            ? t('financeCopy.confirmCloneDescription', 'This copies {{version}} into a new editable Draft.', { version: pendingAction.version.name })
            : pendingAction.kind === 'archive'
              ? t('financeCopy.confirmArchiveDescription', 'This removes {{version}} as the active budget. You can clone it later to revise.', { version: pendingAction.version.name })
              : pendingAction.kind === 'deleteDraft'
                ? t('financeCopy.confirmDeleteDraftDescription', 'This permanently deletes the draft {{version}}. This cannot be undone.', { version: pendingAction.version.name })
                : t('financeCopy.confirmCreateDescription', 'This creates a new Draft budget version named "{{name}}".', { name: pendingAction.name })}
          confirmLabel={pendingAction.kind === 'clone' ? t('financeCopy.cloneVersion', 'Clone version') : pendingAction.kind === 'archive' ? t('financeCopy.archiveVersion', 'Archive version') : pendingAction.kind === 'deleteDraft' ? t('financeCopy.deleteDraft', 'Delete draft') : t('financeCopy.createVersion', 'Create version')}
          loading={confirmBusy}
          onCancel={() => setPendingAction(null)}
          onConfirm={() => void commitAction()}
        />
      )}
    </div>
  );
};

export default BudgetC;

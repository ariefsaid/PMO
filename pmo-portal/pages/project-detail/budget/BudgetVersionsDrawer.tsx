import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Drawer, StatusPill, type Column } from '@/src/components/ui';
import { BudgetDocumentLinks } from '@/src/components/m365/BudgetDocumentLinks';
import type { BudgetVersionWithItems } from '@/src/lib/db/budgets';
import { formatCurrencyAuto, formatInstantDate, formatNumberMax2 } from '@/src/lib/format';
import { budgetVersionVariant } from '@/src/lib/status/statusVariants';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { compareBudgetVersions, type BudgetComparisonRow } from './budgetModel';

interface BudgetVersionsDrawerProps {
  open: boolean;
  onClose: () => void;
  versions: BudgetVersionWithItems[];
  canWrite: boolean;
  hasDraft: boolean;
  nestedOpen?: boolean;
  onArchive: (id: string) => void;
  onClone: (id: string) => void;
  onDeleteDraft: (id: string) => void;
}

const statusLabel = (status: BudgetVersionWithItems['status'], t: (key: string, fallback: string) => string) => {
  const labels: Record<BudgetVersionWithItems['status'], string> = {
    Draft: t('financeCopy.statusDraft', 'Draft'),
    Active: t('financeCopy.statusActive', 'Active'),
    Archived: t('financeCopy.statusArchived', 'Archived'),
  };
  return labels[status];
};

export default function BudgetVersionsDrawer({
  open,
  onClose,
  versions,
  canWrite,
  hasDraft,
  nestedOpen = false,
  onArchive,
  onClone,
  onDeleteDraft,
}: BudgetVersionsDrawerProps) {
  const { t } = useTranslation();
  const [comparing, setComparing] = useState(false);
  const [versionA, setVersionA] = useState(versions[0]?.id ?? '');
  const [versionB, setVersionB] = useState(versions[1]?.id ?? versions[0]?.id ?? '');
  const versionAId = versions.some((version) => version.id === versionA) ? versionA : versions[0]?.id ?? '';
  const versionBId = versions.some((version) => version.id === versionB) ? versionB : versions[1]?.id ?? versions[0]?.id ?? '';
  const a = versions.find((version) => version.id === versionAId);
  const b = versions.find((version) => version.id === versionBId);
  const compareRows = useMemo<BudgetComparisonRow[]>(
    () => a && b ? compareBudgetVersions(a.line_items, b.line_items) : [],
    [a, b],
  );
  const compareColumns: Column<BudgetComparisonRow>[] = [
    { key: 'category', header: t('financeCopy.category', 'Category'), kind: 'primary', cell: (row) => budgetCategoryLabel(row.category, t) },
    { key: 'a', header: t('projectDetail.budget.versionA', 'A'), kind: 'money', align: 'num', cell: (row) => formatNumberMax2(row.a) },
    { key: 'b', header: t('projectDetail.budget.versionB', 'B'), kind: 'money', align: 'num', cell: (row) => formatNumberMax2(row.b) },
    { key: 'change', header: t('projectDetail.budget.change', 'Change'), kind: 'money', align: 'num', cell: (row) => (
      <span className={row.change > 0 ? 'text-destructive-text' : undefined}>
        {row.change > 0 ? '+' : ''}{formatNumberMax2(row.change)}
      </span>
    ) },
  ];

  return (
    <Drawer
      open={open}
      title={t('projectDetail.budget.versionsTitle', 'Budget versions')}
      onClose={onClose}
      width="lg"
      nestedOpen={nestedOpen}
    >
      <div className="space-y-5">
        <ol className="divide-y divide-border" aria-label={t('projectDetail.budget.versionsTitle', 'Budget versions')}>
          {[...versions].reverse().map((version) => (
            <li key={version.id} className="min-w-0 py-4 first:pt-0">
              <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="font-mono text-xs text-muted-foreground">v{version.version}</span>
                    <span className="font-semibold">{version.name}</span>
                    <StatusPill variant={budgetVersionVariant(version.status)}>{statusLabel(version.status, t)}</StatusPill>
                    {version.activation_basis === 'sole_operator' && (
                      <StatusPill variant="neutral">{t('financeCopy.activatedBySoleOperator', 'Activated by sole operator')}</StatusPill>
                    )}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {formatCurrencyAuto(version.total, version.currency)}
                    {' · '}{version.activated_at ? formatInstantDate(version.activated_at) : t('projectDetail.budget.notActivated', 'Not activated')}
                  </p>
                </div>
                {canWrite && (
                  <div className="flex shrink-0 flex-wrap items-center gap-1">
                    {version.status === 'Active' && (
                      <Button variant="ghost" size="sm" className="text-warning-foreground" onClick={() => onArchive(version.id)}>
                        {t('financeCopy.archive', 'Archive')}
                      </Button>
                    )}
                    {version.status === 'Draft' && (
                      <Button variant="ghost" size="sm" className="text-destructive-text" onClick={() => onDeleteDraft(version.id)}>
                        {t('financeCopy.deleteDraft', 'Delete draft')}
                      </Button>
                    )}
                    {version.status === 'Archived' && !hasDraft && (
                      <Button variant="ghost" size="sm" className="text-primary-text" onClick={() => onClone(version.id)}>
                        {t('financeCopy.cloneToRevise', 'Clone to revise')}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <BudgetDocumentLinks versionId={version.id} status={version.status} />
            </li>
          ))}
        </ol>

        {versions.length > 0 && (
          <section aria-labelledby="budget-version-compare-heading" className="border-t border-border pt-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 id="budget-version-compare-heading" className="text-sm font-semibold">
                {t('projectDetail.budget.compareVersions', 'Compare versions')}
              </h3>
              <Button variant="outline" size="sm" onClick={() => setComparing((value) => !value)}>
                {comparing ? t('common.close', 'Close') : t('projectDetail.budget.compare', 'Compare')}
              </Button>
            </div>
            {comparing && (
              <div className="mt-3 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    {t('projectDetail.budget.versionA', 'Version A')}
                    <select aria-label={t('projectDetail.budget.versionA', 'Version A')} value={versionAId} onChange={(event) => setVersionA(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                      {versions.map((version) => <option key={version.id} value={version.id}>v{version.version} · {version.name}</option>)}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    {t('projectDetail.budget.versionB', 'Version B')}
                    <select aria-label={t('projectDetail.budget.versionB', 'Version B')} value={versionBId} onChange={(event) => setVersionB(event.target.value)} className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground">
                      {versions.map((version) => <option key={version.id} value={version.id}>v{version.version} · {version.name}</option>)}
                    </select>
                  </label>
                </div>
                {a && b && (
                  <DataTable
                    rows={compareRows}
                    columns={compareColumns}
                    rowKey={(row) => row.category}
                    tableId="budget-version-comparison"
                    accessibleName={t('projectDetail.budget.comparisonTable', 'Version comparison')}
                    cardBelow={600}
                  />
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </Drawer>
  );
}

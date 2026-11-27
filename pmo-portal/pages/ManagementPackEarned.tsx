import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { formatExactMoney } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { useOrgSwitch } from '@/src/hooks/useOrgSwitch';
import { usePackEarned, usePackRollups } from '@/src/hooks/useEarnedBilled';
import { useProjects } from '@/src/hooks/useProjects';
import { projectEarnedBilled, type Figure } from '@/src/lib/earnedBilledProfit';
import { moneyUnits, type ExactMoney } from '@/src/lib/projectFinances';
import { EarnedBilledTable, type EbCell, type EbTableRow } from '@/src/components/finance/EarnedBilledTable';

/**
 * Management pack: earned and billed revenue with the gap and margin on each basis, per project (#2733, FR-EBR-021).
 * Earned comes from `management_pack_earned`; cost and billed from the SAME plan-versus-actual roll-up the project tab uses
 * (shared parsers and rollup), so the pack and the tab never disagree. Existing pack columns and totals are untouched.
 * Nothing renders while the organisation setting is off or the role may not read work-order money.
 */
const ManagementPackEarned: React.FC = () => {
  const { t } = useTranslation('workOrderPva');
  const may = usePermission();
  const canView = may('view', 'workOrderPlan');
  const setting = useOrgSwitch('disciplineProfit', canView);
  const on = canView && setting.data === true;
  const earned = usePackEarned(on);
  const projects = useProjects({ enabled: on });
  const rows = useMemo(() => earned.data ?? [], [earned.data]);
  const projectIds = useMemo(() => [...new Set(rows.map((r) => r.projectId))].sort(), [rows]);
  const rollups = usePackRollups(projectIds, on && projectIds.length > 0);
  const nameOf = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);

  if (!on) return null;
  const title = t('earnedBilled.packTitle', 'Earned and billed revenue by project');
  const batchError = rollups.find((q) => q.isBatchError);
  if (earned.isPending || earned.isError || batchError) {
    return (
      <Card className="min-w-0" data-testid="pack-earned">
        <CardHead level={2} className="text-base">{title}</CardHead>
        <CardPad className="pt-0">
          {earned.isError || batchError
            ? <ListState variant="error" title={t('earnedBilled.loadError', 'Couldn\'t load earned and billed revenue')} retryLabel={t('profit.retry', 'Try again')} onRetry={() => { void (batchError ?? earned).refetch(); }} />
            : <ListState variant="loading" rows={3} />}
        </CardPad>
      </Card>
    );
  }
  if (rows.length === 0) return null;

  const money = (v: ExactMoney | null, currency: string) =>
    v === null ? t('profit.unknown', 'Unknown') : formatExactMoney(v, currency, getNumberLocale()) ?? t('profit.unknown', 'Unknown');
  const reasonText = (reason: Figure['reason']) => {
    switch (reason) {
      case 'restricted': return t('profit.restricted', 'Restricted');
      case 'not-available': return t('earnedBilled.notAvailable', 'Not available');
      case 'incomplete': return t('earnedBilled.incompleteWorkOrders', 'Incomplete: work orders without validated progress');
      case 'not-comparable': return t('profit.notComparable', 'Not comparable (other currency)');
      case 'cost-unknown': return t('profit.costUnknown', 'Cost unknown');
      default: return '';
    }
  };
  const cell = (f: Figure, currency: string, loss = false): EbCell => {
    if (f.amount === null) return { text: reasonText(f.reason), words: true };
    const units = moneyUnits(f.amount);
    return { words: false, text: loss && units !== null && units < 0n ? t('profit.loss', 'Loss of {{amount}}', { amount: money(f.amount.replace('-', ''), currency) }) : money(f.amount, currency) };
  };

  const columns = [
    { key: 'earned', label: t('earnedBilled.col.earned', 'Earned') },
    { key: 'billed', label: t('earnedBilled.col.billed', 'Billed') },
    { key: 'gap', label: t('earnedBilled.col.gap', 'Earned, not yet billed') },
    { key: 'marginEarned', label: t('earnedBilled.col.marginEarned', 'Margin on earned') },
    { key: 'marginBilled', label: t('earnedBilled.col.marginBilled', 'Margin on billed') },
  ];
  const tableRows: EbTableRow[] = rows.map((r) => {
    const q = rollups[projectIds.indexOf(r.projectId)];
    const label = nameOf.get(r.projectId) ?? r.projectId;
    const testId = `pack-earned-row-${r.projectId}-${r.currency}`;
    if (!q || q.isPending) return { key: testId, testId, label, cells: columns.map(() => ({ text: '…', words: true })) };
    if (q.isError || !q.data) return { key: testId, testId, label, cells: columns.map(() => ({ text: t('earnedBilled.notAvailable', 'Not available'), words: true })) };
    const tot = projectEarnedBilled(q.data.rollup, r.currency, {
      earned: r.earned, unratedLines: r.unratedLines, workOrders: r.workOrders, withoutProgress: r.workOrdersWithoutProgress,
    });
    const restricted: Figure = { amount: null, reason: 'restricted' };
    const f = q.data.rollup.restricted ? { earned: restricted, billed: restricted, gap: restricted, marginEarned: restricted, marginBilled: restricted } : tot;
    return {
      key: testId, testId, label,
      cells: [cell(f.earned, r.currency), cell(f.billed, r.currency), cell(f.gap, r.currency), cell(f.marginEarned, r.currency, true), cell(f.marginBilled, r.currency, true)],
    };
  });

  return (
    <Card className="min-w-0" data-testid="pack-earned">
      <CardHead level={2} className="text-base">{title}</CardHead>
      <CardPad className="pt-0">
        <p className="mb-2 text-sm text-muted-foreground">{t('earnedBilled.packNote', 'Earned is validated daily progress to date; cost and billed are the project tab\'s figures, so they agree.')}</p>
        <EarnedBilledTable caption={title} firstColumn={t('earnedBilled.col.project', 'Project')} columns={columns} rows={tableRows} />
      </CardPad>
    </Card>
  );
};

export default ManagementPackEarned;

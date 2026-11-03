import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, ListState, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEquipmentAllocations, useEquipmentUsageTotals } from '@/src/hooks/useEquipment';
import { formatCurrency, formatExactMoney, formatNumberMax2 } from '@/src/lib/format';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import { basisLabel, unitLabel } from '../equipment/equipmentLabels';
import { monthStart, toIso } from '../equipment/equipmentWeek';

interface AssetLine { assetId: string; code: string; name: string; unit: string; work: number; standby: number; waiting: number; amount: number | null; basis: string[] }
const isZero = (v: string) => /^-?0+(\.0+)?$/.test(v.trim());

/** Equipment on a project's Finances tab: usage per asset (every role) and, for approval rank, the allocated amount and its basis (FR-EQU-071/051). */
export const ProjectEquipmentPanel: React.FC<{ projectId: string; currency: string; equipmentChargeTotal?: string | null }> = ({ projectId, currency, equipmentChargeTotal }) => {
  const { t } = useTranslation();
  const may = usePermission();
  const canSeeAmounts = may('view', 'equipmentUsage');
  const today = toIso(new Date());
  const range = { from: monthStart(today, -11), to: today };
  const totals = useEquipmentUsageTotals({ projectId, ...range });
  // An empty `from` leaves this read switched off (the hook's enabled guard), so an Engineer never asks for amounts the server withholds.
  const allocations = useEquipmentAllocations({ projectId, from: canSeeAmounts ? range.from : '', to: range.to });

  const lines = useMemo<AssetLine[]>(() => {
    const byAsset = new Map<string, AssetLine>();
    const line = (id: string, code: string, name: string, unit: string): AssetLine => {
      const l = byAsset.get(id) ?? { assetId: id, code, name, unit, work: 0, standby: 0, waiting: 0, amount: null, basis: [] };
      byAsset.set(id, l);
      return l;
    };
    for (const r of totals.data?.rows ?? []) {
      const l = line(r.asset_id, r.asset_code ?? '', r.asset_name ?? '', r.unit);
      l.work += Number(r.work_units ?? 0); l.standby += Number(r.standby_units ?? 0); l.waiting += Number(r.submitted_count ?? 0);
    }
    if (canSeeAmounts) {
      for (const r of allocations.data?.rows ?? []) {
        if (r.status === 'unallocated' || !r.project_id) continue;
        const l = line(r.asset_id, r.asset_code ?? '', r.asset_code ?? '', r.unit);
        const tag = r.status === 'usage_only' ? 'usage_only' : r.basis;
        if (!l.basis.includes(tag)) l.basis.push(tag);
        if (r.amount != null) l.amount = (l.amount ?? 0) + Number(r.amount);
      }
    }
    return [...byAsset.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [totals.data, allocations.data, canSeeAmounts]);

  if (totals.isPending) return (
    <div role="status" aria-live="polite">
      <ListState variant="loading" shape="table" rows={3} loadingLabel={t('equipment:panel.loading', 'Loading equipment…')} />
    </div>
  );
  if (totals.isError || !totals.data) return (
    <div role="alert" className="text-sm">
      {t('equipment:panel.error', "Couldn't load equipment.")}{' '}
      <Button variant="outline" size="sm" onClick={() => void totals.refetch()}>{t('equipment:usage.retry', 'Retry')}</Button>
    </div>
  );
  if (lines.length === 0) return null;

  const charge = equipmentChargeTotal && !isZero(equipmentChargeTotal) ? formatExactMoney(equipmentChargeTotal, currency, getNumberLocale(), { wholeUnits: true }) : null;
  const columns: Column<AssetLine>[] = [
    { key: 'asset', header: t('equipment:panel.columns.equipment', 'Equipment'), kind: 'primary', rowHeader: true, cell: (l) => <span className="font-medium">{l.name}</span> },
    { key: 'work', header: t('equipment:usage.kindWork', 'Work'), align: 'num', cell: (l) => <span className="whitespace-nowrap tabular-nums">{formatNumberMax2(l.work)} {unitLabel(t, l.unit, l.work)}</span> },
    { key: 'standby', header: t('equipment:usage.kindStandby', 'Standby'), align: 'num', cell: (l) => <span className="whitespace-nowrap tabular-nums">{formatNumberMax2(l.standby)} {unitLabel(t, l.unit, l.standby)}</span> },
    { key: 'waiting', header: t('equipment:usage.waiting', 'Waiting approval'), align: 'num', cell: (l) => <span className="tabular-nums">{l.waiting}</span> },
    ...(canSeeAmounts ? [
      { key: 'amount', header: t('equipment:panel.columns.allocated', 'Allocated'), align: 'num' as const,
        cell: (l: AssetLine) => l.amount == null ? <span className="text-muted-foreground">—</span> : <span className="tabular-nums">{formatCurrency(l.amount, currency)}</span> },
      { key: 'basis', header: t('equipment:allocations.basis', 'Basis'),
        cell: (l: AssetLine) => l.basis.length === 0 ? '—' : l.basis.map((b) => b === 'usage_only' ? t('equipment:allocations.usageOnly', 'Usage recorded; no costing set') : basisLabel(t, b)).join(' · ') },
    ] : []),
  ];
  return (
    <div className="min-w-0 space-y-2" data-testid="project-equipment-panel">
      <h3 className="text-sm font-semibold">{t('equipment:panel.title', 'Equipment · last 12 months')}</h3>
      <DataTable<AssetLine> embedded rows={lines} columns={columns} rowKey={(l) => l.assetId} tableId="project-equipment"
        accessibleName={t('equipment:panel.title', 'Equipment · last 12 months')} />
      {charge && <p className="text-xs text-muted-foreground">{t('equipment:panel.internalCharge', 'Includes {{amount}} internal equipment charges (hire rates), not ledger cost', { amount: charge })}</p>}
    </div>
  );
};

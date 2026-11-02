import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, EntityFormModal, FormGrid, SelectField, TextField, useToast, type Column, type SubmitError } from '@/src/components/ui';
import { Checkbox } from '@/src/components/ui';
import { usePreviewCosting, useSaveCosting } from '@/src/hooks/useEquipment';
import type { CostingDraft, CostingPreviewRow, EquipmentAssetRow, EquipmentCostingRow } from '@/src/lib/db/equipment';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMonthYear, formatNumberMax2 } from '@/src/lib/format';
import { basisLabel, unitLabel } from './equipmentLabels';
import { fromIso, monthStart, toIso } from './equipmentWeek';

type Basis = CostingDraft['basis'];
const BASES: Basis[] = ['none', 'hire_rate', 'actual_cost'];
const num = (s: string): number | null => { const n = Number(s.trim().replace(',', '.')); return s.trim() !== '' && Number.isFinite(n) ? n : null; };

/** Change an asset's costing (Admin/Finance, FR-EQU-030..034). Preview runs the DB's own normaliser, so it cannot promise a number Save would not give. */
export const EquipmentCostingForm: React.FC<{
  asset: EquipmentAssetRow; current: EquipmentCostingRow | undefined; projectName: (id: string) => string;
  money: (amount: number, projectId: string | null) => string; onClose: () => void;
}> = ({ asset, current, projectName, money, onClose }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const preview = usePreviewCosting();
  const save = useSaveCosting();
  const [rows, setRows] = useState<CostingPreviewRow[] | null>(null);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);
  const [saving, setSaving] = useState(false);
  const [v, setV] = useState({
    basis: (current?.basis ?? 'actual_cost') as Basis,
    workRate: current?.work_rate != null ? String(current.work_rate) : '',
    standbyRate: current?.standby_rate != null ? String(current.standby_rate) : '',
    rateUnit: current?.rate_unit ?? asset.default_unit,
    driver: current?.driver ?? 'units',
    countStandby: current?.count_standby ?? false,
    account: current?.match_account ?? '', accountGroup: current?.match_account_group ?? '', costCenter: current?.match_cost_center ?? '',
    partyType: current?.match_party_type ?? '', party: current?.match_party ?? '',
    effectiveFrom: monthStart(toIso(new Date())), effectiveTo: '',
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => { setV((s) => ({ ...s, [k]: value })); setRows(null); };

  const draft = useMemo<CostingDraft>(() => ({
    ...(current ? { setting_key: current.setting_key, expected_version: current.version } : {}),
    asset_id: asset.id, basis: v.basis, effective_from: v.effectiveFrom, effective_to: v.effectiveTo || null,
    ...(v.basis === 'hire_rate' ? { work_rate: num(v.workRate), standby_rate: num(v.standbyRate), rate_unit: v.rateUnit as 'hours' | 'days' } : {}),
    ...(v.basis === 'actual_cost' ? {
      driver: v.driver as 'units' | 'fuel' | 'trips', count_standby: v.countStandby,
      ...(v.account.trim() ? { account: v.account.trim() } : {}), ...(v.accountGroup.trim() ? { account_group: v.accountGroup.trim() } : {}),
      cost_center: v.costCenter.trim() || null, party_type: v.partyType.trim() || null, party: v.party.trim() || null,
    } : {}),
  }), [v, current, asset.id]);

  const ready = Boolean(v.effectiveFrom) && (v.basis === 'none'
    || (v.basis === 'hire_rate' && (num(v.workRate) ?? 0) > 0)
    || (v.basis === 'actual_cost' && (v.account.trim() !== '' || v.accountGroup.trim() !== '')));

  const fail = (err: unknown) => { const c = classifyMutationError(err); setSubmitError({ headline: c.headline, detail: c.detail }); };
  const runPreview = async () => {
    setSubmitError(null);
    try { setRows(await preview.mutateAsync(draft)); } catch (err) { setRows(null); fail(err); }
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSaving(true);
    try {
      await save.mutateAsync(draft);
      toast(t('equipment:costing.saved', 'Costing saved'), undefined, 'success');
      onClose();
    } catch (err) { fail(err); } finally { setSaving(false); }
  };

  const previewColumns: Column<CostingPreviewRow>[] = [
    { key: 'month', header: t('equipment:allocations.month', 'Month'), kind: 'primary', rowHeader: true, cell: (r) => formatMonthYear(fromIso(r.month)) },
    { key: 'project', header: t('equipment:allocations.project', 'Project'),
      cell: (r) => r.project_id ? projectName(r.project_id) : <span className="text-warning-foreground">{t('equipment:allocations.unallocated', 'Unallocated: no approved usage this month')}</span> },
    { key: 'amount', header: t('equipment:allocations.amount', 'Amount'), align: 'num', cell: (r) => r.amount == null ? '—' : money(r.amount, r.project_id) },
    { key: 'driver', header: t('equipment:allocations.driverTotal', 'Driver total'), align: 'num', cell: (r) => r.driver_total == null ? '—' : formatNumberMax2(r.driver_total) },
    { key: 'entries', header: t('equipment:allocations.entries', 'Entries'), align: 'num', cell: (r) => r.entry_count },
  ];

  return (
    <EntityFormModal open title={t('equipment:costing.changeTitle', 'Change costing for {{asset}}', { asset: asset.name })}
      subtitle={t('equipment:costing.changeSubtitle', 'Applies from the date below. Earlier months keep the setting that was current then.')}
      submitLabel={t('equipment:costing.save', 'Save costing')} onSubmit={(e) => void submit(e)} onClose={onClose} width="lg"
      loading={saving} dirty={rows !== null || v.account !== (current?.match_account ?? '')} submitDisabled={!ready} submitError={submitError}>
      <FormGrid>
        <fieldset className="col-span-full flex flex-wrap gap-4">
          <legend className="mb-1 text-sm font-medium">{t('equipment:costing.basis', 'Costing basis')}</legend>
          {BASES.map((b) => (
            <label key={b} className="flex items-center gap-2 text-sm">
              <input type="radio" name="equipment-costing-basis" value={b} checked={v.basis === b} onChange={() => set('basis', b)} />
              {basisLabel(t, b)}
            </label>
          ))}
        </fieldset>
        {v.basis === 'hire_rate' && <>
          <TextField label={t('equipment:costing.workRate', 'Work rate per unit')} required inputMode="decimal" value={v.workRate} onChange={(x) => set('workRate', x)} />
          <TextField label={t('equipment:costing.standbyRate', 'Standby rate per unit (optional)')} inputMode="decimal" value={v.standbyRate} onChange={(x) => set('standbyRate', x)}
            helper={t('equipment:costing.standbyHelper', 'Without a standby rate, standby is recorded but charges nothing.')} />
          <SelectField label={t('equipment:costing.rateUnit', 'Rate per')} value={v.rateUnit} onChange={(x) => set('rateUnit', x)}
            options={[{ value: 'hours', label: unitLabel(t, 'hours') }, { value: 'days', label: unitLabel(t, 'days') }]} />
        </>}
        {v.basis === 'actual_cost' && <>
          <TextField label={t('equipment:costing.account', 'Ledger account')} value={v.account} onChange={(x) => set('account', x)}
            helper={t('equipment:costing.accountHelper', 'Costs posted to this account (or account group) with no project are shared across projects by usage.')} />
          <TextField label={t('equipment:costing.accountGroup', 'Account group (instead of one account)')} value={v.accountGroup} onChange={(x) => set('accountGroup', x)} />
          <TextField label={t('equipment:costing.costCenter', 'Cost centre (optional)')} value={v.costCenter} onChange={(x) => set('costCenter', x)} />
          <TextField label={t('equipment:costing.partyType', 'Party type (optional)')} value={v.partyType} onChange={(x) => set('partyType', x)} />
          <TextField label={t('equipment:costing.party', 'Party (optional)')} value={v.party} onChange={(x) => set('party', x)} />
          <SelectField label={t('equipment:costing.driver', 'Share by')} value={v.driver} onChange={(x) => set('driver', x)}
            options={[{ value: 'units', label: t('equipment:driver.unitsOption', 'Logged hours or days') }, { value: 'fuel', label: t('equipment:driver.fuelOption', 'Fuel litres') }, { value: 'trips', label: t('equipment:driver.tripsOption', 'Trips') }]} />
          <label className="flex items-center gap-2 self-end text-sm">
            <Checkbox checked={v.countStandby} onChange={(x) => set('countStandby', x)} label={t('equipment:costing.countStandby', 'Count standby toward the share')} />
            {t('equipment:costing.countStandby', 'Count standby toward the share')}
          </label>
        </>}
        <TextField label={t('equipment:costing.effectiveFrom', 'Effective from')} required type="date" value={v.effectiveFrom} onChange={(x) => set('effectiveFrom', x)} />
        <TextField label={t('equipment:costing.effectiveTo', 'Effective to (optional)')} type="date" value={v.effectiveTo} onChange={(x) => set('effectiveTo', x)} />
      </FormGrid>
      <div className="mt-4 space-y-2">
        <Button type="button" variant="outline" disabled={!ready || preview.isPending} onClick={() => void runPreview()}>{t('equipment:costing.preview', 'Preview')}</Button>
        {rows && <DataTable<CostingPreviewRow> embedded rows={rows} columns={previewColumns} rowKey={(r) => `${r.project_id ?? 'pool'}|${r.month}|${r.category ?? ''}`}
          accessibleName={t('equipment:costing.previewLabel', 'Preview of allocations')} tableId="equipment-costing-preview"
          state={rows.length === 0 ? 'empty' : undefined}
          emptyTitle={t('equipment:costing.previewEmpty', 'Nothing would be allocated yet')}
          emptySub={t('equipment:costing.previewEmptySub', 'There is no approved usage or no matching ledger cost in the months covered.')} />}
      </div>
    </EntityFormModal>
  );
};

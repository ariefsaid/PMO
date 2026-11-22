import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListPage, DataTable, StatusPill, ConfirmDialog, EntityFormModal, TextField, SelectField, FormGrid, Checkbox, Button, Icon,
  useEntityForm, useToast, useUrlFilters, type Column, type RowMenuItem, type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { useStockItems, useStockUnits } from '@/src/hooks/useStock';
import { useStandardMatchCounts, useUsageStandardMutations, useUsageStandards } from '@/src/hooks/useUsageStandards';
import { USAGE_STANDARDS_PAGE_SIZE, type UsageStandardRow, type UsageStandardInput } from '@/src/lib/repositories/usageStandards';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatNumberExact } from '@/src/lib/format';

/** `0.050000` -> `0.05`; the standard is shown as typed, without trailing zeros. */
const plain = (v: string): string => (v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v);

type Values = { itemId: string; workUnit: string; boqCodePrefix: string; qtyPerUnit: string; marginPct: string };

/** Consumable usage standards (#2577): "this consumable, this much per unit of work", the organisation's list that work-order consumable plans are generated from. */
const UsageStandards: React.FC = () => {
  const { t } = useTranslation('usageStandards');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  // View-as shares the real login, so the server cannot tell it apart: the page keeps it read-only.
  const ctx = { record: { viewOnly: realRole !== effectiveRole } };
  const { toast } = useToast();
  const { values, setFilter, setFilters } = useUrlFilters(['item', 'unit', 'archived', 'page']);
  const page = Math.max(1, Number.parseInt(values.page || '1', 10) || 1);
  const showArchived = values.archived === 'true';
  const [form, setForm] = useState<{ row: UsageStandardRow | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<UsageStandardRow | null>(null);

  const list = useUsageStandards({ includeArchived: showArchived, itemId: values.item || undefined, workUnit: values.unit || undefined, page: page - 1 });
  const counts = useStandardMatchCounts();
  const items = useStockItems(true);
  const units = useStockUnits(true);
  const m = useUsageStandardMutations();
  const canCreate = may('create', 'usageStandard', ctx);
  const canEdit = may('edit', 'usageStandard', ctx);
  const canArchive = may('archive', 'usageStandard', ctx);

  const itemOf = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const unitCode = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.code])), [units.data]);
  const rows = list.data?.rows ?? [];
  const lookupsFailed = items.isError || units.isError;
  const state: 'loading' | 'empty' | 'error' | undefined = list.isError || lookupsFailed ? 'error'
    : list.isPending || items.isPending || units.isPending ? 'loading' : rows.length === 0 ? 'empty' : undefined;
  const filtered = Boolean(values.item || values.unit);

  const errorCopy = (err: unknown, operation: 'create' | 'update' | 'archive'): SubmitError => {
    const dup = (err as { code?: string } | null)?.code === '23505';
    if (dup) return { headline: t('toast.failed', 'Could not save the standard'), detail: t('form.duplicate', 'A standard for this item, work unit and code prefix already exists. Edit that one instead.') };
    const { headline, detail } = classifyMutationError(err, undefined, { operation, suppressCapture: true });
    return { headline, detail };
  };

  const columns: Column<UsageStandardRow>[] = useMemo(() => {
    const dim = (r: UsageStandardRow) => (r.archivedAt ? 'opacity-60' : '');
    return [
      { key: 'item', header: t('columns.item', 'Item'), rowHeader: true, cell: (r) => {
        const it = itemOf.get(r.itemId);
        return <div className={`min-w-0 ${dim(r)}`}><span className="block truncate record-id font-semibold text-foreground">{it?.code ?? '…'}</span><span className="block truncate text-sm text-muted-foreground">{it?.name ?? ''}</span></div>;
      } },
      { key: 'unit', header: t('columns.workUnit', 'Per unit of work'), cell: (r) => <span className={dim(r)}>{r.workUnit}</span> },
      { key: 'prefix', header: t('columns.prefix', 'Contract line code'), cell: (r) => <span className={dim(r)}>{r.boqCodePrefix ? t('columns.startsWith', 'starts with {{prefix}}', { prefix: r.boqCodePrefix }) : t('columns.anyLine', 'any line')}</span> },
      { key: 'qty', header: t('columns.qty', 'Quantity'), align: 'num', cell: (r) => {
        const it = itemOf.get(r.itemId);
        return <span className={`tabular-nums ${dim(r)}`}>{formatNumberExact(Number(r.qtyPerUnit))} {it ? unitCode.get(it.unit_id) ?? '' : ''}</span>;
      }, exportValue: (r) => plain(r.qtyPerUnit) },
      { key: 'margin', header: t('columns.margin', 'Waste margin'), align: 'num', cell: (r) => <span className={`tabular-nums ${dim(r)}`}>{plain(r.marginPct)}%</span> },
      { key: 'matches', header: t('columns.matches', 'Matches now'), align: 'num', cell: (r) => {
        if (r.archivedAt) return <span className="text-muted-foreground">–</span>;
        if (counts.isError) return <span className="text-muted-foreground">{t('columns.matchesUnavailable', 'Unavailable')}</span>;
        if (!counts.data) return <span className="text-muted-foreground">…</span>;
        const n = counts.data[r.id] ?? 0;
        return n === 0
          ? <span className="text-warning-foreground">{t('columns.matchesNone', 'No lines')}</span>
          : <span className="tabular-nums">{t('columns.matchesLines', '{{n}} lines', { n })}</span>;
      } },
      { key: 'status', header: t('columns.status', 'Status'), cell: (r) => (r.archivedAt ? <StatusPill variant="neutral">{t('archivedBadge', 'Archived')}</StatusPill> : <span className="text-sm text-muted-foreground">{t('active', 'Active')}</span>) },
    ];
  }, [t, itemOf, unitCode, counts.data, counts.isError]);

  const rowMenu = (r: UsageStandardRow): RowMenuItem[] => {
    const out: RowMenuItem[] = [];
    if (canEdit && !r.archivedAt) out.push({ label: t('actions.edit', 'Edit'), onClick: () => setForm({ row: r }) });
    if (canArchive) out.push({ label: r.archivedAt ? t('actions.restore', 'Restore') : t('actions.archive', 'Archive'), onClick: () => (r.archivedAt ? void doArchive(r, false) : setArchiveTarget(r)) });
    return out;
  };
  async function doArchive(r: UsageStandardRow, archived: boolean) {
    try {
      await m.archive.mutateAsync({ id: r.id, archived });
      toast(archived ? t('toast.archived', 'Standard archived') : t('toast.restored', 'Standard restored'), undefined, 'success');
    } catch (err) {
      const e = errorCopy(err, 'archive');
      toast(e.headline, e.detail, 'warning');
    }
    setArchiveTarget(null);
  }

  return (
    <ListPage
      title={t('title', 'Usage standards')}
      count={state === undefined ? list.data?.total : undefined}
      primaryAction={canCreate && (
        <Button variant="primary" onClick={() => setForm({ row: null })}><Icon name="plus" />{t('actions.new', 'New standard')}</Button>
      )}
    >
      <StockTabs />
      <p className="mb-3 text-control text-muted-foreground">{t('intro', 'How much of a consumable a unit of planned work uses. Work orders turn these into a consumable plan.')}</p>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-full sm:w-64">
          <SelectField label={t('filters.item', 'Item')} value={values.item} onChange={(v) => setFilters({ item: v, page: '' })}
            options={[{ value: '', label: t('filters.anyItem', 'Any item') }, ...(items.data ?? []).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }))]} />
        </div>
        <div className="w-full sm:w-48">
          <TextField label={t('filters.workUnit', 'Work unit')} value={values.unit} onChange={(v) => setFilters({ unit: v, page: '' })} />
        </div>
        <div className="flex min-h-11 items-center gap-2">
          <Checkbox checked={showArchived} onChange={(v) => setFilters({ archived: v ? 'true' : '', page: '' })} label={t('filters.showArchived', 'Show archived')} />
          <span className="text-control">{t('filters.showArchived', 'Show archived')}</span>
        </div>
      </div>
      <DataTable<UsageStandardRow>
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        state={state}
        total={state === undefined ? list.data?.total : undefined}
        pagination={{ page, pageSize: USAGE_STANDARDS_PAGE_SIZE, onPageChange: (p) => setFilter('page', p <= 1 ? '' : String(p)) }}
        onRetry={() => { void list.refetch(); void counts.refetch(); void items.refetch(); void units.refetch(); }}
        emptyTitle={filtered ? t('emptyFiltered', 'No standards match these filters') : t('empty', 'No usage standards yet')}
        emptySub={filtered ? undefined : t('emptySub', 'Add one, for example welding rod per dia-inch welded.')}
        rowMenu={canEdit || canArchive ? rowMenu : undefined}
        rowLabel={(r) => t('rowLabel', 'Standard for {{item}}, per {{unit}}', { item: itemOf.get(r.itemId)?.code ?? '', unit: r.workUnit })}
        tableId="usage-standards-table"
      />
      {form && (
        <StandardForm
          row={form.row}
          items={(items.data ?? []).filter((i) => !i.archived_at || i.id === form.row?.itemId)}
          unitCode={unitCode}
          errorCopy={errorCopy}
          onClose={() => setForm(null)}
          onSave={async (input) => {
            if (form.row) await m.update.mutateAsync({ id: form.row.id, input }); else await m.create.mutateAsync(input);
            toast(form.row ? t('toast.updated', 'Standard updated') : t('toast.created', 'Standard added'), undefined, 'success');
            setForm(null);
          }}
        />
      )}
      <ConfirmDialog
        open={archiveTarget !== null}
        title={t('archiveConfirm.title', 'Archive this standard?')}
        description={t('archiveConfirm.body', 'It stops applying to new plans. Plans already generated keep their figures, and you can restore it later.')}
        confirmLabel={t('actions.archive', 'Archive')}
        tone="default"
        loading={m.archive.isPending}
        onConfirm={() => archiveTarget && void doArchive(archiveTarget, true)}
        onCancel={() => setArchiveTarget(null)}
      />
    </ListPage>
  );
};

const StandardForm: React.FC<{
  row: UsageStandardRow | null;
  items: Array<{ id: string; code: string; name: string; unit_id: string }>;
  unitCode: Map<string, string>;
  errorCopy: (err: unknown, op: 'create' | 'update') => SubmitError;
  onClose: () => void;
  onSave: (input: UsageStandardInput) => Promise<void>;
}> = ({ row, items, unitCode, errorCopy, onClose, onSave }) => {
  const { t } = useTranslation('usageStandards');
  const isEdit = row !== null;
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const validate = (v: Values) => {
    const e: Partial<Record<keyof Values, string>> = {};
    if (!v.itemId) e.itemId = t('form.itemRequired', 'Choose the consumable.');
    if (!v.workUnit.trim()) e.workUnit = t('form.workUnitRequired', 'Enter the unit of work, for example dia-inch.');
    else if (v.workUnit.trim().length > 40) e.workUnit = t('form.workUnitLong', 'Keep it under 40 characters.');
    if (v.boqCodePrefix.trim().length > 40) e.boqCodePrefix = t('form.prefixLong', 'Keep it under 40 characters.');
    if (!/^\d{1,8}(\.\d{1,6})?$/.test(v.qtyPerUnit.trim()) || Number(v.qtyPerUnit) <= 0) e.qtyPerUnit = t('form.qtyInvalid', 'Enter a quantity above zero, up to 6 decimals.');
    const mg = v.marginPct.trim() === '' ? '0' : v.marginPct.trim();
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(mg) || Number(mg) > 100) e.marginPct = t('form.marginInvalid', 'Enter 0 to 100, up to 2 decimals.');
    return e;
  };
  const form = useEntityForm<Values>({
    initialValues: { itemId: row?.itemId ?? '', workUnit: row?.workUnit ?? '', boqCodePrefix: row?.boqCodePrefix ?? '', qtyPerUnit: row ? plain(row.qtyPerUnit) : '', marginPct: row ? plain(row.marginPct) : '' },
    validate, idPrefix: 'usage-standard-form', requiredFields: ['itemId', 'workUnit', 'qtyPerUnit'], module: 'stock',
  });
  const f = { item: form.fieldProps('itemId'), unit: form.fieldProps('workUnit'), prefix: form.fieldProps('boqCodePrefix'), qty: form.fieldProps('qtyPerUnit'), margin: form.fieldProps('marginPct') };
  const chosen = items.find((i) => i.id === form.values.itemId);
  const summary = (['itemId', 'workUnit', 'boqCodePrefix', 'qtyPerUnit', 'marginPct'] as const).filter((k) => form.errors[k]).map((k) => ({ fieldId: form.fieldProps(k).id, message: form.errors[k] as string }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      try {
        await onSave({ itemId: v.itemId, workUnit: v.workUnit, boqCodePrefix: v.boqCodePrefix.trim() || null, qtyPerUnit: v.qtyPerUnit, marginPct: v.marginPct });
      } catch (err) { setSaveError(errorCopy(err, isEdit ? 'update' : 'create')); }
    });
  };
  return (
    <EntityFormModal open title={isEdit ? t('form.editTitle', 'Edit usage standard') : t('form.newTitle', 'New usage standard')}
      submitLabel={isEdit ? t('form.submitEdit', 'Save changes') : t('form.submitNew', 'Add standard')} onSubmit={submit} onClose={onClose}
      loading={form.isSubmitting} dirty={form.isDirty} submitDisabled={!form.isComplete} errorSummary={summary.length ? summary : undefined} submitError={saveError}>
      <FormGrid>
        <SelectField id={f.item.id} label={t('form.item', 'Consumable')} required value={f.item.value} onChange={f.item.onChange} onBlur={f.item.onBlur} error={f.item.error}
          disabled={isEdit} helper={isEdit ? t('form.itemLocked', 'To change the item, archive this standard and add a new one.') : undefined}
          placeholder={t('form.itemPlaceholder', 'Choose an item')} options={items.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }))} />
        <TextField id={f.unit.id} label={t('form.workUnit', 'Unit of work')} required helper={t('form.workUnitHelp', 'Matched to the contract line unit, ignoring case and spaces.')}
          value={f.unit.value} onChange={f.unit.onChange} onBlur={f.unit.onBlur} error={f.unit.error} fullWidth />
        <TextField id={f.prefix.id} label={t('form.prefix', 'Contract line code starts with (optional)')} helper={t('form.prefixHelp', 'Leave empty to apply to every contract line with this unit.')}
          value={f.prefix.value} onChange={f.prefix.onChange} onBlur={f.prefix.onBlur} error={f.prefix.error} code fullWidth />
        <TextField id={f.qty.id} label={t('form.qty', 'Quantity per unit of work{{unit}}', { unit: chosen ? ` (${unitCode.get(chosen.unit_id) ?? ''})` : '' })} required inputMode="decimal"
          value={f.qty.value} onChange={f.qty.onChange} onBlur={f.qty.onBlur} error={f.qty.error} />
        <TextField id={f.margin.id} label={t('form.margin', 'Waste margin %')} helper={t('form.marginHelp', 'Added on top. Leave empty for none.')} inputMode="decimal"
          value={f.margin.value} onChange={f.margin.onChange} onBlur={f.margin.onBlur} error={f.margin.error} />
      </FormGrid>
    </EntityFormModal>
  );
};

export default UsageStandards;

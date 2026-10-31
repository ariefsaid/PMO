import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ListPage, ListState, DataTable, StatusPill, ConfirmDialog, EntityFormModal, TextField, TextArea, SelectField, FormGrid,
  Checkbox, Drawer, Tabs, Button, Icon, useEntityForm, useToast, tabId, tabPanelId,
  type Column, type RowMenuItem, type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProjectIdentity } from '@/src/hooks/useProjects';
import {
  useStockUnits, useStockItems, useStockWarehouses, useStockKeepers, useStockKeeperCandidates, useStockMasterMutations,
} from '@/src/hooks/useStock';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { parseStockError } from '@/src/lib/stockErrors';
import type {
  StockItemRow, StockUnitRow, StockWarehouseRow, StockItemInput, StockUnitInput, StockWarehouseInput,
} from '@/src/lib/db/stockMaster';

type Tab = 'units' | 'items' | 'warehouses';
type Table = 'stock_units' | 'stock_items' | 'stock_warehouses';
const TABLE: Record<Tab, Table> = { units: 'stock_units', items: 'stock_items', warehouses: 'stock_warehouses' };
const ENTITY = { units: 'stockUnit', items: 'stockItem', warehouses: 'warehouse' } as const;

/** Stock error copy first (stable `STK_*` code), else the shared mutation classifier. */
function useErrorCopy() {
  const { t } = useTranslation('stock');
  return (err: unknown, operation: 'create' | 'update' | 'archive'): SubmitError => {
    const stock = parseStockError(err);
    if (stock) return { headline: t('setup.toast.failed'), detail: t(`errors.${stock.code}`) };
    const { headline, detail } = classifyMutationError(err, undefined, { operation, suppressCapture: true });
    return { headline, detail };
  };
}

const StockSetup: React.FC = () => {
  const { t } = useTranslation('stock');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  // View-as shares the real login, so the server cannot tell it apart: the page must keep it read-only (FR-STK-064).
  const ctx = { record: { viewOnly: realRole !== effectiveRole } };
  const { toast } = useToast();
  const errorCopy = useErrorCopy();
  const [tab, setTab] = useState<Tab>('units');
  const [showArchived, setShowArchived] = useState(false);
  const [form, setForm] = useState<{ tab: Tab; row: StockUnitRow | StockItemRow | StockWarehouseRow | null } | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<{ tab: Tab; id: string; archived: boolean } | null>(null);
  const [keepersFor, setKeepersFor] = useState<StockWarehouseRow | null>(null);

  const units = useStockUnits(showArchived);
  const allUnits = useStockUnits(true);
  const items = useStockItems(showArchived);
  const warehouses = useStockWarehouses(showArchived);
  const keepers = useStockKeepers();
  const people = useStockKeeperCandidates();
  const projects = useProjectIdentity();
  const m = useStockMasterMutations();

  const canCreate = may('create', ENTITY[tab], ctx);
  const canEdit = may('edit', ENTITY[tab], ctx);
  const canArchive = may('archive', ENTITY[tab], ctx);
  const canKeepers = may('manage', 'warehouse', ctx);

  const unitName = useMemo(() => new Map((allUnits.data ?? []).map((u) => [u.id, u.name])), [allUnits.data]);
  const projectName = useMemo(() => new Map((projects.data ?? []).map((p) => [p.id, p.name])), [projects.data]);
  const personName = useMemo(() => new Map((people.data ?? []).map((p) => [p.id, p.full_name ?? ''])), [people.data]);
  const keepersOf = (wid: string) => (keepers.data ?? []).filter((k) => k.warehouse_id === wid);

  const query = tab === 'units' ? units : tab === 'items' ? items : warehouses;
  const rows = (query.data ?? []) as Array<StockUnitRow | StockItemRow | StockWarehouseRow>;
  // A tab's cells read lookups too (unit names, keepers, people, projects): any failed lookup is an error, never a blank or a zero.
  const needed = tab === 'items' ? [query, allUnits] : tab === 'warehouses' ? [query, keepers, people, projects] : [query];
  const state: 'loading' | 'empty' | 'error' | undefined = needed.some((q) => q.isError) ? 'error' : needed.some((q) => q.isPending) ? 'loading' : rows.length === 0 ? 'empty' : undefined;

  const archivedPill = (r: { archived_at: string | null }) =>
    r.archived_at ? <StatusPill variant="neutral">{t('setup.archivedBadge')}</StatusPill> : null;
  const dim = (r: { archived_at: string | null }) => (r.archived_at ? 'opacity-60' : '');
  const identity = (r: { code: string; name: string; archived_at: string | null }): React.ReactNode => (
    <div className={`min-w-0 ${dim(r)}`}>
      <span className="block truncate font-mono text-sm font-semibold">{r.code}</span>
      <span className="block truncate text-xs text-muted-foreground">{r.name}</span>
    </div>
  );

  const columns: Column<StockUnitRow | StockItemRow | StockWarehouseRow>[] = useMemo(() => {
    const code: Column<StockUnitRow | StockItemRow | StockWarehouseRow> = { key: 'code', header: t('setup.columns.code'), cell: (r) => identity(r), exportValue: (r) => r.code };
    const status: Column<StockUnitRow | StockItemRow | StockWarehouseRow> = { key: 'status', header: t('setup.columns.status'), cell: (r) => archivedPill(r) ?? <span className="text-sm text-muted-foreground">{t('setup.active')}</span> };
    if (tab === 'units') {
      return [code, { key: 'whole', header: t('setup.columns.wholeOnly'), cell: (r) => <span className={dim(r)}>{(r as StockUnitRow).whole_only ? t('setup.wholeOnly.whole') : t('setup.wholeOnly.fractional')}</span> }, status];
    }
    if (tab === 'items') {
      return [
        code,
        { key: 'unit', header: t('setup.columns.unit'), cell: (r) => <span className={dim(r)}>{unitName.get((r as StockItemRow).unit_id) ?? ''}</span> },
        { key: 'lead', header: t('setup.columns.leadTime'), align: 'num', cell: (r) => { const d = (r as StockItemRow).lead_time_days; return <span className={`tabular-nums ${dim(r)}`}>{d === null ? '–' : `${d} ${t('setup.leadTimeDays')}`}</span>; } },
        { key: 'description', header: t('setup.columns.description'), colClassName: 'hidden xl:table-cell', cell: (r) => <span className="line-clamp-1 text-sm text-muted-foreground">{(r as StockItemRow).description ?? ''}</span> },
        status,
      ];
    }
    return [
      code,
      { key: 'kind', header: t('setup.columns.kind'), cell: (r) => <StatusPill variant={(r as StockWarehouseRow).kind === 'central' ? 'open' : 'neutral'}>{t(`setup.kinds.${(r as StockWarehouseRow).kind}`)}</StatusPill> },
      { key: 'project', header: t('setup.columns.project'), cell: (r) => <span className={dim(r)}>{projectName.get((r as StockWarehouseRow).project_id ?? '') ?? ''}</span> },
      {
        key: 'keepers', header: t('setup.columns.keepers'),
        cell: (r) => {
          const ks = keepersOf(r.id);
          return canKeepers ? (
            <Button variant="ghost" size="sm" onClick={() => setKeepersFor(r as StockWarehouseRow)}>
              {t('setup.actions.keepers')} · {ks.length}
            </Button>
          ) : (
            <span className="text-sm">{ks.length === 0 ? t('setup.noKeepers') : ks.map((k) => personName.get(k.user_id) || '').filter(Boolean).join(', ')}</span>
          );
        },
      },
      status,
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tab, unitName, projectName, personName, keepers.data, canKeepers]);

  const rowMenu = (r: StockUnitRow | StockItemRow | StockWarehouseRow): RowMenuItem[] => {
    const out: RowMenuItem[] = [];
    if (canEdit && !r.archived_at) out.push({ label: t('setup.actions.edit'), onClick: () => setForm({ tab, row: r }) });
    if (canArchive) out.push({ label: r.archived_at ? t('setup.actions.restore') : t('setup.actions.archive'), onClick: () => (r.archived_at ? void doArchive(tab, r.id, false) : setArchiveTarget({ tab, id: r.id, archived: true })) });
    return out;
  };

  async function doArchive(which: Tab, id: string, archived: boolean) {
    try {
      await m.archive.mutateAsync({ table: TABLE[which], id, archived });
      toast(archived ? t('setup.toast.archived') : t('setup.toast.restored'), undefined, 'success');
      setArchiveTarget(null);
    } catch (err) {
      const e = errorCopy(err, 'archive');
      toast(e.headline, e.detail, 'warning');
      setArchiveTarget(null);
    }
  }

  const newLabel = tab === 'units' ? t('setup.actions.newUnit') : tab === 'items' ? t('setup.actions.newItem') : t('setup.actions.newWarehouse');
  const emptyKey = tab === 'units' ? 'emptyUnits' : tab === 'items' ? 'emptyItems' : 'emptyWarehouses';

  return (
    <ListPage
      title={t('setup.title')}
      description={t('setup.description')}
      primaryAction={canCreate && (
        <Button variant="primary" onClick={() => setForm({ tab, row: null })}>
          <Icon name="plus" />
          {newLabel}
        </Button>
      )}
    >
      <div className="mb-4 flex items-center border-b border-border">
        <Tabs<Tab>
          className="mb-0 min-w-0 flex-1 border-b-0"
          idBase="stock-setup"
          ariaLabel={t('setup.tabsLabel')}
          value={tab}
          onChange={setTab}
          items={[
            { value: 'units', label: t('setup.tabs.units') },
            { value: 'items', label: t('setup.tabs.items') },
            { value: 'warehouses', label: t('setup.tabs.warehouses') },
          ]}
        />
        <label className="flex shrink-0 items-center gap-2 pl-3 text-sm">
          <Checkbox checked={showArchived} onChange={setShowArchived} label={t('setup.showArchived')} />
          <span aria-hidden onClick={() => setShowArchived(!showArchived)}>{t('setup.showArchived')}</span>
        </label>
      </div>
      {!canCreate && state === undefined && (
        <p className="mt-3 text-sm text-muted-foreground">{t('setup.states.readOnlyHint')}</p>
      )}
      <div className="mt-3" role="tabpanel" id={tabPanelId('stock-setup', tab)} aria-labelledby={tabId('stock-setup', tab)}>
        {state === 'loading' && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={6} /></div>}
        {state === 'error' && (
          <ListState variant="error" title={t('setup.states.errorTitle')} sub={t('setup.states.errorSub')} retryLabel={t('setup.actions.retry')} onRetry={() => needed.filter((q) => q.isError).forEach((q) => void q.refetch())} />
        )}
        {state === 'empty' && (
          <ListState
            variant="empty"
            icon="folder"
            title={t(`setup.states.${emptyKey}.title`)}
            sub={t(`setup.states.${emptyKey}.sub`)}
            action={canCreate ? { label: t(`setup.states.${emptyKey}.action`), onClick: () => setForm({ tab, row: null }) } : undefined}
          />
        )}
        {state === undefined && (
          <DataTable<StockUnitRow | StockItemRow | StockWarehouseRow>
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            rowMenu={canEdit || canArchive ? rowMenu : undefined}
            tableId={`stock-setup-${tab}`}
            accessibleName={t(`setup.tabs.${tab}`)}
          />
        )}
      </div>

      {form && (
        <MasterFormModal
          which={form.tab}
          row={form.row}
          units={(units.data ?? []).filter((u) => !u.archived_at)}
          projects={projects.data ?? []}
          onClose={() => setForm(null)}
          onDone={(isEdit) => { toast(isEdit ? t('setup.toast.updated') : t('setup.toast.created'), undefined, 'success'); setForm(null); }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        tone="default"
        title={t('setup.confirm.archiveTitle')}
        description={t('setup.confirm.archiveDescription')}
        confirmLabel={t('setup.confirm.archiveConfirm')}
        loading={m.archive.isPending}
        onConfirm={() => archiveTarget && void doArchive(archiveTarget.tab, archiveTarget.id, true)}
        onCancel={() => setArchiveTarget(null)}
      />

      {canKeepers && (
        <Drawer
          open={!!keepersFor}
          title={t('setup.keepersPanel.title')}
          subtitle={keepersFor ? `${keepersFor.code} · ${keepersFor.name}` : undefined}
          onClose={() => setKeepersFor(null)}
          loading={m.setKeeper.isPending}
        >
          <p className="mb-3 text-sm text-muted-foreground">{t('setup.keepersPanel.subtitle')}</p>
          {(people.data ?? []).length === 0 && <p className="text-sm">{t('setup.keepersPanel.empty')}</p>}
          <ul className="divide-y divide-border">
            {(people.data ?? []).map((p) => {
              const on = !!keepersFor && keepersOf(keepersFor.id).some((k) => k.user_id === p.id);
              return (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <Checkbox
                    checked={on}
                    label={`${t('setup.keepersPanel.toggleLabel')}: ${p.full_name ?? ''}`}
                    disabled={m.setKeeper.isPending}
                    onChange={(next) => {
                      if (!keepersFor) return;
                      m.setKeeper.mutateAsync({ warehouseId: keepersFor.id, userId: p.id, assigned: next })
                        .then(() => toast(next ? t('setup.toast.keeperAssigned') : t('setup.toast.keeperRemoved'), p.full_name ?? undefined, 'success'))
                        .catch((err: unknown) => { const e = errorCopy(err, 'update'); toast(e.headline, e.detail, 'warning'); });
                    }}
                  />
                  <span className="text-sm">{p.full_name}</span>
                </li>
              );
            })}
          </ul>
        </Drawer>
      )}
    </ListPage>
  );
};

// ── Create / edit modal (one per entity, shared shell) ─────────────────────────────────────────────

interface FormProps {
  which: Tab;
  row: StockUnitRow | StockItemRow | StockWarehouseRow | null;
  units: StockUnitRow[];
  projects: Array<{ id: string; name: string }>;
  onClose: () => void;
  onDone: (isEdit: boolean) => void;
}
interface Values { code: string; name: string; wholeOnly: boolean; description: string; unitId: string; leadTime: string; kind: 'central' | 'site'; projectId: string }

const MasterFormModal: React.FC<FormProps> = ({ which, row, units, projects, onClose, onDone }) => {
  const { t } = useTranslation('stock');
  const m = useStockMasterMutations();
  const errorCopy = useErrorCopy();
  const isEdit = !!row;
  const k = which === 'units' ? 'unit' : which === 'items' ? 'item' : 'warehouse';
  const unitRow = row as StockUnitRow | null;
  const itemRow = row as StockItemRow | null;
  const whRow = row as StockWarehouseRow | null;

  const validate = (v: Values) => {
    const e: Partial<Record<keyof Values, string>> = {};
    if (!v.code.trim()) e.code = t(`setup.form.${k}.codeRequired`);
    if (!v.name.trim()) e.name = t(`setup.form.${k}.nameRequired`);
    if (which === 'items') {
      if (!v.unitId) e.unitId = t('setup.form.item.unitRequired');
      if (v.leadTime.trim() && !(/^\d+$/.test(v.leadTime.trim()) && Number(v.leadTime) <= 365)) e.leadTime = t('setup.form.item.leadTimeInvalid');
    }
    return e;
  };
  const form = useEntityForm<Values>({
    initialValues: {
      code: row ? (row as { code: string }).code : '', name: row ? (row as { name: string }).name : '',
      wholeOnly: unitRow?.whole_only ?? false, description: itemRow?.description ?? '', unitId: itemRow?.unit_id ?? '',
      leadTime: itemRow?.lead_time_days == null ? '' : String(itemRow.lead_time_days), kind: (whRow?.kind as Values['kind'] | undefined) ?? 'site', projectId: whRow?.project_id ?? '',
    },
    validate,
    idPrefix: `stock-${k}-form`,
    requiredFields: which === 'items' ? ['code', 'name', 'unitId'] : ['code', 'name'],
    module: 'stock',
  });
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const code = form.fieldProps('code');
  const name = form.fieldProps('name');
  const unitId = form.fieldProps('unitId');
  const leadTime = form.fieldProps('leadTime');
  const description = form.fieldProps('description');
  const kind = form.fieldProps('kind');
  const projectId = form.fieldProps('projectId');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      try {
        if (which === 'units') {
          const input: StockUnitInput = { code: v.code, name: v.name, wholeOnly: v.wholeOnly };
          if (row) await m.updateUnit.mutateAsync({ id: row.id, input }); else await m.createUnit.mutateAsync(input);
        } else if (which === 'items') {
          const input: StockItemInput = { code: v.code, name: v.name, description: v.description || null, unitId: v.unitId, leadTimeDays: v.leadTime.trim() ? Number(v.leadTime) : null };
          if (row) await m.updateItem.mutateAsync({ id: row.id, input }); else await m.createItem.mutateAsync(input);
        } else {
          const input: StockWarehouseInput = { code: v.code, name: v.name, kind: v.kind, projectId: v.projectId || null };
          if (row) await m.updateWarehouse.mutateAsync({ id: row.id, input }); else await m.createWarehouse.mutateAsync(input);
        }
        onDone(isEdit);
      } catch (err) {
        setSaveError(errorCopy(err, isEdit ? 'update' : 'create'));
      }
    });
  };

  const summary = (['code', 'name', 'unitId', 'leadTime'] as const)
    .filter((f) => form.errors[f])
    .map((f) => ({ fieldId: form.fieldProps(f).id, message: form.errors[f] as string }));

  return (
    <EntityFormModal
      open
      title={t(`setup.form.${k}.${isEdit ? 'editTitle' : 'newTitle'}`)}
      submitLabel={t(`setup.form.${k}.${isEdit ? 'submitEdit' : 'submitNew'}`)}
      onSubmit={submit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={summary.length ? summary : undefined}
      submitError={saveError}
    >
      <FormGrid>
        <TextField id={code.id} label={t(`setup.form.${k}.code`)} required value={code.value} onChange={code.onChange} onBlur={code.onBlur} error={code.error} mono fullWidth />
        <TextField id={name.id} label={t(`setup.form.${k}.name`)} required value={name.value} onChange={name.onChange} onBlur={name.onBlur} error={name.error} fullWidth />
        {which === 'units' && (
          <div className="flex items-start gap-2">
            <Checkbox checked={form.values.wholeOnly} onChange={(v) => form.setValue('wholeOnly', v)} label={t('setup.form.unit.wholeOnly')} describedBy="stock-unit-whole-help" />
            <div>
              <span className="text-sm font-medium" onClick={() => form.setValue('wholeOnly', !form.values.wholeOnly)}>{t('setup.form.unit.wholeOnly')}</span>
              <p id="stock-unit-whole-help" className="text-xs text-muted-foreground">{t('setup.form.unit.wholeOnlyHelp')}</p>
            </div>
          </div>
        )}
        {which === 'items' && (
          <>
            <SelectField id={unitId.id} label={t('setup.form.item.unit')} required value={unitId.value} onChange={unitId.onChange} onBlur={unitId.onBlur} error={unitId.error}
              placeholder={t('setup.form.item.unitPlaceholder')} options={units.map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))} />
            <TextField id={leadTime.id} label={t('setup.form.item.leadTime')} helper={t('setup.form.item.leadTimeHelp')} value={leadTime.value} onChange={leadTime.onChange} onBlur={leadTime.onBlur} error={leadTime.error} inputMode="numeric" />
            <TextArea id={description.id} label={t('setup.form.item.description')} value={description.value} onChange={description.onChange} onBlur={description.onBlur} fullWidth />
          </>
        )}
        {which === 'warehouses' && (
          <>
            <SelectField id={kind.id} label={t('setup.form.warehouse.kind')} required value={kind.value} onChange={(v) => kind.onChange(v as 'central' | 'site')} onBlur={kind.onBlur}
              options={[{ value: 'central', label: t('setup.kinds.central') }, { value: 'site', label: t('setup.kinds.site') }]} />
            <SelectField id={projectId.id} label={t('setup.form.warehouse.project')} helper={t('setup.form.warehouse.projectHelp')} value={projectId.value} onChange={projectId.onChange} onBlur={projectId.onBlur}
              placeholder={t('setup.form.warehouse.noProject')} options={projects.map((p) => ({ value: p.id, label: p.name }))} />
          </>
        )}
      </FormGrid>
    </EntityFormModal>
  );
};

export default StockSetup;

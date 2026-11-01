import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, DataTable, ListPage, ListState, SelectField, TextField, useToast, type Column } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { StockError } from '@/src/components/stock/StockError';
import { ItemPicker } from '@/src/components/stock/ItemPicker';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useBelowReorder, useReorderSuggestion, useSetReorderLevel, useStockItems, useStockUnits, useStockWarehouses } from '@/src/hooks/useStock';
import { formatQuantity } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';
import type { BelowReorderRow } from '@/src/lib/db/stockReorder';

// A level is 0 or more, a quantity above 0; 3 decimals at most (the storage scale). The server re-checks both.
const LEVEL_RE = /^\d+(\.\d{1,3})?$/;
const isPositive = (v: string) => LEVEL_RE.test(v) && Number(v) > 0;

interface ClearTarget { warehouseId: string; itemId: string; label: string; warehouseCode: string }

/** Reorder levels: a suggestion from past usage, accept or edit it, and the list of items at or below their level (#1512 S6). */
const StockReorder: React.FC = () => {
  const { t } = useTranslation('stock');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const { toast } = useToast();
  const errorText = useStockErrorText();
  const loc = getNumberLocale();
  const canEdit = may('edit', 'reorderLevel', { record: { viewOnly: realRole !== effectiveRole } });

  const [itemId, setItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [editing, setEditing] = useState(false);
  const [level, setLevel] = useState('');
  const [quantity, setQuantity] = useState('');
  const [formErrors, setFormErrors] = useState<{ level?: string; quantity?: string }>({});
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [clearTarget, setClearTargetRaw] = useState<ClearTarget | null>(null);
  const setClearTarget = (target: ClearTarget | null) => { setSubmitError(null); setClearTargetRaw(target); };

  const warehouses = useStockWarehouses(false);
  const items = useStockItems(true);
  const units = useStockUnits(true);
  const worklist = useBelowReorder();
  const suggestion = useReorderSuggestion(warehouseId || undefined, itemId || undefined);
  const setM = useSetReorderLevel();

  const item = (items.data ?? []).find((i) => i.id === itemId);
  const unitCode = (units.data ?? []).find((u) => u.id === item?.unit_id)?.code ?? '';
  const s = suggestion.data;
  const q = (v: string) => formatQuantity(v, loc);

  const pick = (nextItem: string, nextWarehouse: string) => { setItemId(nextItem); setWarehouseId(nextWarehouse); setEditing(false); setSubmitError(null); setFormErrors({}); };
  const startEdit = (lv: string, qty: string | null) => { setLevel(lv); setQuantity(qty ?? ''); setFormErrors({}); setSubmitError(null); setEditing(true); };

  const save = async (a: { level: string | null; quantity?: string | null }, okKey: 'saved' | 'cleared', target = { warehouseId, itemId }) => {
    setSubmitError(null);
    try {
      await setM.mutateAsync({ warehouseId: target.warehouseId, itemId: target.itemId, ...a });
      toast(t(`reorder.toast.${okKey}`), undefined, 'success');
      setEditing(false);
      return true;
    } catch (err) {
      setSubmitError(err);
      toast(t('reorder.toast.failed'), errorText(err), 'warning');
      return false;
    }
  };

  const submitEdit = () => {
    const errs: { level?: string; quantity?: string } = {};
    if (!LEVEL_RE.test(level)) errs.level = t('reorder.errors.levelInvalid');
    if (quantity !== '' && !isPositive(quantity)) errs.quantity = t('reorder.errors.quantityInvalid');
    setFormErrors(errs);
    if (errs.level || errs.quantity) return;
    void save({ level, quantity: quantity === '' ? null : quantity }, 'saved');
  };

  const rows = worklist.data ?? [];
  const state: 'loading' | 'empty' | 'error' | undefined = worklist.isError ? 'error' : worklist.isPending ? 'loading' : rows.length === 0 ? 'empty' : undefined;

  const columns: Column<BelowReorderRow>[] = useMemo(() => {
    const cols: Column<BelowReorderRow>[] = [
      {
        key: 'item', header: t('reorder.worklist.columns.item'), rowHeader: true, stickyLeft: true,
        cell: (r) => (
          <div className="min-w-0">
            <span className="block truncate font-mono text-sm font-semibold">{r.itemCode}</span>
            <span className="block truncate text-xs text-muted-foreground">{r.itemName}</span>
          </div>
        ),
        exportValue: (r) => r.itemCode,
      },
      { key: 'warehouse', header: t('reorder.worklist.columns.warehouse'), cell: (r) => <span className="font-mono text-sm">{r.warehouseCode}</span>, exportValue: (r) => r.warehouseCode },
      { key: 'onHand', header: t('reorder.worklist.columns.onHand'), align: 'num', cell: (r) => <span className="tabular-nums">{q(r.qtyOnHand)} <span className="text-muted-foreground">{r.unitCode}</span></span>, exportValue: (r) => r.qtyOnHand },
      { key: 'level', header: t('reorder.worklist.columns.level'), align: 'num', cell: (r) => <span className="tabular-nums">{q(r.reorderLevel)} <span className="text-muted-foreground">{r.unitCode}</span></span>, exportValue: (r) => r.reorderLevel },
      { key: 'qty', header: t('reorder.worklist.columns.orderQuantity'), align: 'num', cell: (r) => <span className="tabular-nums">{r.reorderQuantity ? <>{q(r.reorderQuantity)} <span className="text-muted-foreground">{r.unitCode}</span></> : ''}</span>, exportValue: (r) => r.reorderQuantity ?? '' },
    ];
    if (canEdit) {
      cols.push({
        key: 'actions', header: t('reorder.worklist.columns.actions'), align: 'num',
        cell: (r) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" aria-label={t('reorder.worklist.rowEdit', { item: r.itemCode })}
              onClick={() => { pick(r.itemId, r.warehouseId); startEdit(r.reorderLevel, r.reorderQuantity); }}>{t('reorder.worklist.edit')}</Button>
            <Button variant="ghost" size="sm" aria-label={t('reorder.worklist.rowClear', { item: r.itemCode })}
              onClick={() => setClearTarget({ warehouseId: r.warehouseId, itemId: r.itemId, label: `${r.itemCode} - ${r.itemName}`, warehouseCode: r.warehouseCode })}>{t('reorder.worklist.clear')}</Button>
          </div>
        ),
      });
    }
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- q follows loc
  }, [t, loc, canEdit]);

  const whOption = (w: { id: string; code: string; name: string }) => ({ value: w.id, label: `${w.code} - ${w.name}` });

  return (
    <ListPage title={t('reorder.title')} description={t('reorder.description')} count={state === undefined ? rows.length : undefined}>
      <StockTabs />

      <section aria-labelledby="reorder-panel-title" className="mb-6 rounded-lg border border-border bg-card p-4">
        <h2 id="reorder-panel-title" className="mb-3 text-base font-semibold">{t('reorder.panel.title')}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <ItemPicker label={t('reorder.panel.item')} value={itemId || null} onChange={(v) => pick(v, warehouseId)} />
          <SelectField
            label={t('reorder.panel.warehouse')}
            value={warehouseId}
            onChange={(v) => pick(itemId, v)}
            options={(warehouses.data ?? []).map(whOption)}
            placeholder={t('reorder.panel.warehousePlaceholder')}
          />
        </div>

        {(!itemId || !warehouseId) && <p className="mt-3 text-sm text-muted-foreground">{t('reorder.panel.pick')}</p>}
        {itemId && warehouseId && suggestion.isPending && <div className="mt-3"><ListState variant="loading" rows={2} /></div>}
        {itemId && warehouseId && suggestion.isError && (
          <div className="mt-3"><StockError error={suggestion.error} /></div>
        )}

        {s && (
          <div className="mt-4 space-y-3">
            <p className="text-sm" data-testid="current-level">
              {s.current
                ? <>{t('reorder.panel.current', { level: q(s.current.reorderLevel), unit: unitCode }).trim()}{s.current.reorderQuantity ? `, ${t('reorder.panel.currentQuantity', { quantity: q(s.current.reorderQuantity), unit: unitCode }).trim()}` : ''}</>
                : <span className="text-muted-foreground">{t('reorder.panel.noCurrent')}</span>}
            </p>
            {s.status === 'ok' && s.suggestion ? (
              <>
                <dl className="grid max-w-md grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('reorder.panel.suggestedLevel')}</dt>
                    <dd className="text-lg font-semibold tabular-nums" data-testid="suggested-level">{q(s.suggestion.reorderLevel)} <span className="text-sm font-normal text-muted-foreground">{unitCode}</span></dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">{t('reorder.panel.suggestedQuantity')}</dt>
                    <dd className="text-lg font-semibold tabular-nums" data-testid="suggested-quantity">{q(s.suggestion.reorderQuantity ?? '0')} <span className="text-sm font-normal text-muted-foreground">{unitCode}</span></dd>
                  </div>
                </dl>
                <p className="text-sm text-muted-foreground">
                  {t('reorder.panel.basis', {
                    usage: q(s.inputs.usage ?? '0'), unit: unitCode, days: s.inputs.windowDays, avg: q(s.inputs.avgDailyUsage ?? '0'),
                    lead: s.inputs.leadTimeDays, safety: s.inputs.safetyDays, cycle: s.inputs.orderCycleDays,
                  })}
                </p>
              </>
            ) : (
              <p className="text-sm">
                {t('reorder.panel.insufficient', { minDays: s.inputs.minHistoryDays, minMoves: s.inputs.minMovements, days: s.inputs.historyDays, moves: s.inputs.usageMovements })}
              </p>
            )}

            {canEdit && !editing && (
              <div className="flex flex-wrap gap-2">
                {s.status === 'ok' && s.suggestion && (
                  <Button size="sm" loading={setM.isPending} onClick={() => void save({ level: s.suggestion!.reorderLevel, quantity: s.suggestion!.reorderQuantity }, 'saved')}>{t('reorder.panel.accept')}</Button>
                )}
                {s.status === 'ok' && s.suggestion
                  ? <Button size="sm" variant="outline" onClick={() => startEdit(s.current?.reorderLevel ?? s.suggestion!.reorderLevel, s.current ? s.current.reorderQuantity : s.suggestion!.reorderQuantity)}>{t('reorder.panel.edit')}</Button>
                  : <Button size="sm" variant="outline" onClick={() => startEdit(s.current?.reorderLevel ?? '', s.current?.reorderQuantity ?? null)}>{t('reorder.panel.setManually')}</Button>}
                {s.current && (
                  <Button size="sm" variant="ghost" onClick={() => setClearTarget({ warehouseId, itemId, label: item ? `${item.code} - ${item.name}` : '', warehouseCode: (warehouses.data ?? []).find((w) => w.id === warehouseId)?.code ?? '' })}>{t('reorder.panel.clear')}</Button>
                )}
              </div>
            )}
          </div>
        )}

        {canEdit && editing && itemId && warehouseId && (
          <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); submitEdit(); }} noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField label={unitCode ? `${t('reorder.panel.level')} (${unitCode})` : t('reorder.panel.level')} value={level} onChange={setLevel} inputMode="decimal" required error={formErrors.level} />
              <TextField label={unitCode ? `${t('reorder.panel.quantity')} (${unitCode})` : t('reorder.panel.quantity')} value={quantity} onChange={setQuantity} inputMode="decimal" error={formErrors.quantity} />
            </div>
            <StockError error={submitError} />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={setM.isPending}>{t('reorder.panel.save')}</Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>{t('reorder.panel.cancel')}</Button>
            </div>
          </form>
        )}
      </section>

      <h2 className="mb-2 text-base font-semibold">{t('reorder.worklist.title')}</h2>
      {state === 'loading' && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={4} /></div>}
      {state === 'error' && (
        <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void worklist.refetch()} />
      )}
      {state === 'empty' && <ListState variant="empty" icon="folder" title={t('reorder.worklist.emptyTitle')} sub={t('reorder.worklist.emptySub')} />}
      {state === undefined && (
        <DataTable<BelowReorderRow>
          rows={rows}
          columns={columns}
          rowKey={(r) => `${r.itemId}:${r.warehouseId}`}
          tableId="stock-below-reorder"
          accessibleName={t('reorder.worklist.title')}
        />
      )}

      <ConfirmDialog
        open={clearTarget !== null}
        tone="destructive"
        title={t('reorder.confirmClear.title')}
        description={<>{t('reorder.confirmClear.description', { item: clearTarget?.label ?? '', warehouse: clearTarget?.warehouseCode ?? '' })}{clearTarget && submitError ? <div className="mt-2"><StockError error={submitError} /></div> : null}</>}
        confirmLabel={t('reorder.confirmClear.confirm')}
        loading={setM.isPending}
        onConfirm={() => { if (clearTarget) void save({ level: null }, 'cleared', clearTarget).then((ok) => { if (ok) setClearTarget(null); }); }}
        onCancel={() => setClearTarget(null)}
      />
    </ListPage>
  );
};

export default StockReorder;

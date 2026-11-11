import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, FormGrid, FormSection, ListState, MobileActionBar, SelectField, TextArea, TextField, useToast, Icon } from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { ItemPicker } from '@/src/components/stock/ItemPicker';
import { StockError } from '@/src/components/stock/StockError';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useStockDocument, useStockDocumentCosts, useStockDocumentMutations, useStockItems, useStockKeepers, useStockOnHand, useStockUnits, useStockWarehouses } from '@/src/hooks/useStock';
import { isPositiveDecimal, isWholeQuantity, normalizeDecimal, subtractDecimal } from '@/src/lib/stockFormat';
import type { StockDocumentDetail, StockDocumentInput, StockLineCost, StockLineInput } from '@/src/lib/db/stockDocuments';

type WriteOffKind = 'adjustment' | 'count';
// costOnFile: a reopened line whose stored cost this user may not read (rank < 20); left empty, the server keeps it (0416).
interface Line { key: number; itemId: string | null; counted: string; quantity: string; direction: 'in' | 'out'; unitCost: string; costOnFile?: boolean }
const blank = (key: number, itemId: string | null = null): Line => ({ key, itemId, counted: '', quantity: '', direction: 'out', unitCost: '' });
const COUNTED = /^\d+(\.\d{1,3})?$/;
const COST = /^\d+(\.\d{1,4})?$/;

/**
 * Adjustment and Count (#1512 S4, FR-STK-024/025/062). New at /stock/new/:kind, or a Draft reopened at
 * /stock/documents/:documentId/edit. A write-off is posted by someone else (rank >= 20): its author saves a Draft;
 * only a count with no variance may be posted by its author. The server re-checks all of it.
 */
const StockCount: React.FC = () => {
  const { t } = useTranslation('stock');
  const { kind: kindParam, documentId } = useParams<{ kind: string; documentId: string }>();
  const existing = useStockDocument(documentId);
  const costs = useStockDocumentCosts(documentId);
  if (documentId) {
    if (existing.isPending || costs.isPending) return <Shell title={t('kinds.count')}><div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={4} /></div></Shell>;
    if (existing.isError || costs.isError) return <Shell title={t('kinds.count')}><ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => { void existing.refetch(); void costs.refetch(); }} /></Shell>;
    const d = existing.data;
    if (!d || d.status !== 'Draft' || (d.kind !== 'adjustment' && d.kind !== 'count')) {
      return <Shell title={t('kinds.count')}><ListState variant="empty" icon="folder" title={t('count.notEditable.title')} sub={t('count.notEditable.sub')} /></Shell>;
    }
    return <WriteOffForm kind={d.kind} draft={d} costs={costs.data} />;
  }
  return kindParam === 'adjustment' || kindParam === 'count' ? <WriteOffForm kind={kindParam} /> : null;
};

const Shell: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div className="mx-auto w-full max-w-5xl px-4 py-4">
    <h1 className="mb-4 text-[24px] font-bold tracking-[-0.02em]">{title}</h1>
    <StockTabs />
    {children}
  </div>
);

const WriteOffForm: React.FC<{ kind: WriteOffKind; draft?: StockDocumentDetail; costs?: StockLineCost[] }> = ({ kind, draft, costs }) => {
  const { t } = useTranslation('stock');
  const navigate = useNavigate();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser?.id;
  const m = useStockDocumentMutations();

  const warehouses = useStockWarehouses(false);
  const keepers = useStockKeepers();
  const items = useStockItems(false);
  const units = useStockUnits(true);

  const requestId = useRef<string>(crypto.randomUUID()); // FR-STK-015
  const nextKey = useRef(2);
  const [warehouseId, setWarehouseId] = useState(draft?.warehouse_id ?? '');
  const [reason, setReason] = useState(draft?.reason ?? '');
  const [note, setNote] = useState(draft?.note ?? '');
  const [lines, setLines] = useState<Line[]>(() => draft?.lines.length
    ? draft.lines.map((l, i) => {
      const c = costs?.find((x) => x.lineId === l.id);
      return { key: i + 1, itemId: l.item_id, counted: l.counted_quantity ?? '', quantity: l.quantity ?? '', direction: l.direction ?? 'out', unitCost: c?.unitCost ?? '', costOnFile: Boolean(c?.hasCost && !c.unitCost) };
    })
    : [blank(1)]);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => { if (draft) nextKey.current = draft.lines.length + 1; }, [draft]);

  const onHand = useStockOnHand({ warehouseId, includeZero: true }, Boolean(warehouseId));
  const viewOnly = realRole !== effectiveRole;
  const isAdmin = realRole === 'Admin';
  const canSeeCost = may('create', 'stockItem'); // FR-STK-063
  const keptIds = useMemo(() => new Set((keepers.data ?? []).filter((k) => k.user_id === me).map((k) => k.warehouse_id)), [keepers.data, me]);
  const usable = useMemo(() => (warehouses.data ?? []).filter((w) => isAdmin || keptIds.has(w.id)), [warehouses.data, isAdmin, keptIds]);
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const wholeByUnit = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.whole_only])), [units.data]);
  // System quantity per item at the chosen warehouse; undefined while unknown (never a fabricated zero).
  const systemOf = (itemId: string | null): string | undefined => {
    if (!itemId || !warehouseId || !onHand.data) return undefined;
    return onHand.data.find((r) => r.itemId === itemId && r.warehouseId === warehouseId)?.qtyOnHand ?? '0';
  };
  const varianceOf = (l: Line): string | undefined => {
    const c = normalizeDecimal(l.counted); const s = systemOf(l.itemId);
    return s !== undefined && COUNTED.test(c) ? subtractDecimal(c, s) : undefined;
  };

  const loadError = warehouses.isError || keepers.isError || items.isError || units.isError;
  const pending = warehouses.isPending || keepers.isPending || items.isPending || units.isPending;
  const retry = () => { for (const q of [warehouses, keepers, items, units]) if (q.isError) void q.refetch(); };
  const canAuthor = may('create', 'stockDocument', { record: { isKeeper: keptIds.has(warehouseId), viewOnly } });
  const variances = lines.map(varianceOf);
  // FR-STK-062: a count whose every line is known and zero may be posted by its author; anything else goes to another person.
  const selfPostable = kind === 'count' && variances.every((v) => v === '0');
  const busy = m.create.isPending || m.saveDraft.isPending || m.post.isPending;
  const heading = draft ? `${t(`kinds.${kind}`)} ${draft.number}` : t(`kinds.${kind}`);

  const setLine = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const whole = (l: Line) => { const i = l.itemId ? itemById.get(l.itemId) : undefined; return i ? (wholeByUnit.get(i.unit_id) ?? false) : false; };

  function validate(): StockDocumentInput | null {
    const e: Record<string, string> = {};
    if (!warehouseId) e.warehouse = t('form.errors.warehouse');
    if (kind === 'adjustment' && !reason.trim()) e.reason = t('count.errors.reason');
    const seen = new Set<string>();
    const out: StockLineInput[] = lines.map((l) => {
      if (!l.itemId) e[`item${l.key}`] = t('form.errors.item');
      else if (kind === 'count' && seen.has(l.itemId)) e[`item${l.key}`] = t('count.errors.duplicate');
      if (l.itemId) seen.add(l.itemId);
      const cost = normalizeDecimal(l.unitCost);
      const sys = systemOf(l.itemId);
      if (cost && !COST.test(cost)) e[`cost${l.key}`] = t('form.errors.unitCost');
      if (kind === 'count') {
        const c = normalizeDecimal(l.counted);
        if (!COUNTED.test(c)) e[`qty${l.key}`] = t('count.errors.counted');
        else if (whole(l) && !isWholeQuantity(c)) e[`qty${l.key}`] = t('errors.STK_FRACTION');
        else if (sys === '0' && c !== '0' && /[1-9]/.test(c) && !cost && !l.costOnFile) e[`cost${l.key}`] = t('count.errors.costNeeded');
        return { itemId: l.itemId ?? '', countedQuantity: c, ...(cost ? { unitCost: cost } : {}) };
      }
      const q = normalizeDecimal(l.quantity);
      if (!isPositiveDecimal(q)) e[`qty${l.key}`] = t('form.errors.quantity');
      else if (whole(l) && !isWholeQuantity(q)) e[`qty${l.key}`] = t('errors.STK_FRACTION');
      if (l.direction === 'in' && sys === '0' && !cost && !l.costOnFile) e[`cost${l.key}`] = t('count.errors.costNeeded');
      return { itemId: l.itemId ?? '', quantity: q, direction: l.direction, ...(l.direction === 'in' && cost ? { unitCost: cost } : {}) };
    });
    setErrors(e);
    if (Object.keys(e).length) return null;
    return {
      kind, warehouseId,
      ...(kind === 'adjustment' ? { reason: reason.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      lines: out,
    };
  }

  async function submit(post: boolean) {
    const input = validate();
    if (!input) return;
    setSubmitError(null);
    try {
      let id = draft?.id;
      if (id) {
        await m.saveDraft.mutateAsync({ id, input });
        if (post) await m.post.mutateAsync({ id, revision: draft ? draft.revision + 1 : undefined });   // the revision this save made
      } else {
        id = await m.create.mutateAsync({ input, post, clientRequestId: requestId.current });
        requestId.current = crypto.randomUUID();
      }
      toast(t(post ? 'form.posted' : 'count.saved'), t(`kinds.${kind}`), 'success');
      navigate(`/stock/documents/${id}`);
    } catch (err) {
      setSubmitError(err);
    }
  }

  function fillFromOnHand() {
    const rows = (onHand.data ?? []).filter((r) => r.warehouseId === warehouseId && Number(r.qtyOnHand) > 0);
    if (!rows.length) return;
    setLines(rows.map((r, i) => blank(i + 1, r.itemId)));
    nextKey.current = rows.length + 1;
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4">
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">{heading}</h1>
      <p className="mb-4 mt-1 text-sm text-muted-foreground">{t(`count.intro.${kind}`)}</p>
      <StockTabs />

      {pending && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={4} /></div>}
      {!pending && loadError && <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={retry} />}
      {!pending && !loadError && usable.length === 0 && <ListState variant="empty" icon="folder" title={t('form.noWarehouse.title')} sub={t('form.noWarehouse.sub')} />}
      {!pending && !loadError && usable.length > 0 && (
        <form onSubmit={(e) => { e.preventDefault(); void submit(selfPostable); }} noValidate className="space-y-4 pb-24 md:pb-0">
          {viewOnly && <p className="text-sm text-muted-foreground">{t('form.viewOnly')}</p>}
          <FormSection legend={t('form.sections.where')}>
            <FormGrid>
              <SelectField label={t('form.warehouse')} required value={warehouseId} onChange={setWarehouseId}
                options={usable.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))} placeholder={t('form.warehousePlaceholder')} error={errors.warehouse} />
              {kind === 'adjustment' && (
                <TextField label={t('count.reason')} required value={reason} onChange={setReason} helper={t('count.reasonHelp')} error={errors.reason} />
              )}
            </FormGrid>
          </FormSection>

          <FormSection legend={t(kind === 'count' ? 'count.sections.sheet' : 'form.sections.lines')}>
            {warehouseId && onHand.isError && (
              <div className="mb-3"><ListState variant="error" title={t('count.onHandFailed')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={() => void onHand.refetch()} /></div>
            )}
            {kind === 'count' && warehouseId && onHand.data && (
              <Button type="button" variant="outline" size="sm" className="mb-3" onClick={fillFromOnHand}>{t('count.fill')}</Button>
            )}
            <div className="space-y-3">
              {lines.map((l, idx) => {
                const n = lines.length > 1 ? ` ${idx + 1}` : '';
                const sys = systemOf(l.itemId);
                const v = variances[idx];
                const unitCode = l.itemId ? (units.data ?? []).find((u) => u.id === itemById.get(l.itemId as string)?.unit_id)?.code ?? '' : '';
                const needsCost = kind === 'count' ? sys === '0' && v !== undefined && v !== '0' : l.direction === 'in';
                const costLabel = `${canSeeCost ? t('form.unitCost') : t('form.unitCostBlind')}${n}`;
                return (
                  <div key={l.key} className="rounded-lg border border-border bg-card p-3">
                    <FormGrid>
                      <ItemPicker label={`${t('form.item')}${n}`} required value={l.itemId} onChange={(id) => setLine(l.key, { itemId: id })} error={errors[`item${l.key}`]} />
                      {kind === 'adjustment' && (
                        <SelectField label={`${t('count.direction')}${n}`} required value={l.direction} onChange={(d) => setLine(l.key, { direction: d as 'in' | 'out' })}
                          options={[{ value: 'out', label: t('count.out') }, { value: 'in', label: t('count.in') }]} />
                      )}
                      <TextField label={`${t(kind === 'count' ? 'count.counted' : 'form.quantity')}${n}`} required inputMode="decimal" autoComplete="off"
                        value={kind === 'count' ? l.counted : l.quantity} onChange={(x) => setLine(l.key, kind === 'count' ? { counted: x } : { quantity: x })} error={errors[`qty${l.key}`]} />
                      {needsCost && (
                        <TextField label={costLabel} required={sys === '0' && !l.costOnFile} inputMode="decimal" autoComplete="off" value={l.unitCost} onChange={(x) => setLine(l.key, { unitCost: x })}
                          helper={l.costOnFile ? t('count.costOnFile') : sys === '0' ? undefined : t('count.costDefault')} error={errors[`cost${l.key}`]} />
                      )}
                    </FormGrid>
                    {sys !== undefined && (
                      <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                        <div className="flex gap-2"><dt className="text-muted-foreground">{t('count.systemNow')}</dt><dd className="tabular-nums" data-testid={`system-${idx + 1}`}>{sys} {unitCode}</dd></div>
                        {kind === 'count' && v !== undefined && (
                          <div className="flex gap-2"><dt className="text-muted-foreground">{t('count.variance')}</dt>
                            <dd className="font-semibold tabular-nums" data-testid={`variance-${idx + 1}`}>{v === '0' || v.startsWith('-') ? v : `+${v}`} {unitCode}</dd></div>
                        )}
                      </dl>
                    )}
                    {lines.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>{t('form.removeLine')}</Button>
                    )}
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blank(nextKey.current++)])}>
                <Icon name="plus" />
                {t('form.addLine')}
              </Button>
            </div>
          </FormSection>

          <FormSection legend={t('form.sections.details')}>
            <TextArea label={t('form.note')} value={note} onChange={setNote} rows={2} />
          </FormSection>

          <StockError error={submitError} />

          {canAuthor ? (
            <MobileActionBar className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-3 md:static md:border-0 md:bg-transparent md:p-0">
              <div className="flex flex-wrap items-center justify-end gap-2">
                {!selfPostable && <p className="mr-auto text-sm text-muted-foreground">{t('count.anotherPerson')}</p>}
                <Button type="button" variant="ghost" onClick={() => navigate('/stock/documents')}>{t('actions.cancel')}</Button>
                <Button type={selfPostable ? 'button' : 'submit'} variant={selfPostable ? 'outline' : 'primary'} loading={busy && !selfPostable} onClick={selfPostable ? () => void submit(false) : undefined}>
                  {t('count.saveDraft')}
                </Button>
                {selfPostable && <Button type="submit" variant="primary" loading={busy}>{t('count.post')}</Button>}
              </div>
            </MobileActionBar>
          ) : (
            <p className="text-sm text-muted-foreground">{warehouseId ? t('form.notKeeper') : t('form.pickWarehouse')}</p>
          )}
        </form>
      )}
    </div>
  );
};

export default StockCount;

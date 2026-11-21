import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, EntityFormModal, FormGrid, ListState, RecordSection, SelectField, StatusPill, TextArea, TextField, useEntityForm, useToast, type SubmitError } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useStockItems } from '@/src/hooks/useStock';
import { useConsumablePlan, useConsumablePlanMutations, usePlanInputs } from '@/src/hooks/useUsageStandards';
import { consumablePlanRefusal, type ConsumablePlanLine } from '@/src/lib/repositories/usageStandards';
import { computeConsumablePlan, diffPlan, remainingQuantity } from '@/src/lib/consumablePlan';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatQuantity, isPositiveDecimal, normalizeDecimal } from '@/src/lib/stockFormat';
import { getNumberLocale } from '@/src/lib/locale/activeLocale';

interface Props {
  workOrderId: string;
  workOrderStatus: string;
  /** The work order's PROJECT row: `can()` reads `project_manager_id` from it (a work order has no such column). */
  project: { project_manager_id: string | null } | null | undefined;
}

type SourceKey = 'standard' | 'adjusted' | 'allowance' | 'none';
const qty = (v: string) => formatQuantity(v, getNumberLocale());
const nonNegative = (v: string) => /^\d+(\.\d{1,3})?$/.test(v);

/** Consumable plan (#2577, FR-CUS-005..010, 014): what the work order is expected to use, from the usage standards; adjustable with a reason. Requests are checked against it. */
export const ConsumablePlanSection: React.FC<Props> = ({ workOrderId, workOrderStatus, project }) => {
  const { t } = useTranslation('usageStandards');
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const { toast } = useToast();
  const plan = useConsumablePlan(workOrderId);
  const m = useConsumablePlanMutations(workOrderId);
  const open = workOrderStatus === 'Draft' || workOrderStatus === 'Issued';
  const ctx = { record: { ...(project ?? {}), viewOnly: realRole !== effectiveRole } };
  const canGenerate = open && Boolean(project) && may('generate', 'consumablePlan', ctx);
  const canAdjust = open && Boolean(project) && may('adjust', 'consumablePlan', ctx);
  const [previewing, setPreviewing] = useState(false);
  const [editing, setEditing] = useState<{ line: ConsumablePlanLine | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = usePlanInputs(workOrderId, previewing);
  const stockItems = useStockItems(true);

  const title = t('plan.title', 'Consumables');
  const sourceLabel = (s: SourceKey) => t(`plan.source.${s}`, { standard: 'From standards', adjusted: 'Adjusted', allowance: 'From material allowance', none: 'No plan' }[s]);
  const refusal = (err: unknown): string => {
    const key = consumablePlanRefusal(err);
    if (key) return t(`plan.errors.${key}`, { CUS_NOT_FOUND: 'This work order is not available.', CUS_FORBIDDEN: 'You cannot plan consumables for this work order.', CUS_WORK_ORDER: 'The work order is closed or cancelled.', CUS_REASON: 'Give a reason (up to 500 characters).', CUS_ITEM: 'Choose an active item.', CUS_INVALID: 'Enter zero or more.' }[key]);
    return classifyMutationError(err, undefined, { operation: 'update', suppressCapture: true }).headline;
  };

  const preview = useMemo(() => {
    if (!plan.data || !inputs.data) return null;
    const next = computeConsumablePlan(inputs.data.lines, inputs.data.standards);
    return diffPlan(plan.data.lines.map((l) => ({ itemId: l.itemId, generatedQty: l.generatedQty, adjustedQty: l.adjustedQty })), next.items);
  }, [plan.data, inputs.data]);

  if (plan.isPending) return <RecordSection title={title}><ListState variant="loading" rows={3} /></RecordSection>;
  if (plan.isError || !plan.data) {
    return <RecordSection title={title}><ListState variant="error" title={t('plan.error', "Couldn't load the consumable plan")} onRetry={() => void plan.refetch()} /></RecordSection>;
  }
  const p = plan.data;
  const hasPlan = p.lines.length > 0 || p.generatedAt !== null;
  const itemName = (id: string) => [...p.lines, ...p.unplanned].find((x) => x.itemId === id);

  const confirmGenerate = async () => {
    try {
      await m.generate.mutateAsync();
      toast(hasPlan ? t('plan.regenerated', 'Plan regenerated') : t('plan.generated', 'Plan generated'), undefined, 'success');
      setPreviewing(false); setError(null);
    } catch (err) { setError(refusal(err)); }
  };
  const revert = async (l: ConsumablePlanLine) => {
    try { await m.adjust.mutateAsync({ itemId: l.itemId, adjustedQty: null, reason: null }); toast(t('plan.reverted', 'Back to the generated quantity'), undefined, 'success'); }
    catch (err) { toast(refusal(err), undefined, 'warning'); }
  };

  const row = (id: string, label: React.ReactNode, planned: string, requested: string, unit: string, source: SourceKey, extra?: React.ReactNode, actions?: React.ReactNode) => {
    const remaining = remainingQuantity(planned, requested);
    return (
      <li key={id} className="py-2" data-testid={`consumable-row-${id}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="min-w-0 font-medium">{label}</span>
          <span className="flex flex-wrap items-baseline gap-x-4 tabular-nums text-control">
            {source === 'none'
              ? <span className="text-muted-foreground">{t('plan.noPlan', 'No plan')}</span>
              : <span>{t('plan.planned', 'Plan {{qty}} {{unit}}', { qty: qty(planned), unit })}</span>}
            <span className="text-muted-foreground">{t('plan.requested', 'Requested {{qty}}', { qty: qty(requested) })}</span>
            <span className={remaining.startsWith('-') ? 'font-medium text-warning-foreground' : ''} data-testid={`consumable-remaining-${id}`}>{t('plan.remaining', 'Remaining {{qty}}', { qty: qty(remaining) })}</span>
            <StatusPill variant={source === 'adjusted' ? 'warn' : 'neutral'}>{sourceLabel(source)}</StatusPill>
          </span>
        </div>
        {extra}
        {actions && <div className="mt-1 flex flex-wrap gap-2">{actions}</div>}
      </li>
    );
  };

  return (
    <RecordSection
      title={title}
      data-testid="consumable-plan"
      actions={<span className="flex flex-wrap gap-2">
        {canAdjust && <Button variant="outline" size="sm" onClick={() => setEditing({ line: null })}>{t('plan.addItem', 'Add item')}</Button>}
        {canGenerate && <Button variant={hasPlan ? 'outline' : 'primary'} size="sm" onClick={() => { setError(null); if (hasPlan) setPreviewing(true); else void confirmGenerate(); }} loading={m.generate.isPending && !previewing}>
          {hasPlan ? t('plan.regenerate', 'Regenerate') : t('plan.generate', 'Generate plan')}</Button>}
      </span>}
    >
      {error && !previewing && <p role="alert" className="mb-2 text-control text-destructive-text">{error}</p>}
      {p.outOfDate && (
        <p role="status" className="mb-3 rounded-md border border-warning/40 bg-warning-subtle p-3 text-control" data-testid="consumable-out-of-date">
          {t('plan.outOfDate', 'The work or the usage standards changed since this plan was made. Requests still use the stored plan.')}
          {canGenerate ? ` ${t('plan.outOfDateAction', 'Regenerate to bring it up to date.')}` : ''}
        </p>
      )}
      {!hasPlan && p.unplanned.length === 0 && (
        <p className="text-control text-muted-foreground">{open ? t('plan.empty', 'No consumable plan yet. Generate one from the usage standards.') : t('plan.emptyClosed', 'No consumable plan was made for this work order.')}</p>
      )}
      <ul className="divide-y divide-border">
        {p.lines.map((l) => row(l.itemId, <>{l.itemCode} <span className="font-normal text-muted-foreground">{l.itemName}</span></>, l.plannedQty, l.priorQty, l.unitCode, l.source,
          <>
            {l.source === 'adjusted' && <p className="mt-1 text-control text-muted-foreground">{t('plan.adjustedNote', 'Generated {{gen}}; adjusted: {{reason}}', { gen: qty(l.generatedQty), reason: l.adjustReason ?? '' })}</p>}
            {l.basis.length > 0 && (
              <details className="mt-1 text-control text-muted-foreground">
                <summary className="cursor-pointer">{t('plan.basis', 'How this was worked out')}</summary>
                <ul className="mt-1 space-y-0.5">
                  {l.basis.map((b) => <li key={b.boqItemId} className="tabular-nums">{t('plan.basisLine', '{{code}}: {{work}} {{unit}} x {{per}} per unit, +{{margin}}% = {{result}}', { code: b.code, work: qty(b.workQty), unit: b.unit, per: qty(b.qtyPerUnit), margin: Number(b.marginPct), result: Number(b.result).toFixed(3) })}</li>)}
                </ul>
              </details>
            )}
          </>,
          canAdjust ? <>
            <Button variant="ghost" size="sm" onClick={() => setEditing({ line: l })}>{t('plan.adjust', 'Adjust')}</Button>
            {l.source === 'adjusted' && <Button variant="ghost" size="sm" onClick={() => void revert(l)}>{t('plan.revert', 'Use generated quantity')}</Button>}
          </> : undefined))}
        {p.unplanned.map((u) => row(`u-${u.itemId}`, <>{u.itemCode} <span className="font-normal text-muted-foreground">{u.itemName}</span></>, u.plannedQty, u.priorQty, u.unitCode, u.source))}
      </ul>
      {p.noStandard.length > 0 && (
        <div className="mt-3" data-testid="consumable-no-standard">
          <h3 className="text-control font-medium">{t('plan.noStandardTitle', 'No standard for these contract lines')}</h3>
          <p className="text-control text-muted-foreground">{t('plan.noStandardHelp', 'A gap in the standards, not a need of zero.')}</p>
          <ul className="mt-1 text-control tabular-nums">
            {p.noStandard.map((n) => <li key={n.boqItemId}>{t('plan.noStandardLine', '{{code}}: {{description}} ({{qty}} {{unit}})', { code: n.itemCode, description: n.description, qty: qty(n.quantity), unit: n.unit })}</li>)}
          </ul>
        </div>
      )}
      <ConfirmDialog
        open={previewing}
        tone="default"
        title={t('plan.previewTitle', 'Regenerate the consumable plan?')}
        description={<div className="space-y-2">
          <p>{t('plan.previewBody', 'Adjustments and their reasons are kept. Requests already sent keep the figure they were judged against.')}</p>
          {inputs.isPending && <p>{t('plan.previewLoading', 'Working out the new plan…')}</p>}
          {inputs.isError && <p role="alert">{t('plan.previewError', "Couldn't work out the new plan. Try again.")}</p>}
          {preview && (preview.length === 0
            ? <p>{t('plan.previewNoChange', 'No quantity changes.')}</p>
            : <ul className="space-y-0.5 tabular-nums" data-testid="consumable-preview">
              {preview.map((d) => {
                const it = itemName(d.itemId);
                const name = it ? `${it.itemCode}` : (stockItems.data?.find((x) => x.id === d.itemId)?.code ?? d.itemId.slice(0, 8));
                return <li key={d.itemId}>{d.change === 'removed'
                  ? t('plan.previewRemoved', '{{item}}: {{old}} removed', { item: name, old: qty(d.oldQty ?? '0') })
                  : d.change === 'added'
                    ? t('plan.previewAdded', '{{item}}: new, {{new}}', { item: name, new: qty(d.newQty ?? '0') })
                    : t('plan.previewChanged', '{{item}}: {{old}} to {{new}}', { item: name, old: qty(d.oldQty ?? '0'), new: qty(d.newQty ?? '0') })}</li>;
              })}
            </ul>)}
          {error && <p role="alert" className="text-destructive-text">{error}</p>}
        </div>}
        confirmLabel={t('plan.regenerate', 'Regenerate')}
        loading={m.generate.isPending}
        confirmDisabled={!inputs.isSuccess}
        onConfirm={() => void confirmGenerate()}
        onCancel={() => { setPreviewing(false); setError(null); }}
      />
      {editing && (
        <AdjustForm line={editing.line} existing={new Set(p.lines.map((l) => l.itemId))} onClose={() => setEditing(null)}
          onSave={async (a) => { await m.adjust.mutateAsync(a); toast(t('plan.adjustSaved', 'Plan updated'), undefined, 'success'); setEditing(null); }} refusal={refusal} />
      )}
    </RecordSection>
  );
};

const AdjustForm: React.FC<{
  line: ConsumablePlanLine | null;
  existing: Set<string>;
  onClose: () => void;
  onSave: (a: { itemId: string; adjustedQty: string; reason: string }) => Promise<void>;
  refusal: (err: unknown) => string;
}> = ({ line, existing, onClose, onSave, refusal }) => {
  const { t } = useTranslation('usageStandards');
  const items = useStockItems(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  type V = { itemId: string; qty: string; reason: string };
  const form = useEntityForm<V>({
    initialValues: { itemId: line?.itemId ?? '', qty: line ? normalizeDecimal(line.plannedQty).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : '', reason: line?.adjustReason ?? '' },
    validate: (v) => {
      const e: Partial<Record<keyof V, string>> = {};
      if (!v.itemId) e.itemId = t('plan.form.itemRequired', 'Choose the item.');
      if (!nonNegative(normalizeDecimal(v.qty)) || !(isPositiveDecimal(normalizeDecimal(v.qty)) || Number(normalizeDecimal(v.qty)) === 0)) e.qty = t('plan.form.qtyInvalid', 'Enter zero or more, up to 3 decimals.');
      if (!v.reason.trim()) e.reason = t('plan.form.reasonRequired', 'Give a reason (up to 500 characters).');
      else if (v.reason.trim().length > 500) e.reason = t('plan.form.reasonTooLong', 'Keep the reason under 500 characters.');
      return e;
    },
    idPrefix: 'consumable-adjust', requiredFields: ['itemId', 'qty', 'reason'], module: 'stock',
  });
  const f = { item: form.fieldProps('itemId'), qty: form.fieldProps('qty'), reason: form.fieldProps('reason') };
  const choices = (items.data ?? []).filter((i) => !existing.has(i.id) || i.id === line?.itemId);
  const summary = (['itemId', 'qty', 'reason'] as const).filter((k) => form.errors[k]).map((k) => ({ fieldId: form.fieldProps(k).id, message: form.errors[k] as string }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      try { await onSave({ itemId: v.itemId, adjustedQty: normalizeDecimal(v.qty), reason: v.reason.trim() }); }
      catch (err) { setSaveError({ headline: t('plan.form.failed', 'Could not save the plan'), detail: refusal(err) }); }
    });
  };
  return (
    <EntityFormModal open title={line ? t('plan.form.adjustTitle', 'Adjust {{item}}', { item: line.itemCode }) : t('plan.form.addTitle', 'Add an item to the plan')}
      submitLabel={t('plan.form.submit', 'Save')} onSubmit={submit} onClose={onClose} loading={form.isSubmitting} dirty={form.isDirty}
      submitDisabled={!form.isComplete} errorSummary={summary.length ? summary : undefined} submitError={saveError}>
      <FormGrid>
        <SelectField id={f.item.id} label={t('plan.form.item', 'Item')} required value={f.item.value} onChange={f.item.onChange} onBlur={f.item.onBlur} error={f.item.error}
          disabled={Boolean(line)} placeholder={t('plan.form.itemPlaceholder', 'Choose an item')} options={choices.map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` }))} />
        <TextField id={f.qty.id} label={line ? t('plan.form.qtyAdjust', 'Planned quantity (generated: {{gen}})', { gen: qty(line.generatedQty) }) : t('plan.form.qty', 'Planned quantity')} required inputMode="decimal"
          value={f.qty.value} onChange={f.qty.onChange} onBlur={f.qty.onBlur} error={f.qty.error} />
        <TextArea id={f.reason.id} label={t('plan.form.reason', 'Why is this different from the standards?')} required maxLength={500} rows={2}
          value={f.reason.value} onChange={f.reason.onChange} onBlur={f.reason.onBlur} error={f.reason.error} fullWidth />
      </FormGrid>
    </EntityFormModal>
  );
};

import React, { useMemo, useState } from 'react';
import { PlanFigures } from './materialRequests/PlanFigures';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Combobox, DateField, ListState, SelectField, TextArea, TextField, useToast } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { useOrgFxContext } from '@/src/hooks/useOrgFxContext';
import { useOrgToday } from '@/src/hooks/useOrgToday';
import { addDays } from '@/src/lib/reports/months';
import { useProjectPickerOptions } from '@/src/hooks/useProjects';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useStockItems, useStockUnits, useStockWarehouses } from '@/src/hooks/useStock';
import { useLinePlans, useMaterialRequest, useMaterialRequestMutations } from '@/src/hooks/useMaterialRequests';
import { useLiveSections, useSectionLinePlans } from '@/src/hooks/useWorkOrderSectionMaterials';
import { useTerms } from '@/src/lib/i18n/terms';
import { draftLineErrors, linePlanStatus } from '@/src/lib/repositories/materialRequests';
import { isPositiveDecimal, isWholeQuantity, normalizeDecimal } from '@/src/lib/stockFormat';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { useRefusalText } from './materialRequests/useMaterialRequestText';
import { UsageWarning } from './materialRequests/UsageWarning';
import { useUsageThresholds } from '@/src/hooks/useUsageThresholds';

interface FormLine { key: string; itemId: string; quantity: string; reason: string }
/** A typed quantity (dot or decimal comma, 3 decimals at most) as the number to send; 0 when it is not a positive quantity. */
const quantityOf = (raw: string): number => { const v = normalizeDecimal(raw); return isPositiveDecimal(v) ? Number(v) : 0; };
const newLine = (): FormLine => ({ key: crypto.randomUUID(), itemId: '', quantity: '', reason: '' });

/**
 * Raise (or amend a draft of) a material request for one work order (FR-MRQ-001/002/003). Phone-first: one column,
 * 44px targets. The plan figures are advisory; mrq_submit re-checks them and the cut-off server-side.
 */
const MaterialRequestNewPage: React.FC = () => {
  const { t } = useTranslation('materialRequests');
  const { toast } = useToast();
  const navigate = useNavigate();
  const { requestId } = useParams();
  const refusal = useRefusalText();
  const existing = useMaterialRequest(requestId);
  const { data: projects } = useProjectPickerOptions();
  const { data: items, isPending: itemsPending, isError: itemsError, refetch: refetchItems } = useStockItems();
  const { data: units } = useStockUnits();
  const { data: warehouses, isPending: warehousesPending, isError: warehousesError, refetch: refetchWarehouses } = useStockWarehouses();
  const warehousesReady = !warehousesPending && !warehousesError && warehouses !== undefined;
  const wholeByUnit = useMemo(() => new Map((units ?? []).map((u) => [u.id, u.whole_only])), [units]);
  const m = useMaterialRequestMutations();
  const terms = useTerms();

  const [projectId, setProjectId] = useState('');
  const [workOrderId, setWorkOrderId] = useState('');
  const [sectionId, setSectionId] = useState('');
  // Dates are the organisation's calendar days (the cut-off is judged in the organisation's zone), never the browser's or UTC's.
  const orgTz = useOrgFxContext().data?.timezone;
  const orgToday = useOrgToday(orgTz);
  const [pickedNeededBy, setNeededBy] = useState<string | null>(null);
  const neededBy = pickedNeededBy ?? (orgTz ? addDays(orgToday, 1) : '');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<FormLine[]>([newLine()]);
  const [seeded, setSeeded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [clientRequestId] = useState(() => crypto.randomUUID());

  // Editing a draft: seed the form once from the stored request (its own plan snapshot is recomputed live below).
  const req = existing.data;
  if (requestId && req && !seeded) {
    setSeeded(true);
    setProjectId(req.projectId); setWorkOrderId(req.workOrderId); setSectionId(req.sectionId ?? ''); setNeededBy(req.neededBy); setNote(req.note ?? ''); setToWarehouseId(req.toWarehouseId ?? '');
    setLines(req.lines.map((l) => ({ key: l.id, itemId: l.itemId, quantity: String(l.quantity), reason: l.overPlanReason ?? '' })));
  }

  // The last return of this request (its reason), shown above the form until the request is sent again.
  const returnedReason = useMemo(() => {
    const events = req?.events ?? [];
    for (let i = events.length - 1; i >= 0; i -= 1) {
      if (events[i].action === 'submitted') return null;
      if (events[i].action === 'returned') return events[i].reason?.trim() || null;
    }
    return null;
  }, [req?.events]);

  const workOrders = useProjectWorkOrders(projectId);
  // Where the delivery goes: one location is picked by the server; with several the requester must choose (#2608).
  const locations = useMemo(() => (warehousesReady ? warehouses : []).filter((w) => ['site', 'yard', 'staging'].includes(w.kind) && !w.archived_at && w.project_id === projectId)
    .map((w) => ({ value: w.id, label: `${w.code} · ${w.name}` })), [warehouses, warehousesReady, projectId]);
  const destination = locations.length > 1 ? (locations.some((o) => o.value === toWarehouseId) ? toWarehouseId : '') : '';
  const itemIds = lines.map((l) => l.itemId).filter(Boolean);
  const plans = useLinePlans(workOrderId || undefined, itemIds, requestId);
  const usage = useUsageThresholds();
  const planOf = (itemId: string) => plans.data?.find((p) => p.itemId === itemId);
  // #2576: an optional live section of the work order, with its own allocation checked beside the work order's plan.
  const sections = useLiveSections(workOrderId || undefined);
  const sectionPlans = useSectionLinePlans(workOrderId || undefined, sectionId || undefined, itemIds, requestId);
  const sectionPlanOf = (itemId: string) => sectionPlans.data?.find((p) => p.itemId === itemId);
  const sectionOptions = (sections.data ?? []).map((x) => ({ value: x.id, label: `${x.code} · ${x.name}` }));
  const sectionWord = terms.section.toLowerCase();

  const projectOptions = useMemo(() => (projects ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })), [projects]);
  const woOptions = useMemo(() => (workOrders.data ?? []).filter((w) => w.status === 'Issued' || w.status === 'Draft')
    .map((w) => ({ value: w.id, label: w.wo_number ? `${w.wo_number} · ${w.title}` : w.title })), [workOrders.data]);
  const unitName = (unitId: string) => units?.find((u) => u.id === unitId)?.code ?? '';
  const itemOptions = useMemo(() => (items ?? []).filter((i) => !i.archived_at).map((i) => ({ value: i.id, label: `${i.code} · ${i.name}` })), [items]);

  const planReady = !plans.isPending && !plans.isError;
  const errors = draftLineErrors(lines.map((l) => {
    const p = planOf(l.itemId);
    const sp = sectionPlanOf(l.itemId);
    return { itemId: l.itemId, quantity: quantityOf(l.quantity), overPlanReason: l.reason, planQty: p?.planQty ?? 0, priorQty: p?.priorQty ?? 0,
      sectionPlanQty: sp?.sectionPlanQty ?? null, sectionPriorQty: sp?.sectionPriorQty ?? null };
  }));
  // Checks the server also makes (MRQ_INVALID), caught here so the person sees which line and why.
  const extraErrors = lines.map((l, i): 'duplicateItem' | 'quantityDecimals' | 'wholeOnly' | undefined => {
    const v = normalizeDecimal(l.quantity);
    if (l.itemId && lines.findIndex((x) => x.itemId === l.itemId) !== i) return 'duplicateItem';
    if (/^\d+\.\d{4,}$/.test(v)) return 'quantityDecimals';
    const unitId = items?.find((x) => x.id === l.itemId)?.unit_id;
    if (isPositiveDecimal(v) && unitId && wholeByUnit.get(unitId) && !isWholeQuantity(v)) return 'wholeOnly';
    return undefined;
  });
  const complete = warehousesReady && locations.length > 0 && extraErrors.every((e) => !e) && Boolean(workOrderId) && (locations.length === 1 || Boolean(destination)) && Boolean(neededBy) && lines.every((l) => l.itemId) && planReady && Object.keys(errors).length === 0;

  const patch = (key: string, p: Partial<FormLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));

  const save = async (submit: boolean) => {
    setTouched(true); setError(null);
    if (!complete) return;
    try {
      const id = await m.saveDraft.mutateAsync({
        id: requestId ?? null,
        header: { workOrderId, sectionId: sectionId || null, neededBy, toWarehouseId: destination || null, note: note.trim() || null },
        lines: lines.map((l) => ({ itemId: l.itemId, quantity: quantityOf(l.quantity), overPlanReason: l.reason.trim() || null })),
        clientRequestId: requestId ? undefined : clientRequestId,
      });
      if (submit) {
        try { await m.submit.mutateAsync({ id, clientRequestId }); }
        catch (err) { setError(refusal(err)); navigate(`/material-requests/${id}/edit`, { replace: true }); return; }
        toast(t('form.submitted', 'Request sent for approval'), undefined, 'success');
      } else toast(t('form.saved', 'Draft saved'), undefined, 'success');
      navigate(`/material-requests/${id}`);
    } catch (err) { setError(refusal(err)); }
  };

  if (requestId && existing.isPending) return <ListState variant="loading" rows={4} />;
  if (requestId && (existing.isError || !req)) return <ListState variant="error" title={t('detail.notFound', 'Request not found')} onRetry={() => void existing.refetch()} />;

  const busy = m.saveDraft.isPending || m.submit.isPending;
  return (
    <div className="max-w-2xl pb-8">
      <BackBar label={t('form.back', 'Material requests')} onBack={() => navigate('/material-requests')} />
      <h1 className="mb-4 text-xl font-semibold">{requestId ? t('form.editTitle', 'Edit request') : t('form.title', 'New material request')}</h1>
      {error && <FormErrorStrip>{error}</FormErrorStrip>}
      {returnedReason && (
        <div role="status" data-testid="mrq-returned-reason" className="mb-4 rounded-md border border-border bg-waiting-surface px-3 py-2 text-control">
          <strong className="block font-semibold">{t('form.returnedTitle', 'Sent back to you')}</strong>
          <span className="break-words">{returnedReason}</span>
        </div>
      )}
      <div className="space-y-4">
        <Combobox label={t('form.project', 'Project')} required noun={t('form.projectNoun', 'project')} value={projectId || null}
          selectedOption={projectOptions.find((o) => o.value === projectId) ?? null} loadOptions={() => Promise.resolve(projectOptions)}
          onChange={(v) => { setProjectId(v); setWorkOrderId(''); }} />
        <Combobox label={t('form.workOrder', 'Work order')} required noun={t('form.workOrderNoun', 'work order')} value={workOrderId || null}
          disabled={!projectId} helper={!projectId ? t('form.chooseProject', 'Choose a project to see its work orders.') : undefined}
          statusOverride={workOrders.isPending && projectId ? 'loading' : workOrders.isError ? 'error' : undefined} onRetry={() => void workOrders.refetch()}
          selectedOption={woOptions.find((o) => o.value === workOrderId) ?? null} loadOptions={() => Promise.resolve(woOptions)}
          onChange={(v) => { setWorkOrderId(v); setSectionId(''); }} />
        {sectionOptions.length > 0 && (
          <SelectField label={terms.section} value={sectionId} onChange={setSectionId} fullWidth
            options={[{ value: '', label: t('form.noSection', 'No {{section}}', { section: sectionWord }) }, ...sectionOptions]} />
        )}
        {projectId && warehousesPending && <ListState variant="loading" rows={1} />}
        {projectId && warehousesError && <ListState variant="error" title={t('form.warehousesError', "Couldn't load delivery locations")} onRetry={() => void refetchWarehouses()} />}
        {projectId && warehousesReady && locations.length > 1 && (
          <SelectField label={t('form.destination', 'Deliver to')} required value={destination} onChange={setToWarehouseId} fullWidth
            options={[{ value: '', label: t('form.chooseDestination', 'Choose a location') }, ...locations]}
            error={touched && !destination ? t('form.destinationRequired', 'This project has several locations. Choose where the material goes.') : undefined} />
        )}
        {projectId && warehousesReady && locations.length === 0 && (
          <p role="status" className="text-control text-warning-foreground">{t('form.noDestination', 'This project has no site, yard or staging location yet. The stock keeper must add one before this can be delivered.')}</p>
        )}
        <DateField label={t('form.neededBy', 'Needed by')} required value={neededBy} onChange={setNeededBy} min={orgTz ? orgToday : undefined} fullWidth
          error={touched && !neededBy ? t('form.neededByRequired', 'Choose the date you need it.') : undefined} />

        <fieldset className="space-y-3">
          <legend className="mb-1 text-control font-semibold">{t('form.items', 'Items')}</legend>
          {itemsPending && <ListState variant="loading" rows={2} />}
          {itemsError && <ListState variant="error" title={t('form.itemsError', "Couldn't load stock items")} onRetry={() => void refetchItems()} />}
          {lines.map((l, i) => {
            const p = planOf(l.itemId);
            const sp = sectionPlanOf(l.itemId);
            const st = p ? linePlanStatus({ planQty: p.planQty, priorQty: p.priorQty, quantity: quantityOf(l.quantity), sectionPlanQty: sp?.sectionPlanQty, sectionPriorQty: sp?.sectionPriorQty }) : null;
            const err = touched ? errors[i] : undefined;
            const item = items?.find((x) => x.id === l.itemId);
            return (
              <div key={l.key} className="space-y-2 rounded-md border border-border p-3" data-testid="mrq-line">
                <SelectField label={t('form.item', 'Item')} required value={l.itemId} onChange={(v) => patch(l.key, { itemId: v })}
                  error={touched && extraErrors[i] === 'duplicateItem' ? t('form.duplicateItem', 'This item is already on another line. Put it on one line.') : undefined}
                  options={[{ value: '', label: t('form.chooseItem', 'Choose an item') }, ...itemOptions]} fullWidth />
                <TextField label={t('form.quantity', 'Quantity{{unit}}', { unit: item ? ` (${unitName(item.unit_id)})` : '' })} required inputMode="decimal"
                  value={l.quantity} onChange={(v) => patch(l.key, { quantity: v })}
                  error={touched && extraErrors[i] === 'quantityDecimals' ? t('form.quantityDecimals', 'Use at most three decimals.')
                    : touched && extraErrors[i] === 'wholeOnly' ? t('form.wholeOnly', 'This item is counted in whole units. Enter a whole number.')
                    : err === 'quantityRequired' ? t('form.quantityRequired', 'Enter a quantity above zero.') : undefined} />
                {l.itemId && (plans.isPending ? <p className="text-control text-muted-foreground">…</p> : p
                  ? <PlanFigures workOrderId={workOrderId} itemId={l.itemId} excludeRequestId={requestId} unit={item ? unitName(item.unit_id) : ''}
                    plan={p.planQty} prior={p.priorQty} newTotal={st?.newTotal} overPlan={Boolean(st?.overPlan)}
                    source={p.planSource ? t(`form.planSource.${p.planSource}`, { standard: 'From usage standards', adjusted: 'Adjusted by the planner', allowance: 'From material allowance', none: 'No plan' }[p.planSource]) : undefined}
                    section={sp && sp.sectionPlanQty !== null ? { label: terms.section, plan: sp.sectionPlanQty, prior: sp.sectionPriorQty ?? 0 } : null} />
                  : <p className="text-control text-muted-foreground" data-testid="mrq-plan">{t('form.planUnknown', 'Plan figures unavailable')}</p>)}
                {l.itemId && p && !plans.isPending && <UsageWarning line={{ planQty: p.planQty, priorQty: p.priorQty, quantity: quantityOf(l.quantity) }} thresholds={usage.thresholds} />}
                {/* A reason already typed stays visible (and editable) even before the plan figures load, so a returned request never looks like it lost it. */}
                {(st?.overPlan || l.reason.trim() !== '') && (
                  <TextArea label={t('form.reason', 'Why do you need more than the plan?')} required={Boolean(st?.overPlan)} maxLength={500} rows={2}
                    value={l.reason} onChange={(v) => patch(l.key, { reason: v })}
                    error={err === 'reasonRequired' ? t('form.reasonRequired', 'Give a reason (up to 500 characters).') : err === 'reasonTooLong' ? t('form.reasonTooLong', 'Keep the reason under 500 characters.') : undefined} />
                )}
                {lines.length > 1 && <Button variant="ghost" size="sm" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>{t('form.removeLine', 'Remove item')}</Button>}
              </div>
            );
          })}
          <Button variant="outline" onClick={() => setLines((ls) => [...ls, newLine()])}>{t('form.addLine', 'Add item')}</Button>
        </fieldset>

        <TextArea label={t('form.note', 'Note (optional)')} rows={2} value={note} onChange={setNote} />
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" disabled={busy} onClick={() => void save(false)}>{t('form.saveDraft', 'Save draft')}</Button>
          <Button variant="primary" loading={busy} disabled={!warehousesReady || locations.length === 0 || (!complete && touched)} onClick={() => void save(true)}>{t('form.submit', 'Send for approval')}</Button>
        </div>
      </div>
    </div>
  );
};
export default MaterialRequestNewPage;

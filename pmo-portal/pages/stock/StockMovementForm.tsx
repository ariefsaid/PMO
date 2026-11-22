import React, { useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, ConfirmDialog, FormActions, FormGrid, FormSection, ListState, MobileActionBar, PageHeader, SelectField, TextArea, TextField, UnsavedChangesDialog, useToast, Icon,
} from '@/src/components/ui';
import { ItemPicker } from '@/src/components/stock/ItemPicker';
import { StockLinesLoading } from '@/src/components/stock/LinesLoading';
import { MOVEMENT_LINES_RESERVE } from '@/src/components/stock/linesLoadingHeights';
import { useStockErrorText, useStockFailureNotice } from '@/src/components/stock/useStockErrorText';
import { StockDispatchError } from '@/src/lib/stockDispatchError';
import { FormErrorStrip } from '@/src/components/ui/FormFields';
import { useFxOrgDay } from '@/src/hooks/useFxOrgDay';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import { useIsTwoStep } from '@/src/hooks/useStockTransfers';
import { useStockTags } from '@/src/hooks/useStockSiteWork';
import { useUnsavedChangesGuard } from '@/src/hooks/useUnsavedChangesGuard';
import {
  useIssuableProjects, useIssuableWorkItems, useProjectIssueLines, useStockDocumentMutations, useStockItems, useStockKeepers, useStockUnits, useStockWarehouses,
} from '@/src/hooks/useStock';
import { parseRefusal } from '@/src/lib/refusals';
import { isPositiveDecimal, isWholeQuantity, normalizeDecimal } from '@/src/lib/stockFormat';
import type { StockDocumentInput, StockDocumentKind, StockLineInput } from '@/src/lib/db/stockDocuments';
import StockCount from './StockCount';
import { DateField } from '@/src/components/ui/DateField';
import { CostAttributionFields } from '@/src/components/workOrders/CostAttributionFields';
import { useAttributionErrorText } from '@/src/components/workOrders/costAttributionError';
import { AttributionRefusedError, NO_ATTRIBUTION, type CostAttribution } from '@/src/lib/repositories/workOrderCosts';

const KINDS = ['receive', 'transfer', 'issue', 'return'] as const;
type MovementKind = (typeof KINDS)[number];
const isMovement = (k: string | undefined): k is MovementKind => (KINDS as readonly string[]).includes(k ?? '');

interface LineState { key: number; itemId: string | null; quantity: string; unitCost: string; boqItemId: string; sourceLineId: string }
const blankLine = (key: number): LineState => ({ key, itemId: null, quantity: '', unitCost: '', boqItemId: '', sourceLineId: '' });

/** Work-item picker for one issue line; its own component so the query is keyed by the chosen project. */
const WorkItemSelect: React.FC<{ projectId: string; value: string; onChange: (v: string) => void; label: string; error?: string }> = ({ projectId, value, onChange, label, error }) => {
  const { t } = useTranslation('stock');
  const q = useIssuableWorkItems(projectId || undefined);
  const options = (q.data ?? []).map((w) => ({ value: w.id, label: `${w.item_code} - ${w.description}` }));
  return (
    <SelectField
      label={label}
      required
      value={value}
      onChange={onChange}
      options={options}
      placeholder={q.isPending && projectId ? t('form.loading') : t('form.workItemPlaceholder')}
      disabled={!projectId}
      error={error ?? (q.isError ? t('form.loadFailed') : undefined)}
    />
  );
};

const StockMovementForm: React.FC = () => {
  const { t } = useTranslation('stock');
  const attributionError = useAttributionErrorText();
  const { kind: kindParam } = useParams<{ kind: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser?.id;
  const errorText = useStockErrorText();
  const notify = useStockFailureNotice();
  const today = useFxOrgDay(true).day; // org-timezone today: the server refuses a later date (stock_assert_dates)
  const { create } = useStockDocumentMutations();
  const twoStep = useIsTwoStep(); // #2690: a two-step organisation sends a transfer instead of posting it

  const warehouses = useStockWarehouses(false);
  const keepers = useStockKeepers();
  const items = useStockItems(false);
  const units = useStockUnits(true);
  const tags = useStockTags(true);
  const projects = useIssuableProjects();

  const requestId = useRef<string>(crypto.randomUUID()); // stable across retries of one submit (FR-STK-015)
  const nextKey = useRef(2);
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [lines, setLines] = useState<LineState[]>([blankLine(1)]);
  const [occurredOn, setOccurredOn] = useState('');
  const [note, setNote] = useState('');
  const [attribution, setAttribution] = useState<CostAttribution>(NO_ATTRIBUTION);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pendingLeave, setPendingLeave] = useState<{ leave: () => void; stay: () => void } | null>(null);
  const initialSnapshot = useRef(JSON.stringify({ warehouseId, toWarehouseId, projectId: params.get('project') ?? '', occurredOn, note, lines: [] }));

  const kind = isMovement(kindParam) ? kindParam : null;
  const snapshot = JSON.stringify({ warehouseId, toWarehouseId, projectId, occurredOn, note, lines: lines.filter((l) => l.itemId || l.quantity || l.unitCost || l.boqItemId || l.sourceLineId).map(({ itemId, quantity, unitCost, boqItemId, sourceLineId }) => ({ itemId, quantity, unitCost, boqItemId, sourceLineId })) });
  const dirty = !saved && snapshot !== initialSnapshot.current;
  const guardLeave = useUnsavedChangesGuard({ dirty, guardHistory: true, onBlocked: (leave, stay) => setPendingLeave({ leave, stay }) });
  const issueLines = useProjectIssueLines(kind === 'return' ? projectId || undefined : undefined);

  const viewOnly = realRole !== effectiveRole; // view-as shares the real login, so the page stays read-only (FR-STK-064)
  const isAdmin = realRole === 'Admin';
  const canSeeCost = may('create', 'stockItem'); // rank >= 20 reads cost back (FR-STK-063)
  const keptIds = useMemo(() => new Set((keepers.data ?? []).filter((k) => k.user_id === me).map((k) => k.warehouse_id)), [keepers.data, me]);
  const usable = useMemo(() => (warehouses.data ?? []).filter((w) => isAdmin || keptIds.has(w.id)), [warehouses.data, isAdmin, keptIds]);
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  // Client-supplied material carries a zero-cost tag: it is marked on the line and its cost is fixed at zero, never asked.
  const clientTag = (l: LineState) => { const tagId = l.itemId ? itemById.get(l.itemId)?.tag_id : null; return tagId ? (tags.data ?? []).find((g) => g.id === tagId && g.zero_cost) : undefined; };
  const wholeByUnit = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.whole_only])), [units.data]);

  if (kind === 'transfer' && twoStep) return <Navigate to="/stock/transfers/new" replace />;
  if (!kind) {
    return <div className="p-4"><ListState variant="empty" icon="folder" title={t('form.unknownKind')} sub={t('form.unknownKindSub')} /></div>;
  }
  // AC-NBR-033: the header needs warehouses + keepers (+ projects where the kind picks one); the line editor needs
  // items + units. Submit waits for all four.
  const headerError = warehouses.isError || keepers.isError || (kind !== 'receive' && kind !== 'transfer' && projects.isError);
  const headerPending = warehouses.isPending || keepers.isPending;
  const linesError = items.isError || units.isError;
  const linesPending = items.isPending || units.isPending;
  const linesSettled = !linesPending && !linesError;
  const retryHeader = () => { for (const q of [warehouses, keepers, projects]) if (q.isError) void q.refetch(); };
  const retryLines = () => { for (const q of [items, units]) if (q.isError) void q.refetch(); };
  const canSubmit = may('create', 'stockDocument', { record: { isKeeper: keptIds.has(warehouseId), viewOnly } });
  const needsProject = kind === 'issue' || kind === 'return';
  // #2517: an issue goes to its project's work order; a transfer to a site goes to the work order of that site's project.
  const destination = (warehouses.data ?? []).find((w) => w.id === toWarehouseId);
  const attributionProject = needsProject ? projectId : kind === 'transfer' && destination && ['site', 'yard', 'staging'].includes(destination.kind) ? destination.project_id : null;
  const offersAttribution = needsProject || kind === 'transfer';
  const heading = t(`kinds.${kind}`);

  const setLine = (key: number, patch: Partial<LineState>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  function validate(): { input: StockDocumentInput | null; errors: Record<string, string> } {
    const e: Record<string, string> = {};
    if (!warehouseId) e.warehouse = t('form.errors.warehouse');
    if (kind === 'transfer' && (!toWarehouseId || toWarehouseId === warehouseId)) e.toWarehouse = t('form.errors.toWarehouse');
    if (needsProject && !projectId) e.project = t('form.errors.project');
    const out: StockLineInput[] = lines.map((l) => {
      const q = normalizeDecimal(l.quantity);
      if (kind === 'return') { if (!l.sourceLineId) e[`source${l.key}`] = t('form.errors.source'); }
      else if (!l.itemId) e[`item${l.key}`] = t('form.errors.item');
      if (!isPositiveDecimal(q)) e[`qty${l.key}`] = t('form.errors.quantity');
      else if (wholeOnlyItem(l) && !isWholeQuantity(q)) e[`qty${l.key}`] = t('errors.STK_FRACTION');
      if (kind === 'issue' && !l.boqItemId) e[`boq${l.key}`] = t('form.errors.workItem');
      const cost = clientTag(l) ? '0' : normalizeDecimal(l.unitCost);
      if (kind === 'receive' && !/^\d+(\.\d{1,4})?$/.test(cost)) e[`cost${l.key}`] = t('form.errors.unitCost');
      return {
        itemId: l.itemId ?? '', quantity: q,
        ...(kind === 'receive' ? { unitCost: cost } : {}),
        ...(kind === 'issue' ? { boqItemId: l.boqItemId } : {}),
        ...(kind === 'return' ? { sourceLineId: l.sourceLineId } : {}),
      };
    });
    if (Object.keys(e).length) return { input: null, errors: e };
    return {
      errors: e,
      input: {
        kind: kind as StockDocumentKind, warehouseId,
        ...(kind === 'transfer' ? { toWarehouseId } : {}),
        ...(kind === 'issue' ? { projectId } : {}),
        ...(occurredOn ? { occurredOn } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        lines: out,
      },
    };
  }
  function wholeOnlyItem(l: LineState): boolean {
    const item = l.itemId ? itemById.get(l.itemId) : undefined;
    return item ? (wholeByUnit.get(item.unit_id) ?? false) : false;
  }
  /** The item's own unit code, so the quantity field can say what its number is measured in (C16). */
  function unitCodeOfLine(l: LineState): string {
    const item = l.itemId ? itemById.get(l.itemId) : undefined;
    return item ? (units.data ?? []).find((u) => u.id === item.unit_id)?.code ?? '' : '';
  }

  /** One guard before any posting: it names the item, the quantity and the place, so a wrong entry is caught before it reaches the ledger. */
  function askToPost() {
    const { input, errors } = validate();
    setFieldErrors(errors);
    if (input) setConfirming(true);
  }
  const placeName = (id: string) => { const w = (warehouses.data ?? []).find((x) => x.id === id); return w ? `${w.code} - ${w.name}` : ''; };
  const summary = lines.map((l) => {
    const item = l.itemId ? itemById.get(l.itemId) : undefined;
    return `${item ? `${item.code} - ${item.name}` : ''}: ${normalizeDecimal(l.quantity)} ${unitCodeOfLine(l)}`.trim();
  });

  async function submit(post = true) {
    const { input, errors } = validate();
    setFieldErrors(errors);
    if (!input) return;
    setSubmitError(null);
    try {
      const id = await create.mutateAsync({ input, post, clientRequestId: requestId.current, ...(offersAttribution ? { attribution } : {}) });
      requestId.current = crypto.randomUUID(); // a success mints the next submit's id; a failure keeps it for the retry
      toast(post ? t('form.posted') : t('form.draftSaved'), heading, 'success');
      setSaved(true);
      navigate(`/stock/documents/${id}`);
    } catch (err) {
      // The Draft was saved and the post did not go through: open it (its page says where it stands) rather than create it again.
      if (err instanceof StockDispatchError) { notify(err); setSaved(true); navigate(`/stock/documents/${err.documentId}`); return; }
      // Posted, but the work order / discipline was refused: open the movement and say why (it is not created again).
      if (err instanceof AttributionRefusedError) {
        const d = attributionError(err.refusal);
        requestId.current = crypto.randomUUID();
        toast(d.headline, d.detail, 'warning');
        setSaved(true);
        navigate(`/stock/documents/${err.recordId}`);
        return;
      }
      setSubmitError(err);
      const s = parseRefusal(err);
      if (s?.code === 'STK_INSUFFICIENT') {
        const hit = lines.find((l) => { const c = l.itemId ? itemById.get(l.itemId)?.code : undefined; return c && s.text.includes(`${c} `); }) ?? lines[0];
        setFieldErrors({ [`qty${hit.key}`]: errorText(err) });
      }
    }
  }

  const sourceOptions = (issueLines.data ?? []).map((l) => ({
    value: l.id,
    label: `${l.document.number} · ${l.item?.code ?? ''} × ${l.quantity}${l.boq ? ` · ${l.boq.item_code}` : ''}`,
  }));
  const sourceById = new Map((issueLines.data ?? []).map((l) => [l.id, l]));
  const insufficient = parseRefusal(submitError)?.code === 'STK_INSUFFICIENT';

  return (
    <div>
      <PageHeader title={heading} />
      <div className="max-w-5xl">

      {headerPending && <div data-testid="stock-header-region" className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={4} /></div>}
      {!headerPending && headerError && <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={retryHeader} />}
      {!headerPending && !headerError && usable.length === 0 && (
        <ListState variant="empty" icon="folder" title={t('form.noWarehouse.title')} sub={t('form.noWarehouse.sub')} />
      )}
      {!headerPending && !headerError && usable.length > 0 && (
        <form data-testid="stock-movement-form" onSubmit={(e) => { e.preventDefault(); if (linesSettled) askToPost(); }} noValidate className="space-y-4">
          {viewOnly && <p className="text-sm text-muted-foreground">{t('form.viewOnly')}</p>}
          <div data-testid="stock-movement-header">
          <FormSection legend={t('form.sections.where')}>
            <FormGrid>
              <SelectField
                label={kind === 'transfer' ? t('form.fromWarehouse') : t('form.warehouse')}
                required
                value={warehouseId}
                onChange={setWarehouseId}
                options={usable.map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))}
                placeholder={t('form.warehousePlaceholder')}
                error={fieldErrors.warehouse}
              />
              {kind === 'transfer' && (
                <SelectField
                  label={t('form.toWarehouse')}
                  required
                  value={toWarehouseId}
                  onChange={setToWarehouseId}
                  options={(warehouses.data ?? []).filter((w) => w.id !== warehouseId).map((w) => ({ value: w.id, label: `${w.code} - ${w.name}` }))}
                  placeholder={t('form.warehousePlaceholder')}
                  error={fieldErrors.toWarehouse}
                />
              )}
              {needsProject && (
                <SelectField
                  label={t('form.project')}
                  required
                  value={projectId}
                  onChange={(v) => { setProjectId(v); setLines((ls) => ls.map((l) => ({ ...l, boqItemId: '', sourceLineId: '' }))); }}
                  options={(projects.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
                  placeholder={projects.isPending ? t('form.loading') : t('form.projectPlaceholder')}
                  error={fieldErrors.project}
                />
              )}
              {offersAttribution && (
                <CostAttributionFields idPrefix="stock-movement" projectId={attributionProject} value={attribution} onChange={setAttribution} disabled={viewOnly} />
              )}
            </FormGrid>
          </FormSection>
          </div>

          <FormSection legend={t('form.sections.lines')}>
            <div data-testid="stock-lines-region">
            {linesPending && <StockLinesLoading reserve={MOVEMENT_LINES_RESERVE[kind] ?? MOVEMENT_LINES_RESERVE.receive} />}
            {!linesPending && linesError && <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={retryLines} />}
            {linesSettled && <div className="space-y-4">
              {lines.map((l, idx) => {
                const n = lines.length > 1 ? ` ${idx + 1}` : '';
                const src = sourceById.get(l.sourceLineId);
                return (
                  <div key={l.key} className="rounded-lg border border-border bg-card p-3">
                    <FormGrid>
                      {kind === 'return' ? (
                        <SelectField
                          label={`${t('form.cite')}${n}`}
                          required
                          value={l.sourceLineId}
                          onChange={(v) => { const s = sourceById.get(v); setLine(l.key, { sourceLineId: v, itemId: s?.item_id ?? null }); if (s && !warehouseId) setWarehouseId(s.document.warehouse_id); if (s?.document.work_order_id && !attribution.workOrderId) setAttribution({ ...attribution, workOrderId: s.document.work_order_id }); }}
                          options={sourceOptions}
                          placeholder={!projectId ? t('form.pickProjectFirst') : issueLines.isPending ? t('form.loading') : t('form.citePlaceholder')}
                          disabled={!projectId}
                          error={fieldErrors[`source${l.key}`] ?? (issueLines.isError ? t('form.loadFailed') : undefined)}
                        />
                      ) : (
                        <ItemPicker label={`${t('form.item')}${n}`} required value={l.itemId} onChange={(v) => setLine(l.key, { itemId: v })} error={fieldErrors[`item${l.key}`]} />
                      )}
                      {kind === 'issue' && (
                        <WorkItemSelect projectId={projectId} value={l.boqItemId} onChange={(v) => setLine(l.key, { boqItemId: v })} label={`${t('form.workItem')}${n}`} error={fieldErrors[`boq${l.key}`]} />
                      )}
                      <TextField
                        label={`${t('form.quantity')}${n}`}
                        required
                        inputMode="decimal"
                        autoComplete="off"
                        value={l.quantity}
                        onChange={(v) => setLine(l.key, { quantity: v })}
                        helper={kind === 'return' && src ? t('form.issuedHelper', { qty: src.quantity, unit: src.item?.unit.code ?? '' }) : unitCodeOfLine(l) ? t('form.qtyUnitHelp', 'Enter the quantity in {{unit}}.', { unit: unitCodeOfLine(l) }) : undefined}
                        error={fieldErrors[`qty${l.key}`]}
                      />
                      {kind === 'receive' && clientTag(l) && (
                        <p className="self-end text-control" data-testid={`client-material-${l.key}`}>
                          <span className="mr-2 rounded border border-border px-1.5 py-0.5 text-sm font-medium">{clientTag(l)!.name}</span>
                          {t('form.clientMaterialCost')}
                        </p>
                      )}
                      {kind === 'receive' && !clientTag(l) && (
                        <TextField
                          label={`${canSeeCost ? t('form.unitCost') : t('form.unitCostBlind')}${n}`}
                          required
                          inputMode="decimal"
                          autoComplete="off"
                          value={l.unitCost}
                          onChange={(v) => setLine(l.key, { unitCost: v })}
                          error={fieldErrors[`cost${l.key}`]}
                        />
                      )}
                    </FormGrid>
                    {lines.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                        {t('form.removeLine')}
                      </Button>
                    )}
                  </div>
                );
              })}
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, blankLine(nextKey.current++)])}>
                <Icon name="plus" />
                {t('form.addLine')}
              </Button>
            </div>}
            </div>
          </FormSection>

          <FormSection legend={t('form.sections.details')}>
            <div className="max-w-[260px]">
              <DateField label={t('form.occurredOn')} value={occurredOn} onChange={setOccurredOn} helper={t('form.occurredOnHelp')} max={today ?? undefined} />
            </div>
            <div className="mt-3">
              <TextArea label={t('form.note')} value={note} onChange={setNote} rows={2} />
            </div>
          </FormSection>

          {!insufficient && <FormErrorStrip>{submitError ? errorText(submitError) : null}</FormErrorStrip>}

          {canSubmit ? (
            <MobileActionBar className="fixed inset-x-0 bottom-[var(--phone-nav-height)] z-20 border-t border-border bg-card p-3 md:static md:border-0 md:bg-transparent md:p-0">
              <FormActions submitLabel={t(`form.submit.${kind}`)} cancelLabel={t('actions.cancel')} onCancel={() => guardLeave(() => navigate('/stock/documents'))} loading={create.isPending} disabled={!linesSettled} extraActions={kind === 'transfer' ? <Button variant="outline" disabled={!linesSettled || create.isPending} onClick={() => void submit(false)}>{t('form.saveDraft')}</Button> : undefined} />
            </MobileActionBar>
          ) : (
            <p className="text-sm text-muted-foreground">{warehouseId ? t('form.notKeeper') : t('form.pickWarehouse')}</p>
          )}
        </form>
      )}
      <ConfirmDialog
        open={confirming}
        title={t(`form.confirmPost.title.${kind}`)}
        description={<><span className="block">{t(`form.confirmPost.where.${kind}`, { from: placeName(warehouseId), to: placeName(toWarehouseId) })}</span><ul className="mt-2 list-disc pl-5">{summary.map((x, i) => <li key={i}>{x}</li>)}</ul><span className="mt-2 block">{t('form.confirmPost.undo')}</span></>}
        confirmLabel={t('form.confirmPost.confirm')}
        loading={create.isPending}
        onConfirm={() => { setConfirming(false); void submit(); }}
        onCancel={() => setConfirming(false)}
      />
      <UnsavedChangesDialog
        open={pendingLeave !== null}
        onDiscard={() => { const pending = pendingLeave; setPendingLeave(null); pending?.leave(); }}
        onKeepEditing={() => { const pending = pendingLeave; setPendingLeave(null); pending?.stay(); }}
      />
      </div>
    </div>
  );
};

/** /stock/new/:kind - adjustment and count have their own Draft-first form (#1512 S4). */
const StockNewDocument: React.FC = () => {
  const { kind } = useParams<{ kind: string }>();
  return kind === 'adjustment' || kind === 'count' ? <StockCount /> : <StockMovementForm />;
};

export default StockNewDocument;

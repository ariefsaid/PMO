import React, { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  Button, FormActions, FormGrid, FormSection, ListState, MobileActionBar, SelectField, TextArea, TextField, useToast, Icon,
} from '@/src/components/ui';
import { StockTabs } from '@/src/components/stock/StockTabs';
import { ItemPicker } from '@/src/components/stock/ItemPicker';
import { StockError } from '@/src/components/stock/StockError';
import { useStockErrorText } from '@/src/components/stock/useStockErrorText';
import { usePermission } from '@/src/auth/usePermission';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useAuth } from '@/src/auth/useAuth';
import {
  useIssuableProjects, useIssuableWorkItems, useProjectIssueLines, useStockDocumentMutations, useStockItems, useStockKeepers, useStockUnits, useStockWarehouses,
} from '@/src/hooks/useStock';
import { parseStockError } from '@/src/lib/stockErrors';
import { isPositiveDecimal, isWholeQuantity, normalizeDecimal } from '@/src/lib/stockFormat';
import type { StockDocumentInput, StockDocumentKind, StockLineInput } from '@/src/lib/db/stockDocuments';

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
  const { kind: kindParam } = useParams<{ kind: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const may = usePermission();
  const { realRole, effectiveRole } = useEffectiveRole();
  const me = useAuth().currentUser?.id;
  const errorText = useStockErrorText();
  const { create } = useStockDocumentMutations();

  const warehouses = useStockWarehouses(false);
  const keepers = useStockKeepers();
  const items = useStockItems(false);
  const units = useStockUnits(true);
  const projects = useIssuableProjects();

  const requestId = useRef<string>(crypto.randomUUID()); // stable across retries of one submit (FR-STK-015)
  const nextKey = useRef(2);
  const [warehouseId, setWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [projectId, setProjectId] = useState(params.get('project') ?? '');
  const [lines, setLines] = useState<LineState[]>([blankLine(1)]);
  const [occurredOn, setOccurredOn] = useState('');
  const [note, setNote] = useState('');
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const kind = isMovement(kindParam) ? kindParam : null;
  const issueLines = useProjectIssueLines(kind === 'return' ? projectId || undefined : undefined);

  const viewOnly = realRole !== effectiveRole; // view-as shares the real login, so the page stays read-only (FR-STK-064)
  const isAdmin = realRole === 'Admin';
  const canSeeCost = may('create', 'stockItem'); // rank >= 20 reads cost back (FR-STK-063)
  const keptIds = useMemo(() => new Set((keepers.data ?? []).filter((k) => k.user_id === me).map((k) => k.warehouse_id)), [keepers.data, me]);
  const usable = useMemo(() => (warehouses.data ?? []).filter((w) => isAdmin || keptIds.has(w.id)), [warehouses.data, isAdmin, keptIds]);
  const itemById = useMemo(() => new Map((items.data ?? []).map((i) => [i.id, i])), [items.data]);
  const wholeByUnit = useMemo(() => new Map((units.data ?? []).map((u) => [u.id, u.whole_only])), [units.data]);

  if (!kind) {
    return <div className="p-4"><ListState variant="empty" icon="folder" title={t('form.unknownKind')} sub={t('form.unknownKindSub')} /></div>;
  }
  const loadError = warehouses.isError || keepers.isError || items.isError || units.isError || (kind !== 'receive' && kind !== 'transfer' && projects.isError);
  const pending = warehouses.isPending || keepers.isPending || items.isPending || units.isPending;
  const retry = () => { for (const q of [warehouses, keepers, items, units, projects]) if (q.isError) void q.refetch(); };
  const canSubmit = may('create', 'stockDocument', { record: { isKeeper: keptIds.has(warehouseId), viewOnly } });
  const needsProject = kind === 'issue' || kind === 'return';
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
      const cost = normalizeDecimal(l.unitCost);
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

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    const { input, errors } = validate();
    setFieldErrors(errors);
    if (!input) return;
    setSubmitError(null);
    try {
      const id = await create.mutateAsync({ input, post: true, clientRequestId: requestId.current });
      requestId.current = crypto.randomUUID(); // a success mints the next submit's id; a failure keeps it for the retry
      toast(t('form.posted'), heading, 'success');
      navigate(`/stock/documents/${id}`);
    } catch (err) {
      setSubmitError(err);
      const s = parseStockError(err);
      if (s?.code === 'STK_INSUFFICIENT') {
        const hit = lines.find((l) => { const c = l.itemId ? itemById.get(l.itemId)?.code : undefined; return c && s.message.includes(`${c} `); }) ?? lines[0];
        setFieldErrors({ [`qty${hit.key}`]: errorText(err) });
      }
    }
  }

  const sourceOptions = (issueLines.data ?? []).map((l) => ({
    value: l.id,
    label: `${l.document.number} · ${l.item?.code ?? ''} × ${l.quantity}${l.boq ? ` · ${l.boq.item_code}` : ''}`,
  }));
  const sourceById = new Map((issueLines.data ?? []).map((l) => [l.id, l]));
  const insufficient = parseStockError(submitError)?.code === 'STK_INSUFFICIENT';

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4">
      <StockTabs />
      <h1 className="mb-1 text-title font-semibold">{heading}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t(`form.intro.${kind}`)}</p>

      {pending && <div className="rounded-lg border border-border bg-card"><ListState variant="loading" rows={4} /></div>}
      {!pending && loadError && <ListState variant="error" title={t('states.errorTitle')} sub={t('states.errorSub')} retryLabel={t('actions.retry')} onRetry={retry} />}
      {!pending && !loadError && usable.length === 0 && (
        <ListState variant="empty" icon="folder" title={t('form.noWarehouse.title')} sub={t('form.noWarehouse.sub')} />
      )}
      {!pending && !loadError && usable.length > 0 && (
        <form onSubmit={(e) => void submit(e)} noValidate className="space-y-4 pb-24 md:pb-0">
          {viewOnly && <p className="text-sm text-muted-foreground">{t('form.viewOnly')}</p>}
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
            </FormGrid>
          </FormSection>

          <FormSection legend={t('form.sections.lines')}>
            <div className="space-y-4">
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
                          onChange={(v) => { const s = sourceById.get(v); setLine(l.key, { sourceLineId: v, itemId: s?.item_id ?? null }); if (s && !warehouseId) setWarehouseId(s.document.warehouse_id); }}
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
                        helper={kind === 'return' && src ? t('form.issuedHelper', { qty: src.quantity, unit: src.item?.unit.code ?? '' }) : undefined}
                        error={fieldErrors[`qty${l.key}`]}
                      />
                      {kind === 'receive' && (
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
            </div>
          </FormSection>

          <FormSection legend={t('form.sections.details')}>
            <FormGrid>
              <TextField label={t('form.occurredOn')} type="date" value={occurredOn} onChange={setOccurredOn} helper={t('form.occurredOnHelp')} />
            </FormGrid>
            <div className="mt-3">
              <TextArea label={t('form.note')} value={note} onChange={setNote} rows={2} />
            </div>
          </FormSection>

          {!insufficient && <StockError error={submitError} />}

          {canSubmit ? (
            <MobileActionBar className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card p-3 md:static md:border-0 md:bg-transparent md:p-0">
              <FormActions submitLabel={t(`form.submit.${kind}`)} cancelLabel={t('actions.cancel')} onCancel={() => navigate('/stock/documents')} loading={create.isPending} />
            </MobileActionBar>
          ) : (
            <p className="text-sm text-muted-foreground">{warehouseId ? t('form.notKeeper') : t('form.pickWarehouse')}</p>
          )}
        </form>
      )}
    </div>
  );
};

export default StockMovementForm;

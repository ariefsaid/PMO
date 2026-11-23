import React, { useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, SelectField, TextArea, TextField } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useProjects } from '@/src/hooks/useProjects';
import { useOverContract, useQuantityChangeMutations, useWorkOrderRequestBudget } from '@/src/hooks/useQuantityChanges';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError, joinSentences } from '@/src/lib/classifyMutationError';
import { projectDisplayName } from '@/src/lib/projectDisplayName';
import { limitReached, validateRequestedQuantity, type RequestedQuantityError } from '@/src/lib/quantityChangeRules';
import { useRequestedQuantityErrorText } from './requestedQuantityError';

interface LineDraft { quantity: string; reason: string }

/**
 * Start a quantity change request (FR-QCR-004): pick the work order, then ask for a new total on each contract line that is
 * over its contract quantity AND allocated to it. The create carries one client request id for the dialog's life, so a retried
 * tap returns the same request and counts once (FR-QCR-008). The server re-checks everything shown here, including the limit.
 */
export const RaiseQuantityChangeDialog: React.FC<{
  onClose: () => void;
  onCreated: (id: string) => void;
  presetProjectId?: string;
  presetWorkOrderId?: string;
}> = ({ onClose, onCreated, presetProjectId, presetWorkOrderId }) => {
  const { t } = useTranslation('quantityChanges');
  const orgId = useAuth().currentUser?.org_id;
  const projects = useProjects();
  const { raise } = useQuantityChangeMutations();
  const errorWords = useRequestedQuantityErrorText();
  const requestId = useRef(crypto.randomUUID());
  const [projectId, setProjectId] = useState(presetProjectId ?? '');
  const [workOrderId, setWorkOrderId] = useState(presetWorkOrderId ?? '');
  const [lines, setLines] = useState<Record<string, LineDraft>>({});
  const [note, setNote] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workOrders = useQuery({
    queryKey: ['quantity-changes', orgId, 'raise', 'work-orders', projectId],
    queryFn: () => repositories.workOrder.list(projectId),
    enabled: Boolean(orgId && projectId),
  });
  const allocated = useQuery({
    queryKey: ['quantity-changes', orgId, 'raise', 'allocated', workOrderId],
    queryFn: () => repositories.dailySiteReport.listContractItems(workOrderId),
    enabled: Boolean(orgId && workOrderId),
  });
  const over = useOverContract(projectId || undefined, true);
  const budget = useWorkOrderRequestBudget(workOrderId || undefined);

  const projectOptions = useMemo(() => (projects.data ?? []).map((p) => ({ value: p.id, label: projectDisplayName(p) })), [projects.data]);
  const workOrderOptions = useMemo(() => (workOrders.data ?? [])
    .filter((w) => w.status !== 'Cancelled' && w.status !== 'Closed')
    .map((w) => ({ value: w.id, label: [w.wo_number, w.title].filter(Boolean).join(' · ') })), [workOrders.data]);
  const allocatedIds = useMemo(() => new Set((allocated.data ?? []).map((a) => a.boq_item_id)), [allocated.data]);
  const eligible = useMemo(
    () => (over.data ?? []).filter((r) => allocatedIds.has(r.boq_item_id) && !r.open_request_id && r.earning_basis === 'unit_rate'),
    [over.data, allocatedIds],
  );

  const chosen = eligible.filter((r) => (lines[r.boq_item_id]?.quantity ?? '').trim() !== '');
  const figureOf = (r: (typeof eligible)[number]) => (r.over_progress ? r.progress_quantity : (r.forecast_quantity ?? 0));
  const errorFor = (r: (typeof eligible)[number]): RequestedQuantityError | 'required' | null => {
    const d = lines[r.boq_item_id];
    if (!d || d.quantity.trim() === '') return null;
    const bad = validateRequestedQuantity(d.quantity, r.contract_quantity, figureOf(r));
    if (bad) return bad;
    return d.reason.trim() === '' ? 'required' : null;
  };
  const invalid = chosen.some((r) => errorFor(r) !== null);
  const atLimit = budget.data ? limitReached(budget.data.request_count, budget.data.request_limit) : false;

  const setLine = (id: string, patch: Partial<LineDraft>) =>
    setLines((prev) => ({ ...prev, [id]: { ...(prev[id] ?? { quantity: '', reason: '' }), ...patch } }));
  const errorText = (e: RequestedQuantityError | 'required' | null, r: (typeof eligible)[number]) => {
    if (!e || !showErrors) return undefined;
    return errorWords(e, { contract: r.contract_quantity, figure: figureOf(r) });
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setShowErrors(true);
    setError(null);
    if (chosen.length === 0 || invalid || atLimit) return;
    try {
      const id = await raise.mutateAsync({
        workOrderId, clientRequestId: requestId.current, note: note.trim() || null,
        lines: chosen.map((r) => ({ boqItemId: r.boq_item_id, requestedQuantity: lines[r.boq_item_id].quantity.trim(), reason: lines[r.boq_item_id].reason.trim() })),
      });
      onCreated(id);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail ? joinSentences(headline, detail) : headline);
    }
  };

  return (
    <EntityFormModal
      open
      title={t('raise.title', 'New quantity change request')}
      submitLabel={t('raise.submit', 'Create draft')}
      onSubmit={(e) => void submit(e)}
      onClose={onClose}
      submitDisabled={!workOrderId || chosen.length === 0 || atLimit}
      loading={raise.isPending}
      submitError={error ? { headline: error } : null}
    >
      {!presetProjectId && (
        <SelectField label={t('raise.project', 'Project')} required value={projectId}
          onChange={(v) => { setProjectId(v); setWorkOrderId(''); setLines({}); }}
          options={[{ value: '', label: t('raise.pickProject', 'Choose a project') }, ...projectOptions]} />
      )}
      {!presetWorkOrderId && (
        <SelectField label={t('raise.workOrder', 'Work order')} required value={workOrderId} disabled={!projectId}
          onChange={(v) => { setWorkOrderId(v); setLines({}); }}
          options={[{ value: '', label: t('raise.pickWorkOrder', 'Choose a work order') }, ...workOrderOptions]} />
      )}
      {workOrderId && budget.data && (
        <p className="text-foreground" data-testid="qcr-limit-note">
          {budget.data.request_limit === null
            ? t('raise.limitNone', { defaultValue: '{{count}} requests on this work order', count: budget.data.request_count })
            : t('raise.limit', { defaultValue: '{{count}} of {{limit}} requests used on this work order', count: budget.data.request_count, limit: budget.data.request_limit })}
          {atLimit ? ` · ${t('raise.limitReached', 'This work order has reached its request limit')}` : ''}
        </p>
      )}
      {workOrderId && !allocated.isPending && !over.isPending && eligible.length === 0 && (
        <p className="text-muted-foreground">{t('raise.noLines', 'No allocated contract line on this work order is over its contract quantity')}</p>
      )}
      {eligible.map((r) => {
        const e = errorFor(r);
        return (
          <fieldset key={r.boq_item_id} className="space-y-2 rounded-lg border border-border p-3" data-testid="qcr-raise-line">
            <legend className="px-1 font-medium text-foreground">{r.item_code} · {r.description}</legend>
            <p className="text-muted-foreground">
              {t('raise.lineHelp', {
                defaultValue: '{{kind}} {{figure}} against a contract quantity of {{contract}} {{unit}}',
                kind: t(`over.kind.${r.over_progress ? 'progress' : 'forecast'}`), figure: figureOf(r), contract: r.contract_quantity, unit: r.unit,
              })}
            </p>
            <TextField label={t('raise.requested', { defaultValue: 'Requested total quantity ({{unit}})', unit: r.unit })} inputMode="decimal"
              value={lines[r.boq_item_id]?.quantity ?? ''} onChange={(v) => setLine(r.boq_item_id, { quantity: v })}
              error={e && e !== 'required' ? errorText(e, r) : undefined} />
            {(lines[r.boq_item_id]?.quantity ?? '').trim() !== '' && (
              <TextArea label={t('raise.reason', 'Reason')} value={lines[r.boq_item_id]?.reason ?? ''} maxLength={500}
                onChange={(v) => setLine(r.boq_item_id, { reason: v })} error={e === 'required' ? errorText(e, r) : undefined} />
            )}
          </fieldset>
        );
      })}
      {chosen.length > 0 && <TextArea label={t('raise.note', 'Note for the approver')} value={note} maxLength={1000} onChange={setNote} />}
    </EntityFormModal>
  );
};

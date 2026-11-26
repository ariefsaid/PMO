import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Checkbox, EntityFormModal, FieldError, FormGrid, FormSection, Icon, ListState, NumberField, SelectField, type SubmitError,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, formatNumberExact, formatUtcMonthYear, parseMoneyInputAtScale } from '@/src/lib/format';
import { claimableHeadroom, fractionToPercentInput, milli, percentToFraction, prefillFromAssessment, suggestedRecoveryPct, type ContractLineFacts } from '@/src/lib/progressBilling';
import { prefillForWorkOrder } from '@/src/lib/contractQuantityPrefill';
import type { BoqItemRow, ProgressClaimInput } from '@/src/lib/db/progressBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';
import type { WorkOrderLineRow } from '@/src/lib/db/workOrderAcceptances';

/**
 * Create a BILLING claim (#766, DD-PBL-7). Finance states the quantities; "start from the latest assessment" is a
 * pre-fill (assessed − already claimed), never a rule. Money is not sent: the server copies rates and computes
 * the down-payment recovery. A claim is raised to the ERP later, once evidence is attached.
 */
export interface ProgressClaimModalProps {
  boqItems: BoqItemRow[];
  /** This project's work orders; only Issued/Closed ones are offered as a scope. */
  workOrders: WorkOrderRow[];
  /** Every allocation on the project, any work-order status — decides which lines a scope may bill (DD-CQ-6). */
  allocations: WorkOrderLineRow[];
  /** Server facts per line: ordered, accepted (BAST) and claimed quantities per work order. */
  contractLines: ContractLineFacts[];
  /** Net contract value — for the proportional-percentage hint only. */
  contractNet: number;
  currencySymbolPrefix: string;
  /** A live down payment exists: no second one is offered, and "recover the rest" is. */
  hasDownPayment: boolean;
  claimedByBoqItem: Record<string, number>;
  assessedByBoqItem: Record<string, number>;
  /** `YYYY-MM-01` of the latest assessment, or null. */
  assessmentMonth: string | null;
  /** Customer order that opened the modal; its accepted-minus-claimed quantities are prefilled for review. */
  initialWorkOrderId?: string;
  sources?: Array<{ name: string; pending: boolean; error: boolean; retry: () => void }>;
  /** The organisation's claim-quantity setting: `block` means the database refuses a line over its headroom (default `warn`). */
  overCapMode?: 'warn' | 'block';
  onClose: () => void;
  onSave: (input: Omit<ProgressClaimInput, 'projectId'>) => Promise<void>;
  onError: (err: unknown) => void;
}

type Kind = ProgressClaimInput['kind'];

const ProgressClaimModal: React.FC<ProgressClaimModalProps> = ({
  boqItems, workOrders, allocations, contractLines, contractNet, currencySymbolPrefix, hasDownPayment, claimedByBoqItem, assessedByBoqItem,
  assessmentMonth, initialWorkOrderId, sources = [], overCapMode = 'warn', onClose, onSave, onError,
}) => {
  const { t } = useTranslation('project');
  const [kind, setKind] = useState<Kind>('progress');
  const initialScope = initialWorkOrderId && workOrders.some((wo) => wo.id === initialWorkOrderId && (wo.status === 'Issued' || wo.status === 'Closed'))
    ? initialWorkOrderId
    : '';
  const [scope, setScope] = useState(initialScope);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const initialPrefillApplied = useRef(false);
  const [recoverRest, setRecoverRest] = useState(false);
  const [dpAmount, setDpAmount] = useState('');
  const [recoveryPct, setRecoveryPct] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const scopes = workOrders.filter((wo) => wo.status === 'Issued' || wo.status === 'Closed');
  // A scope bills only its own allocations; "no work order" bills only lines no work order ever took.
  const allocatedElsewhere = new Set(allocations.map((row) => row.boq_item_id));
  const allocatedHere = new Set(allocations.filter((row) => row.work_order_id === scope).map((row) => row.boq_item_id));
  const inScope = boqItems.filter((line) => (scope === '' ? !allocatedElsewhere.has(line.id) : allocatedHere.has(line.id)));
  const inScopeIds = inScope.map((line) => line.id);
  const woPrefill = scope === '' ? null : prefillForWorkOrder(scope, inScopeIds, contractLines, assessedByBoqItem, claimedByBoqItem);
  const prefill = woPrefill ? woPrefill.quantities : prefillFromAssessment(inScopeIds, assessedByBoqItem, claimedByBoqItem);
  const dpValue = parseMoneyInputAtScale(dpAmount, 2);
  const suggested = dpValue === null ? null : suggestedRecoveryPct(dpValue, contractNet);

  /**
   * Over-claim note: a warning (OD-SCOPE-6), or "will be refused" when the organisation's setting makes the database refuse it. Where the
   * line has a certified (surveyed) quantity the ceiling is that figure, and the surveyed and quality-ready figures show beside the line.
   * Passing quality-ready is only ever a warning: there is no setting for it.
   */
  const overClaimHelper = (line: BoqItemRow): React.ReactNode => {
    if (scope === '' || line.earning_basis === 'lump_sum') return undefined;
    const allocation = contractLines.find((l) => l.boqItemId === line.id)?.allocations.find((a) => a.workOrderId === scope);
    if (!allocation) return undefined;
    const surveyed = allocation.surveyedQuantity ?? null;
    const qualityReady = allocation.qualityReadyQuantity ?? null;
    const typed = parseMoneyInputAtScale((quantities[line.id] ?? '').trim(), 3);
    const survey = surveyed === null ? null : (
      <span data-testid={`claim-survey-${line.id}`} className="text-control text-muted-foreground">
        {t('projectTabs:contractQuantities.billing.claimForm.surveyFigures', 'Surveyed {{surveyed}} {{unit}}, of which quality-ready {{quality}}',
          { surveyed: formatNumberExact(surveyed), unit: line.unit, quality: formatNumberExact(qualityReady ?? 0) })}
      </span>
    );
    const refuse = overCapMode === 'block';
    let warning: string | null = null;
    if (typed !== null && typed > 0) {
      const room = claimableHeadroom({ ordered: allocation.quantity, claimed: allocation.claimedQuantity, accepted: allocation.acceptedQuantity, surveyed });
      const figures = { headroom: formatNumberExact(room.headroom), unit: line.unit, ceiling: formatNumberExact(room.ceiling), claimed: formatNumberExact(allocation.claimedQuantity) };
      if (milli(typed) > milli(room.headroom)) {
        warning = room.basis === 'surveyed'
          ? (refuse
            ? t('projectTabs:contractQuantities.billing.claimForm.overClaimSurveyedBlock', 'Will be refused: this is more than the {{headroom}} {{unit}} still claimable (surveyed {{ceiling}}, already claimed {{claimed}}). Lower it to {{headroom}}, or have the next survey confirmed first.', figures)
            : t('projectTabs:contractQuantities.billing.claimForm.overClaimSurveyed', 'Warning: this is more than the {{headroom}} {{unit}} still claimable (surveyed {{ceiling}}, already claimed {{claimed}}). Lower it to {{headroom}}, or have the next survey confirmed first. You can still raise the claim.', figures))
          : room.basis === 'accepted'
            ? (refuse
              ? t('projectTabs:contractQuantities.billing.claimForm.overClaimAcceptedBlock', 'Will be refused: this is more than the {{headroom}} {{unit}} still claimable (accepted {{ceiling}}, already claimed {{claimed}}). Lower it to {{headroom}}, or confirm the next BAST first.', figures)
              : t('projectTabs:contractQuantities.billing.claimForm.overClaimAccepted', 'Warning: this is more than the {{headroom}} {{unit}} still claimable (accepted {{ceiling}}, already claimed {{claimed}}). Lower it to {{headroom}}, or confirm the next BAST first. You can still raise the claim.', figures))
            : (refuse
              ? t('projectTabs:contractQuantities.billing.claimForm.overClaimOrderedBlock', 'Will be refused: this is more than the {{headroom}} {{unit}} still claimable (ordered {{ceiling}}, already claimed {{claimed}}, nothing accepted yet). Lower it to {{headroom}}, or confirm a BAST first.', figures)
              : t('projectTabs:contractQuantities.billing.claimForm.overClaimOrdered', 'Warning: this is more than the {{headroom}} {{unit}} still claimable (ordered {{ceiling}}, already claimed {{claimed}}, nothing accepted yet). Lower it to {{headroom}}, or confirm a BAST first. You can still raise the claim.', figures));
      } else if (qualityReady !== null && milli(allocation.claimedQuantity) + milli(typed) > milli(qualityReady)) {
        warning = t('projectTabs:contractQuantities.billing.claimForm.overQualityReady', 'Warning: with this claim, {{total}} {{unit}} is claimed but only {{quality}} {{unit}} has quality documents. Attach the quality documents to a survey, or lower it. You can still raise the claim.',
          { total: formatNumberExact((milli(allocation.claimedQuantity) + milli(typed)) / 1000), unit: line.unit, quality: formatNumberExact(qualityReady) });
      }
    }
    if (survey === null && warning === null) return undefined;
    return (
      <span className="flex flex-col gap-1">
        {survey}
        {warning !== null && (
          <span data-testid={`claim-overclaim-${line.id}`} role="status" className="flex items-start gap-1.5 text-control font-medium text-warning-foreground">
            <Icon name="alert" className="mt-0.5 size-[13px] shrink-0 text-warning-icon" />
            {warning}
          </span>
        )}
      </span>
    );
  };

  const kindOptions = [
    { value: 'progress', label: t('projectDetail.billing.claimForm.kindProgress', 'Progress: quantities against the bill of quantities') },
    ...(hasDownPayment ? [] : [{ value: 'down_payment', label: t('projectDetail.billing.claimForm.kindDownPayment', 'Down payment') }]),
  ];
  const scopeOptions = [
    { value: '', label: t('projectDetail.billing.claimForm.scopeContract', 'Lines with no work order') },
    ...scopes.map((wo) => ({ value: wo.id, label: wo.wo_number ? `${wo.wo_number} — ${wo.title}` : wo.title })),
  ];

  const build = (): { errs: Record<string, string>; input: Omit<ProgressClaimInput, 'projectId'> | null } => {
    const errs: Record<string, string> = {};
    if (kind === 'down_payment') {
      const pct = parseMoneyInputAtScale(recoveryPct, 3);
      if (dpValue === null || dpValue <= 0) {
        errs.dpAmount = t('projectDetail.billing.claimForm.errors.dpAmount', 'Enter a down payment above 0 with at most 2 decimal places');
      }
      if (pct === null || pct <= 0 || pct > 100) {
        errs.recoveryPct = t('projectDetail.billing.claimForm.errors.recoveryPct', 'Enter a percentage above 0 and at most 100, with at most 3 decimal places');
      }
      if (dpValue === null || pct === null || Object.keys(errs).length > 0) return { errs, input: null };
      return { errs, input: { kind, workOrderId: null, downPaymentAmount: dpValue, recoveryPct: pct } };
    }
    const lines: Array<{ boqItemId: string; quantity: number }> = [];
    for (const line of inScope) {
      const raw = (quantities[line.id] ?? '').trim();
      if (raw === '') continue;
      if (line.earning_basis === 'lump_sum') {
        const pct = parseMoneyInputAtScale(raw, 1);
        if (pct === null || pct <= 0 || pct > 100) {
          errs[line.id] = t('projectTabs:contractQuantities.billing.claimForm.errors.percent', 'Enter a percentage above 0 and up to 100 with at most 1 decimal place');
        } else {
          lines.push({ boqItemId: line.id, quantity: percentToFraction(pct) });
        }
        continue;
      }
      const quantity = parseMoneyInputAtScale(raw, 3);
      if (quantity === null || quantity <= 0) {
        errs[line.id] = t('projectDetail.billing.claimForm.errors.quantity', 'Each quantity must be above 0 with at most 3 decimal places');
      } else {
        lines.push({ boqItemId: line.id, quantity });
      }
    }
    if (Object.keys(errs).length === 0 && lines.length === 0) {
      errs.lines = t('projectDetail.billing.claimForm.errors.noQuantity', 'Enter a quantity for at least one line');
    }
    if (Object.keys(errs).length > 0) return { errs, input: null };
    return { errs, input: { kind, workOrderId: scope || null, lines, recoverRemaining: recoverRest } };
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (sources.some((source) => source.pending || source.error)) return;
    const { errs, input } = build();
    setErrors(errs);
    if (!input) return;
    setSaving(true);
    setSaveError(null);
    void onSave(input)
      .catch((err: unknown) => {
        const { headline, detail } = classifyMutationError(err, undefined, { suppressCapture: true });
        setSaveError({ headline, detail });
        onError(err);
      })
      .finally(() => setSaving(false));
  };

  const lumpSumIds = new Set(inScope.filter((line) => line.earning_basis === 'lump_sum').map((line) => line.id));
  const applyPrefill = () =>
    setQuantities(Object.fromEntries(Object.entries(prefill).map(([id, quantity]) => [
      id, lumpSumIds.has(id) ? fractionToPercentInput(quantity) : formatMoneyInputValue(quantity),
    ])));

  useEffect(() => {
    if (!initialWorkOrderId || !initialScope || initialPrefillApplied.current) return;
    initialPrefillApplied.current = true;
    setQuantities(Object.fromEntries(Object.entries(prefill).map(([id, quantity]) => {
      const line = boqItems.find((item) => item.id === id);
      return [id, line?.earning_basis === 'lump_sum' ? fractionToPercentInput(quantity) : formatMoneyInputValue(quantity)];
    })));
  }, [boqItems, initialScope, initialWorkOrderId, prefill]);

  return (
    <EntityFormModal
      open
      width="lg"
      title={t('projectDetail.billing.claimForm.title', 'New billing claim')}
      submitLabel={t('projectDetail.billing.claimForm.save', 'Create claim')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={saving}
      submitDisabled={sources.some((source) => source.pending || source.error)}
      dirty={kind !== 'progress' || dpAmount !== '' || recoveryPct !== '' || Object.values(quantities).some((q) => q !== '')}
    >
      {sources.filter((source) => source.pending || source.error).map((source) => source.error
        ? <ListState key={source.name} variant="error" title={t('projectDetail.billing.sources.error', "Couldn't load {{source}}", { source: source.name })} onRetry={source.retry} />
        : <p key={source.name} role="status" className="text-sm text-muted-foreground">{t('projectDetail.billing.sources.loading', 'Loading {{source}}…', { source: source.name })}</p>)}
      <div>
        <FormGrid className="sm:[grid-template-columns:1fr]">
          <SelectField id="claim-kind" label={t('projectDetail.billing.claimForm.kind', 'Claim type')} value={kind}
            onChange={(value) => { setKind(value as Kind); setErrors({}); }} options={kindOptions} />
          {kind === 'progress' && (
            <SelectField id="claim-scope" label={t('projectDetail.billing.claimForm.scope', 'Bills')} value={scope}
              onChange={(value) => { setScope(value); setQuantities({}); setErrors({}); }} options={scopeOptions} />
          )}
        </FormGrid>
      </div>

      {kind === 'down_payment' ? (
        <FormSection legend={t('projectDetail.billing.claimForm.kindDownPayment', 'Down payment')}>
          <FormGrid>
            <NumberField id="claim-dp-amount" label={t('projectDetail.billing.claimForm.dpAmount', 'Down payment amount (excl. tax)')}
              required prefix={currencySymbolPrefix} value={dpAmount} onChange={setDpAmount} error={errors.dpAmount} localeAware />
            <NumberField id="claim-recovery-pct" label={t('projectDetail.billing.claimForm.recoveryPct', 'Recovered from each claim (%)')}
              required value={recoveryPct} onChange={setRecoveryPct} error={errors.recoveryPct} localeAware
              helper={suggested === null ? undefined
                : t('projectDetail.billing.claimForm.recoveryHelp', 'Proportional to the contract: {{pct}}%', { pct: formatNumberExact(suggested) })} />
          </FormGrid>
        </FormSection>
      ) : (
        <FormSection legend={t('projectDetail.billing.claimForm.linesLegend', 'Quantities to bill')}>
          {Object.keys(prefill).length > 0 && (woPrefill?.fromSurvey || woPrefill?.fromBast || assessmentMonth) && (
            <Button type="button" variant="outline" size="sm" className="mb-3" onClick={applyPrefill}>
              {woPrefill?.fromSurvey
                ? t('projectTabs:contractQuantities.billing.claimForm.prefillSurvey', 'Start from the surveyed quantities')
                : woPrefill?.fromBast
                ? t('projectTabs:contractQuantities.billing.claimForm.prefillBast', 'Start from the accepted BAST quantities')
                : t('projectDetail.billing.claimForm.prefill', 'Start from the {{month}} assessment',
                  { month: formatUtcMonthYear(new Date(`${assessmentMonth ?? ''}T00:00:00Z`)) })}
            </Button>
          )}
          {inScope.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('projectDetail.billing.claimForm.noLines', 'No bill of quantities lines in this scope.')}
            </p>
          ) : (
            <FormGrid>
              {inScope.map((line) => (
                <NumberField key={line.id} id={`claim-qty-${line.id}`}
                  label={line.earning_basis === 'lump_sum'
                    ? t('projectTabs:contractQuantities.billing.claimForm.percentLine', '{{item}}: % to bill', { item: `${line.item_code} — ${line.description}` })
                    : t('projectDetail.billing.claimForm.quantity', '{{item}}: {{description}} ({{unit}})',
                    { item: line.item_code, description: line.description, unit: line.unit })}
                  value={quantities[line.id] ?? ''}
                  onChange={(value) => setQuantities((current) => ({ ...current, [line.id]: value }))}
                  error={errors[line.id]} helper={overClaimHelper(line)} localeAware />
              ))}
            </FormGrid>
          )}
          {errors.lines && <FieldError>{errors.lines}</FieldError>}
          {hasDownPayment && (
            <div className="mt-3 flex items-center gap-2 text-sm">
              <Checkbox
                checked={recoverRest}
                onChange={setRecoverRest}
                label={t('projectDetail.billing.claimForm.recoverRest', 'Recover the rest of the down payment with this claim')}
                labelledBy="claim-recover-rest-label"
              />
              <span id="claim-recover-rest-label" onClick={() => setRecoverRest((value) => !value)}>
                {t('projectDetail.billing.claimForm.recoverRest', 'Recover the rest of the down payment with this claim')}
              </span>
            </div>
          )}
        </FormSection>
      )}
      <p className="mt-3 text-sm text-muted-foreground">{t('projectDetail.billing.claimForm.subtitle', 'A claim becomes one invoice. Attach the evidence before raising it.')}</p>
    </EntityFormModal>
  );
};

export default ProgressClaimModal;

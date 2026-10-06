import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, EntityFormModal, FieldError, FormGrid, FormSection, NumberField, SelectField, type SubmitError,
} from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, formatNumberExact, formatUtcMonthYear, parseMoneyInputAtScale } from '@/src/lib/format';
import { prefillFromAssessment, suggestedRecoveryPct } from '@/src/lib/progressBilling';
import type { BoqItemRow, ProgressClaimInput } from '@/src/lib/db/progressBilling';
import type { WorkOrderRow } from '@/src/lib/db/workOrders';

/**
 * Create a BILLING claim (#766, DD-PBL-7). Finance states the quantities; "start from the latest assessment" is a
 * pre-fill (assessed − already claimed), never a rule. Money is not sent: the server copies rates and computes
 * the down-payment recovery. A claim is raised to the ERP later, once evidence is attached.
 */
export interface ProgressClaimModalProps {
  boqItems: BoqItemRow[];
  /** This project's work orders; only Issued/Closed ones are offered as a scope. */
  workOrders: WorkOrderRow[];
  /** Net contract value — for the proportional-percentage hint only. */
  contractNet: number;
  currencySymbolPrefix: string;
  /** A live down payment exists: no second one is offered, and "recover the rest" is. */
  hasDownPayment: boolean;
  claimedByBoqItem: Record<string, number>;
  assessedByBoqItem: Record<string, number>;
  /** `YYYY-MM-01` of the latest assessment, or null. */
  assessmentMonth: string | null;
  onClose: () => void;
  onSave: (input: Omit<ProgressClaimInput, 'projectId'>) => Promise<void>;
  onError: (err: unknown) => void;
}

type Kind = ProgressClaimInput['kind'];

const ProgressClaimModal: React.FC<ProgressClaimModalProps> = ({
  boqItems, workOrders, contractNet, currencySymbolPrefix, hasDownPayment, claimedByBoqItem, assessedByBoqItem,
  assessmentMonth, onClose, onSave, onError,
}) => {
  const { t } = useTranslation();
  const [kind, setKind] = useState<Kind>('progress');
  const [scope, setScope] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [recoverRest, setRecoverRest] = useState(false);
  const [dpAmount, setDpAmount] = useState('');
  const [recoveryPct, setRecoveryPct] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const scopes = workOrders.filter((wo) => wo.status === 'Issued' || wo.status === 'Closed');
  const inScope = boqItems.filter((line) => (line.work_order_id ?? '') === scope);
  const prefill = prefillFromAssessment(inScope.map((line) => line.id), assessedByBoqItem, claimedByBoqItem);
  const dpValue = parseMoneyInputAtScale(dpAmount, 2);
  const suggested = dpValue === null ? null : suggestedRecoveryPct(dpValue, contractNet);

  const kindOptions = [
    { value: 'progress', label: t('projectDetail.billing.claimForm.kindProgress', 'Progress — quantities against the bill of quantities') },
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

  const applyPrefill = () =>
    setQuantities(Object.fromEntries(Object.entries(prefill).map(([id, quantity]) => [id, formatMoneyInputValue(quantity)])));

  return (
    <EntityFormModal
      open
      width="lg"
      title={t('projectDetail.billing.claimForm.title', 'New billing claim')}
      subtitle={t('projectDetail.billing.claimForm.subtitle', 'A claim becomes one ERP invoice. Attach the evidence before raising it.')}
      submitLabel={t('projectDetail.billing.claimForm.save', 'Create claim')}
      onSubmit={handleSubmit}
      submitError={saveError}
      onClose={onClose}
      loading={saving}
      dirty={kind !== 'progress' || dpAmount !== '' || recoveryPct !== '' || Object.values(quantities).some((q) => q !== '')}
    >
      <FormSection legend={t('projectDetail.billing.claimForm.kind', 'Claim type')}>
        <FormGrid>
          <SelectField id="claim-kind" label={t('projectDetail.billing.claimForm.kind', 'Claim type')} value={kind}
            onChange={(value) => { setKind(value as Kind); setErrors({}); }} options={kindOptions} />
          {kind === 'progress' && (
            <SelectField id="claim-scope" label={t('projectDetail.billing.claimForm.scope', 'Bills')} value={scope}
              onChange={(value) => { setScope(value); setQuantities({}); setErrors({}); }} options={scopeOptions} />
          )}
        </FormGrid>
      </FormSection>

      {kind === 'down_payment' ? (
        <FormSection legend={t('projectDetail.billing.claimForm.kindDownPayment', 'Down payment')}>
          <FormGrid>
            <NumberField id="claim-dp-amount" label={t('projectDetail.billing.claimForm.dpAmount', 'Down payment amount (excl. PPN)')}
              required prefix={currencySymbolPrefix} value={dpAmount} onChange={setDpAmount} error={errors.dpAmount} localeAware />
            <NumberField id="claim-recovery-pct" label={t('projectDetail.billing.claimForm.recoveryPct', 'Recovered from each claim (%)')}
              required value={recoveryPct} onChange={setRecoveryPct} error={errors.recoveryPct} localeAware
              helper={suggested === null ? undefined
                : t('projectDetail.billing.claimForm.recoveryHelp', 'Proportional to the contract: {{pct}}%', { pct: formatNumberExact(suggested) })} />
          </FormGrid>
        </FormSection>
      ) : (
        <FormSection legend={t('projectDetail.billing.claimForm.linesLegend', 'Quantities to bill')}>
          {assessmentMonth && Object.keys(prefill).length > 0 && (
            <Button type="button" variant="outline" size="sm" className="mb-3" onClick={applyPrefill}>
              {t('projectDetail.billing.claimForm.prefill', 'Start from the {{month}} assessment',
                { month: formatUtcMonthYear(new Date(`${assessmentMonth}T00:00:00Z`)) })}
            </Button>
          )}
          {inScope.length === 0 ? (
            <p className="text-[13px] text-muted-foreground">
              {t('projectDetail.billing.claimForm.noLines', 'No bill of quantities lines in this scope.')}
            </p>
          ) : (
            <FormGrid>
              {inScope.map((line) => (
                <NumberField key={line.id} id={`claim-qty-${line.id}`}
                  label={t('projectDetail.billing.claimForm.quantity', '{{item}} — {{description}} ({{unit}})',
                    { item: line.item_code, description: line.description, unit: line.unit })}
                  value={quantities[line.id] ?? ''}
                  onChange={(value) => setQuantities((current) => ({ ...current, [line.id]: value }))}
                  error={errors[line.id]} localeAware />
              ))}
            </FormGrid>
          )}
          {errors.lines && <FieldError>{errors.lines}</FieldError>}
          {hasDownPayment && (
            <label className="mt-3 flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={recoverRest} onChange={(e) => setRecoverRest(e.target.checked)} />
              {t('projectDetail.billing.claimForm.recoverRest', 'Recover the rest of the down payment with this claim')}
            </label>
          )}
        </FormSection>
      )}
    </EntityFormModal>
  );
};

export default ProgressClaimModal;

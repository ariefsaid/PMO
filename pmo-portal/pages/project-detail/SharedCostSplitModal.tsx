import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, EntityFormModal, FormGrid, TextField, type SubmitError } from '@/src/components/ui';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatExactDecimal } from '@/src/lib/format';
import { useClearSharedSplit, useSetSharedSplit } from '@/src/hooks/useWorkOrderPlanVsActual';
import { splitSum, type PvaWorkOrder, type SplitPercent } from '@/src/lib/workOrderPlanVsActual';

/**
 * #2519 FR-WPVA-022: a project's custom split of its shared cost — one percentage per live work order, up to 4
 * decimals, summing to exactly 100 (the live sum shows as you type; the database refuses anything else). Clearing
 * returns the project to the default split. Admin, Executive and Finance only (the RPC decides).
 */
interface Props {
  projectId: string;
  workOrders: PvaWorkOrder[];
  split: SplitPercent[] | null;
  onClose: () => void;
}

function percentText(units: bigint): string {
  const whole = units / 10000n;
  const frac = String(units % 10000n).padStart(4, '0').replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

const SharedCostSplitModal: React.FC<Props> = ({ projectId, workOrders, split, onClose }) => {
  const { t } = useTranslation('workOrderPva');
  const setSplit = useSetSharedSplit(projectId);
  const clearSplit = useClearSharedSplit(projectId);
  const saved = new Map((split ?? []).map((s) => [s.workOrderId, s.percent]));
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(workOrders.map((w) => [w.id, saved.get(w.id) ?? ''])),
  );
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitError | null>(null);

  const sum = splitSum(workOrders.map((w) => values[w.id] ?? ''));
  const exact = sum === 1000000n;
  const sumText = sum === null
    ? t('split.sumUnreadable', 'Each percentage is 0 to 100, with up to 4 decimals.')
    : t('split.sum', 'Total {{sum}}%', { sum: formatExactDecimal(percentText(sum)) })
      + (exact ? '' : ` · ${t('split.mustBe100', 'must be exactly 100%')}`);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      onClose();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setSubmitError({ headline, detail });
    } finally {
      setBusy(false);
    }
  };

  return (
    <EntityFormModal
      open
      title={t('split.title', 'Shared-cost split')}
      submitLabel={t('split.save', 'Save split')}
      onSubmit={(e) => { e.preventDefault(); if (exact) void run(() => setSplit.mutateAsync(workOrders.map((w) => ({ workOrderId: w.id, percent: values[w.id].trim() })))); }}
      onClose={onClose}
      loading={busy}
      dirty={workOrders.some((w) => (values[w.id] ?? '') !== (saved.get(w.id) ?? ''))}
      submitDisabled={!exact}
      disabledReason={sumText}
      submitError={submitError}
      extraActions={split ? <Button variant="ghost" type="button" disabled={busy} onClick={() => void run(() => clearSplit.mutateAsync())}>{t('split.clear', 'Use the default split')}</Button> : undefined}
    >
      <FormGrid>
        {workOrders.map((w) => (
          <TextField
            key={w.id}
            id={`wo-split-${w.id}`}
            label={t('split.percentFor', '{{number}} (%)', { number: w.woNumber ?? w.title })}
            inputMode="decimal"
            value={values[w.id] ?? ''}
            onChange={(v) => setValues((cur) => ({ ...cur, [w.id]: v }))}
          />
        ))}
      </FormGrid>
      <p role="status" aria-live="polite" className="mt-3 text-sm" data-testid="wo-split-sum">{sumText}</p>
    </EntityFormModal>
  );
};

export default SharedCostSplitModal;

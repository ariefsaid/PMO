import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, ListState, RecordSection, useToast } from '@/src/components/ui';
import { CostAttributionFields } from '@/src/components/workOrders/CostAttributionFields';
import { useAttributionErrorText } from '@/src/components/workOrders/costAttributionError';
import { useProjectWorkOrders } from '@/src/hooks/useWorkOrders';
import { useCostDisciplines } from '@/src/hooks/useWorkOrderCosts';
import { EXPENSE_QUERY_ROOTS } from '@/src/hooks/useExpenseClaims';
import { workOrderCostRepository, type CostAttribution } from '@/src/lib/repositories/workOrderCosts';

interface Props {
  claim: { id: string; kind: string; project_id: string | null; work_order_id: string | null; discipline_id: string | null };
  canEdit: boolean;
}

/** The claim's work order and discipline (#2732): shown on every claim of a project, correctable by a permitted person. */
export const ExpenseAttributionCard: React.FC<Props> = ({ claim, canEdit }) => {
  const { t } = useTranslation('workOrderCost');
  const attributionError = useAttributionErrorText();
  const { toast } = useToast();
  const qc = useQueryClient();
  const workOrders = useProjectWorkOrders(claim.project_id ?? '');
  const disciplines = useCostDisciplines();
  const saved: CostAttribution = { workOrderId: claim.work_order_id, disciplineId: claim.discipline_id };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CostAttribution>(saved);
  useEffect(() => { if (!editing) setDraft({ workOrderId: claim.work_order_id, disciplineId: claim.discipline_id }); }, [editing, claim.work_order_id, claim.discipline_id]);
  const save = useMutation({
    mutationFn: () => workOrderCostRepository.setAttribution('expense_claim', [claim.id], draft),
    onSuccess: () => {
      for (const root of EXPENSE_QUERY_ROOTS) void qc.invalidateQueries({ queryKey: [root] });
      void qc.invalidateQueries({ queryKey: ['work-order-cost-lines'] });
      setEditing(false);
      toast(t('workOrderCost:expenseClaim.saved', 'Work order and discipline saved'), undefined, 'success');
    },
    onError: (err: unknown) => { const d = attributionError(err); toast(d.headline, d.detail, 'warning'); },
  });
  if (claim.kind !== 'claim' || !claim.project_id) return null;

  const wo = (workOrders.isError ? [] : workOrders.data ?? []).find((w) => w.id === claim.work_order_id);
  const disc = (disciplines.isError ? [] : disciplines.data ?? []).find((d) => d.id === claim.discipline_id);
  return (
    <RecordSection
      title={t('workOrderCost:expenseClaim.title', 'Work order and discipline')}
      actions={canEdit && !editing && (
        <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{t('workOrderCost:expenseClaim.edit', 'Change')}</Button>
      )}
    >
      {workOrders.isError && <ListState variant="error" title={t("common:ui.errorBoundary.title", "Something went wrong")} onRetry={() => void workOrders.refetch()} />}
      {disciplines.isError && <ListState variant="error" title={t("common:ui.errorBoundary.title", "Something went wrong")} onRetry={() => void disciplines.refetch()} />}
      {editing ? (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
            <CostAttributionFields idPrefix="expense-attribution" projectId={claim.project_id} value={draft} onChange={setDraft} disabled={save.isPending} />
          </div>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" loading={save.isPending} onClick={() => save.mutate()}>{t('workOrderCost:expenseClaim.save', 'Save')}</Button>
            <Button variant="outline" size="sm" disabled={save.isPending} onClick={() => setEditing(false)}>{t('workOrderCost:expenseClaim.cancel', 'Cancel')}</Button>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('workOrderCost:workOrder', 'Work order')}</dt>
            <dd data-testid="expense-work-order">{claim.work_order_id ? (wo ? wo.wo_number ?? wo.title : workOrders.isError ? '—' : '…') : t('workOrderCost:projectLevel', 'Project level')}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('workOrderCost:discipline', 'Discipline')}</dt>
            <dd data-testid="expense-discipline">{claim.discipline_id ? (disc ? disc.name : disciplines.isError ? '—' : '…') : t('workOrderCost:noDiscipline', 'No discipline')}</dd>
          </div>
        </dl>
      )}
    </RecordSection>
  );
};

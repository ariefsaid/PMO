import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/src/components/ui/Button';
import { ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { useExport } from '@/src/components/export/useExport';
import { useBillingReconciliation } from '@/src/hooks/useBillingStages';
import { deriveWorkOrderMissing, toMissingExport, type MissingRow, type MissingScopeLine, type MissingStep } from '@/src/lib/workOrderMissing';
import { formatNumberExact } from '@/src/lib/format';

/**
 * "Still missing" (gap-billing, docs/specs/work-order-missing-list.spec.md): ONE advisory list derived from the work order's step
 * list (the `steps` seam), the scope progress and the billing reconciliation. Nothing is stored and no row refuses anything.
 * The step source is not wired yet: until a caller passes `steps`, the list shows the quantity rows only.
 */
export interface MissingSectionProps {
  actions?: React.ReactNode;
  projectId: string;
  workOrderId: string;
  status: string;
  /** Scope lines already derived by the page; null while they load. */
  scopeLines: MissingScopeLine[] | null;
  scopeError?: boolean;
  /** The work order's steps from whichever source supplies them; absent = none supplied. */
  steps?: MissingStep[];
  stepsLoading?: boolean;
  stepsError?: boolean;
  onRetrySteps?: () => void;
  /** Reconciliation is a billing read; a caller who may not see billing gets no quantity rows. */
  canBilling: boolean;
}

export const MissingSection: React.FC<MissingSectionProps> = ({ actions, projectId, workOrderId, status, scopeLines, scopeError = false, steps = [], stepsLoading = false, stepsError = false, onRetrySteps, canBilling }) => {
  const { t } = useTranslation('workOrders');
  const { exportTable, busy } = useExport();
  const live = status !== 'Closed' && status !== 'Cancelled';
  const recon = useBillingReconciliation(live && canBilling ? projectId : '', workOrderId);

  const rows = useMemo(() => deriveWorkOrderMissing({
    steps,
    scopeLines: scopeLines ?? [],
    reconciliation: (canBilling ? recon.data : undefined) ?? [],
    status,
  }), [steps, scopeLines, recon.data, status, canBilling]);

  const title = t('missing.title', 'Still missing');
  const isPending = live && (stepsLoading || scopeLines === null || (canBilling && recon.isLoading));
  const isError = stepsError || scopeError || (canBilling && recon.isError);
  const retry = () => { onRetrySteps?.(); void recon.refetch(); };

  const whoText = (r: MissingRow) => (r.who.key === 'role' ? t('missing.who.role', '{{role}}', { role: r.who.role })
    : r.who.key === 'finance' ? t('missing.who.finance', 'Finance or an Admin') : t('missing.who.team', 'The project team'));
  const reasonText = (r: MissingRow) => {
    const p = { ...r.reasonParams, quantity: typeof r.reasonParams.quantity === 'number' ? formatNumberExact(r.reasonParams.quantity) : '' };
    switch (r.reasonKey) {
      case 'stepOpen': return t('missing.reason.stepOpen', 'This step is not done yet.');
      case 'stepAttachment': return t('missing.reason.stepAttachment', 'Nothing is attached yet for step "{{step}}".', p);
      case 'quantityAccept': return t('missing.reason.quantityAccept', '{{quantity}} {{unit}} reported but not yet accepted. Record the acceptance.', p);
      default: return t('missing.reason.quantityClaim', '{{quantity}} {{unit}} accepted but not yet claimed.', p);
    }
  };
  const kindText = (r: MissingRow) => t(`missing.kind.${r.kind}`, ({
    step: 'Step', 'step-attachment': 'Step attachment', 'quantity-accept': 'Quantity to accept', 'quantity-claim': 'Quantity to claim',
  } as const)[r.kind]);

  const doExport = () => {
    void exportTable(toMissingExport(rows, {
      header: [t('missing.col.item', 'Item'), t('missing.col.kind', 'Kind'), t('missing.col.reason', 'Why'), t('missing.col.who', 'Who adds it')],
      describe: (r) => ({ kind: kindText(r), reason: reasonText(r), who: whoText(r) }),
    }), t('missing.fileStem', 'Missing'), 'csv');
  };

  if (!live) {
    return <RecordSection title={title} actions={actions}>
      <p className="text-control text-muted-foreground" data-testid="missing-closed">{t('missing.closed', 'This work order is closed or cancelled, so nothing is waiting on it.')}</p>
    </RecordSection>;
  }
  return (
    <RecordSection title={title}
      actions={<>{actions}{rows.length > 0 && !isPending && !isError
        ? <Button variant="outline" size="sm" disabled={busy} onClick={doExport}>{t('missing.export', 'Export CSV')}</Button> : null}</>}>
      {isPending && <ListState variant="loading" rows={2} />}
      {!isPending && isError && <ListState variant="error" title={t('missing.error', "Couldn't load what this work order still lacks")} onRetry={retry} />}
      {!isPending && !isError && rows.length === 0 && (
        <p className="text-control text-muted-foreground" data-testid="missing-empty">{canBilling && recon.data && recon.data.every((line) => line.progressQty !== null && line.progressQty === 0) && !(scopeLines ?? []).some((line) => line.accepted > 0) ? t('missing.noProgress', 'No work quantities have been reported yet.') : t('missing.empty', 'Nothing is missing: no open steps, and every reported quantity is accepted and claimed.')}</p>
      )}
      {!isPending && !isError && rows.length > 0 && (
        <ul className="divide-y divide-border" data-testid="missing-list" aria-label={title}>
          {rows.map((r) => (
            <li key={r.id} className="flex flex-col gap-1 py-3" data-testid={`missing-${r.kind}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{r.name}</span>
                <StatusPill variant="neutral" wrap={false}>{kindText(r)}</StatusPill>
              </div>
              <p className="text-control text-muted-foreground">{reasonText(r)}</p>
              <p className="text-control">{t('missing.whoAdds', 'Who adds it: {{who}}', { who: whoText(r) })}</p>
            </li>
          ))}
        </ul>
      )}
    </RecordSection>
  );
};

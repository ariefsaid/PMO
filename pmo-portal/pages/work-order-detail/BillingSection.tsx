import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { formatCurrency, formatDay, formatNumberExact } from '@/src/lib/format';
import type { WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';

interface Props {
  /** null = the caller may not see billing (section hidden); undefined row = no figures for this work order. */
  billing: { row: WorkOrderBillingRow | null; isPending: boolean; isError: boolean; onRetry: () => void } | null;
  acceptances: WorkOrderAcceptanceWithLines[] | null;
  acceptancesPending: boolean;
  acceptancesError: boolean;
  onRetryAcceptances: () => void;
  /** The confirm control on a waiting acceptance (the viewer's role decides `canConfirm`; the database is the authority). */
  confirm?: { canConfirm: (a: WorkOrderAcceptanceWithLines) => boolean; onConfirm: (a: WorkOrderAcceptanceWithLines) => void };
}

/** Billing and acceptances (FR-WORP-023): the shipped `work_order_billing` figures and the BAST list — no second formula. */
export const BillingSection: React.FC<Props> = ({ billing, acceptances, acceptancesPending, acceptancesError, onRetryAcceptances, confirm }) => {
  const { t } = useTranslation('workOrders');
  const title = t('billing.title', 'Billing and acceptances');
  const row = billing?.row ?? null;
  const fig = (k: string, label: string, v: number) => (
    <div key={k} data-testid={`billing-${k}`}><dt className="text-control text-muted-foreground">{label}</dt>
      <dd className="tabular-nums font-medium">{formatCurrency(v, row!.currency)}</dd></div>
  );
  return (
    <RecordSection title={title}>
      <div className="flex flex-col gap-4">
        {billing && billing.isPending && <ListState variant="loading" rows={1} />}
        {billing && billing.isError && <ListState variant="error" title={t('billing.error', "Couldn't load the billing figures")} onRetry={billing.onRetry} />}
        {billing && !billing.isPending && !billing.isError && !row && <p className="text-control text-muted-foreground">{t('billing.noFigures', 'No billing figures for this work order yet.')}</p>}
        {row && (
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {fig('invoiced', t('billing.invoiced', 'Invoiced'), row.invoiced)}
            {fig('pending', t('billing.pending', 'Pending'), row.pending)}
            {fig('paid', t('billing.paid', 'Paid'), row.paid)}
            {fig('remaining', t('billing.remaining', 'Remaining'), row.remaining)}
            {!row.figuresComplete && <p className="col-span-full text-control text-muted-foreground">{t('billing.incomplete', 'Some invoices could not be totalled, so these figures are incomplete.')}</p>}
          </dl>
        )}
        <div>
          <h3 className="mb-3 font-medium">{t('billing.acceptances', 'Acceptances')}</h3>
          {acceptancesPending && <ListState variant="loading" rows={1} />}
          {acceptancesError && <ListState variant="error" title={t('billing.acceptancesError', "Couldn't load the acceptances")} onRetry={onRetryAcceptances} />}
          {!acceptancesPending && !acceptancesError && acceptances && acceptances.length === 0 && <p className="text-control text-muted-foreground">{t('billing.noAcceptances', 'No acceptances yet.')}</p>}
          {acceptances && acceptances.length > 0 && (
            <ul className="divide-y divide-border" data-testid="acceptance-list">
              {acceptances.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5" data-testid={`acceptance-${a.id}`}>
                  <span className="tabular-nums">{formatDay(a.acceptance_date)}</span>
                  <span className="flex items-center gap-2">
                    <span className="text-control text-muted-foreground">{a.is_final ? t('billing.final', 'Final') : t('billing.stage', 'Stage')} · {formatNumberExact(a.lines.length)} {t('billing.lines', 'lines')}</span>
                    <StatusPill variant="neutral">{a.status === 'Confirmed' ? t('billing.confirmed', 'Confirmed') : a.status === 'Draft' ? t('billing.draft', 'Waiting for Finance or an Admin to confirm') : a.status}</StatusPill>
                    {confirm?.canConfirm(a) && (
                      <Button variant="primary" size="sm" onClick={() => confirm.onConfirm(a)}>{t('billing.confirmAction', 'Confirm BAST')}</Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </RecordSection>
  );
};

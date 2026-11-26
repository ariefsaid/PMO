import { useAreaHelp } from './useAreaHelp';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Button, ListState, RecordSection, StatusPill } from '@/src/components/ui';
import { formatDay, formatTableMoney, formatMonthYearShort, formatNumberExact } from '@/src/lib/format';
import type { WorkOrderBilledMonths, WorkOrderBillingRow } from '@/src/lib/db/workOrderBilling';
import type { WorkOrderAcceptanceWithLines } from '@/src/lib/db/workOrderAcceptances';

interface Props {
  /** Walk BQ3/BQ13: claims, terms and reconciliation live on the project's Contract tab; this opens it on this work order. */
  contractHref?: string | null;
  /** null = the caller may not see billing (section hidden); undefined row = no figures for this work order. */
  billing: { row: WorkOrderBillingRow | null; isPending: boolean; isError: boolean; onRetry: () => void } | null;
  /** Billed per month: null = the caller may not see billing (no block, no read). */
  perMonth?: { months: WorkOrderBilledMonths | undefined; isPending: boolean; isError: boolean; onRetry: () => void } | null;
  acceptances: WorkOrderAcceptanceWithLines[] | null;
  acceptancesPending: boolean;
  acceptancesError: boolean;
  onRetryAcceptances: () => void;
  /** The confirm control on a waiting acceptance (the viewer's role decides `canConfirm`; the database is the authority). */
  confirm?: { canConfirm: (a: WorkOrderAcceptanceWithLines) => boolean; onConfirm: (a: WorkOrderAcceptanceWithLines) => void };
}

/** Billing and acceptances (FR-WORP-023): the shipped `work_order_billing` figures and the BAST list — no second formula. */
export const BillingSection: React.FC<Props> = ({ contractHref = null, billing, perMonth = null, acceptances, acceptancesPending, acceptancesError, onRetryAcceptances, confirm }) => {
  const { t } = useTranslation('workOrders');
  useAreaHelp('invoice-basis', t('billing.invoicesTitle', 'Invoices'), t('billing.perMonth.basis', 'Counts submitted invoices only, excluding tax, in the work order currency. Drafts and claims not yet invoiced are not in these figures.'));
  const title = t('billing.invoicesTitle', 'Invoices');
  const row = billing?.row ?? null;
  const pm = perMonth?.months;
  const monthsNewestFirst = pm ? [...pm.months].reverse() : [];
  const fig = (k: string, label: string, v: number) => (
    <div key={k} data-testid={`billing-${k}`}><dt className="text-control text-muted-foreground">{label}</dt>
      <dd className="text-metric tabular-nums font-semibold">{formatTableMoney(v, row!.currency) ?? '—'}</dd></div>
  );
  const link = contractHref
    ? <Link to={contractHref} className="text-control font-medium text-primary-text hover:underline" data-testid="wo-billing-contract-link">{t('billing.openContract', 'Claims and invoices')}</Link>
    : undefined;
  // Three questions, three panels: what has been invoiced, what was accepted (and waits to be confirmed), what was billed when.
  return (
    <>
      {billing && (
        <RecordSection title={title} actions={link}>
          {billing.isPending && <ListState variant="loading" rows={1} />}
          {billing.isError && <ListState variant="error" title={t('billing.error', "Couldn't load the billing figures")} onRetry={billing.onRetry} />}
          {!billing.isPending && !billing.isError && !row && <p className="text-control text-muted-foreground">{t('billing.noFigures', 'No billing figures for this work order yet.')}</p>}
          {row && (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
              {fig('invoiced', t('billing.invoiced', 'Invoiced'), row.invoiced)}
              {fig('pending', t('billing.pending', 'Pending'), row.pending)}
              {fig('paid', t('billing.paid', 'Paid'), row.paid)}
              {fig('remaining', t('billing.remaining', 'Remaining'), row.remaining)}
              {!row.figuresComplete && <p className="col-span-full text-control text-muted-foreground">{t('billing.incomplete', 'Some invoices could not be totalled, so these figures are incomplete.')}</p>}
            </dl>
          )}
        </RecordSection>
      )}
      <RecordSection title={t('billing.acceptances', 'Acceptances')} actions={billing ? undefined : link}>
        {acceptancesPending && <ListState variant="loading" rows={1} />}
        {acceptancesError && <ListState variant="error" title={t('billing.acceptancesError', "Couldn't load the acceptances")} onRetry={onRetryAcceptances} />}
        {!acceptancesPending && !acceptancesError && acceptances && acceptances.length === 0 && <p className="text-control text-muted-foreground">{t('billing.noAcceptances', 'No acceptances yet.')}</p>}
        {acceptances && acceptances.length > 0 && (
          <ul className="divide-y divide-border" data-testid="acceptance-list">
            {acceptances.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 first:pt-0 last:pb-0" data-testid={`acceptance-${a.id}`}>
                <span className="tabular-nums">{formatDay(a.acceptance_date)}</span>
                <span className="flex flex-wrap items-center gap-2">
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
      </RecordSection>
      {perMonth && (
        <RecordSection title={t('billing.perMonth.title', 'Billed per month')} data-testid="billed-per-month-block">
          {perMonth.isPending && <ListState variant="loading" rows={1} />}
          {perMonth.isError && <ListState variant="error" title={t('billing.perMonth.error', "Couldn't load the billed months")} onRetry={perMonth.onRetry} />}
          {pm && !perMonth.isError && (
            <>
              {pm.incomplete && <p className="text-control text-muted-foreground" data-testid="billed-per-month-incomplete">{t('billing.perMonth.incomplete', "Some invoices could not be totalled in this work order's currency, so no monthly figures are shown.")}</p>}
              {!pm.incomplete && pm.months.length === 0 && <p className="text-control text-muted-foreground">{t('billing.perMonth.empty', 'No submitted invoice yet.')}</p>}
              {!pm.incomplete && pm.months.length > 0 && (
                <ul className="divide-y divide-border" data-testid="billed-per-month">
                  {monthsNewestFirst.map((m) => (
                    <li key={m.month} className="flex items-baseline justify-between gap-2 py-2 first:pt-0" data-testid={`billed-month-${m.month.slice(0, 7)}`}>
                      <span>
                        {formatMonthYearShort(m.month)}
                        {m.toDate && <span className="ml-2 text-control text-muted-foreground">{t('billing.perMonth.toDate', 'to date')}</span>}
                      </span>
                      <span className="tabular-nums">{formatTableMoney(m.billed, pm.currency) ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {!pm.incomplete && pm.months.length > 0 && (
                <div className="flex items-baseline justify-between gap-2 border-t border-border pt-2 font-medium" data-testid="billed-per-month-total">
                  <span>{t('billing.perMonth.total', 'Total billed')}</span>
                  <span className="tabular-nums">{formatTableMoney(pm.total, pm.currency) ?? '—'}</span>
                </div>
              )}
            </>
          )}
        </RecordSection>
      )}
    </>
  );
};

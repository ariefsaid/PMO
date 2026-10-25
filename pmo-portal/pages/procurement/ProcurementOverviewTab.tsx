import React from 'react';
import { useTranslation } from 'react-i18next';
import { DecisionSupportPanel } from './DecisionSupportPanel';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { formatCurrency } from '@/src/lib/format';

interface AmountFact {
  amount: number;
  currency: string;
}

export interface ProcurementReviewItem {
  id: string;
  name: string;
  quantity: number;
  rate: number;
  amount: number | null;
}

export interface ProcurementOverviewTabProps {
  requestAmount: number;
  requestCurrency: string;
  selectedQuote: AmountFact | null;
  orderedAmount: AmountFact | null;
  items: ProcurementReviewItem[];
  projectId: string | null | undefined;
  projectName: string | null | undefined;
  projectLegalName?: string | null;
  totalValue: number;
  status: ProcurementStatus;
  currency: string;
}

export const ProcurementOverviewTab: React.FC<ProcurementOverviewTabProps> = ({
  requestAmount,
  requestCurrency,
  selectedQuote,
  orderedAmount,
  items,
  projectId,
  projectName,
  projectLegalName,
  totalValue,
  status,
  currency,
}) => {
  const { t } = useTranslation();
  const amounts: Array<{ label: string; fact: AmountFact }> = [
    { label: t('procurementDetail.review.requestAmount', 'Requested amount'), fact: { amount: requestAmount, currency: requestCurrency } },
    ...(selectedQuote ? [{ label: t('procurementDetail.review.selectedQuote', 'Selected quote amount'), fact: selectedQuote }] : []),
    ...(orderedAmount ? [{ label: t('procurementDetail.review.orderedAmount', 'Ordered amount'), fact: orderedAmount }] : []),
  ];

  return (
    <div className="min-w-0 space-y-6">
      <section aria-labelledby="procurement-review-amounts">
        <h2 id="procurement-review-amounts" className="mb-3 text-lg font-semibold">
          {t('procurementDetail.review.amounts', 'Purchase amounts')}
        </h2>
        <dl className="grid min-w-0 grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
          {amounts.map(({ label, fact }) => (
            <div key={label} className="min-w-0">
              <dt className="text-sm text-muted-foreground">{label}</dt>
              <dd className="mt-1 break-words text-base font-semibold tabular-nums">
                {formatCurrency(fact.amount, fact.currency)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <DecisionSupportPanel
        projectId={projectId}
        totalValue={totalValue}
        projectName={projectName ?? null}
        projectLegalName={projectLegalName}
        status={status}
        currency={currency}
        showRequestValue={false}
        showProjectName={false}
      />

      <section aria-labelledby="procurement-review-items">
        <h2 id="procurement-review-items" className="mb-3 text-lg font-semibold">
          {t('procurementDetail.review.items', 'Requested items')}
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('procurementDetail.review.noItems', 'No items have been recorded on this request yet.')}
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {items.map((item) => (
              <li key={item.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{item.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.quantity} × {formatCurrency(item.rate, currency)}
                  </p>
                </div>
                <p className="shrink-0 text-right font-medium tabular-nums">
                  {item.amount === null
                    ? t('procurementDetail.review.amountUnavailable', 'Not available')
                    : formatCurrency(item.amount, currency)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

ProcurementOverviewTab.displayName = 'ProcurementOverviewTab';

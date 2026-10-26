import React from 'react';
import { useTranslation } from 'react-i18next';
import { DecisionSupportPanel } from './DecisionSupportPanel';
import type { ProcurementStatus } from '@/src/lib/db/procurementLifecycle';
import { formatNumber, formatShortMoney } from '@/src/lib/format';

interface AmountFact {
  amount: number | null;
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
    { label: t('procurement:detail.review.requestAmount', 'Requested amount'), fact: { amount: requestAmount, currency: requestCurrency } },
    ...(selectedQuote ? [{ label: t('procurement:detail.review.selectedQuote', 'Selected quote amount'), fact: selectedQuote }] : []),
    ...(orderedAmount ? [{ label: t('procurement:detail.review.orderedAmount', 'Ordered amount'), fact: orderedAmount }] : []),
  ];
  const amountGroups = new Map<string, typeof amounts>();
  for (const amount of amounts) {
    const group = amountGroups.get(amount.fact.currency);
    if (group) group.push(amount);
    else amountGroups.set(amount.fact.currency, [amount]);
  }

  return (
    <div className="min-w-0 space-y-8 pt-8">
      {[...amountGroups].map(([groupCurrency, facts]) => (
        <section key={groupCurrency} aria-labelledby={`procurement-review-amounts-${groupCurrency}`}>
          <h2 id={`procurement-review-amounts-${groupCurrency}`} className="mb-4 break-words text-xl font-bold">
            {groupCurrency === requestCurrency
              ? t('procurement:detail.review.amountsWithPrimary', 'Purchase amount · {{compact}}', { compact: formatShortMoney(requestAmount, requestCurrency, { code: true }) })
              : t('procurement:detail.review.otherAmountsWithCurrency', 'Other purchase amounts · {{currency}}', { currency: groupCurrency })}
          </h2>
          <dl className="grid min-w-0 grid-cols-2 gap-x-8 gap-y-4 lg:grid-cols-3">
            {facts.map(({ label, fact }) => {
              return (
                <div key={label} className="min-w-0">
                  <dt className="break-words text-xs font-semibold text-muted-foreground">{label}</dt>
                  <dd className="mt-2 break-words text-sm font-normal tabular-nums">
                    {fact.amount === null
                      ? t('procurement:detail.review.amountUnavailable', 'Not available')
                      : formatNumber(fact.amount)}
                  </dd>
                </div>
              );
            })}
          </dl>
        </section>
      ))}

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
        <h2 id="procurement-review-items" className="mb-4 break-words text-xl font-bold">
          {t('procurement:detail.review.itemsWithCurrency', 'Requested items · {{currency}}', { currency })}
        </h2>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('procurement:detail.review.noItems', 'No items have been recorded on this request yet.')}
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {items.map((item) => (
              <li key={item.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3">
                <div className="min-w-0 flex-1">
                  <p className="break-words text-sm">{item.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {item.quantity} × {formatNumber(item.rate)}
                  </p>
                </div>
                <p className="shrink-0 text-right text-sm font-normal tabular-nums">
                  {item.amount === null
                    ? t('procurement:detail.review.amountUnavailable', 'Not available')
                    : formatNumber(item.amount)}
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

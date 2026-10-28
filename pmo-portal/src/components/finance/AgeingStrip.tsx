import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/src/lib/format';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { Tooltip } from '@/src/components/ui/Tooltip';
import { Icon } from '@/src/components/ui/icons';
import type { AgeingBuckets, PayablesAgeingBuckets } from '@/src/lib/finance/financePosition';

type AgeingKind = 'receivables' | 'payables';
type AgeingValues = Record<string, AgeingBuckets | PayablesAgeingBuckets>;
type BucketKey = keyof AgeingBuckets | keyof PayablesAgeingBuckets;

export interface AgeingStripProps {
  kind: AgeingKind;
  values: AgeingValues;
}

const RECEIVABLE_BUCKETS = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const;
const PAYABLE_BUCKETS = ['d0_30', 'd31_60', 'd61_90', 'over90'] as const;

const BUCKET_COLORS: Record<BucketKey, string> = {
  notDue: 'bg-muted-foreground/35',
  d0_30: 'bg-muted-foreground/35',
  d1_30: 'bg-warning/55',
  d31_60: 'bg-warning',
  d61_90: 'bg-destructive/70',
  over90: 'bg-destructive',
};

export const AgeingStrip: React.FC<AgeingStripProps> = ({ kind, values }) => {
  const { t } = useTranslation();
  const { currency: orgCurrency, isResolved } = useOrgCurrencyState();
  const bucketKeys: readonly BucketKey[] = kind === 'receivables' ? RECEIVABLE_BUCKETS : PAYABLE_BUCKETS;
  const labels: Record<BucketKey, string> = {
    notDue: t('finance:area.notDue', 'Not yet due'),
    d0_30: t('finance:area.days0to30', '0–30 days'),
    d1_30: t('finance:area.days1to30', '1–30 days'),
    d31_60: t('finance:area.days31to60', '31–60 days'),
    d61_90: t('finance:area.days61to90', '61–90 days'),
    over90: t('finance:area.over90Days', 'Over 90 days'),
  };
  const title = kind === 'receivables'
    ? t('finance:area.receivablesAgeingTitle', 'Client balances by age · tax included')
    : t('finance:area.payablesAgeingTitle', 'Supplier invoices by age · since invoice date');
  const hint = kind === 'receivables'
    ? t('financeHub:hub.receivableBucketHint', 'Known outstanding balances grouped by days past due. Not yet due includes balances due today or later.')
    : t('financeHub:hub.payableBucketHint', 'Known unpaid supplier balances grouped by calendar days since the invoice was recorded.');
  const currencies = Object.entries(values).sort(([left], [right]) => {
    if (isResolved && left === orgCurrency) return -1;
    if (isResolved && right === orgCurrency) return 1;
    return 0;
  });

  const amountFor = (buckets: AgeingBuckets | PayablesAgeingBuckets, key: BucketKey): number =>
    kind === 'receivables'
      ? (buckets as AgeingBuckets)[key as keyof AgeingBuckets] ?? 0
      : (buckets as PayablesAgeingBuckets)[key as keyof PayablesAgeingBuckets] ?? 0;

  return (
    <section aria-label={title} className="mb-5 min-w-0">
      <h2 className="mb-2 flex items-center gap-1 text-[14px] font-semibold">
        <span>{title}</span>
        <Tooltip content={hint}>
          <button
            type="button"
            aria-label={t('financeHub:hub.bucketHelp', 'How this age balance is calculated')}
            className="touch-target inline-flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          ><Icon name="help" className="size-3.5" /></button>
        </Tooltip>
      </h2>
      {currencies.map(([currency, buckets]) => {
        const amounts = bucketKeys.map((key) => amountFor(buckets, key));
        const total = amounts.reduce((sum, amount) => sum + Math.max(amount, 0), 0);
        return (
          <div key={currency} className="mb-4 min-w-0 last:mb-0">
            <div className="mb-1 text-xs font-medium text-muted-foreground">{currency}</div>
            <div
              role="img"
              aria-label={t('financeHub:hub.fix.ageingBarLabel', '{{currency}} balance distribution by age', { currency })}
              data-testid={`ageing-bar-${currency}`}
              className="flex h-[10px] overflow-hidden rounded-full bg-secondary"
            >
              {bucketKeys.map((key, index) => {
                const amount = Math.max(amounts[index] ?? 0, 0);
                const share = total > 0 ? (amount / total) * 100 : 0;
                return (
                  <span
                    key={key}
                    data-bucket={key}
                    aria-hidden="true"
                    className={`h-full shrink-0 ${BUCKET_COLORS[key]}`}
                    style={{ width: `${share}%` }}
                  />
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-x-3 gap-y-2">
              {bucketKeys.map((key, index) => (
                <div key={key} className="grid min-w-0 grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-x-2">
                  <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${BUCKET_COLORS[key]}`} />
                  <span className="min-w-0 break-words text-xs text-muted-foreground">{labels[key]}</span>
                  <span className="max-w-full break-all text-right tabular text-sm font-semibold">{formatCurrency((amounts[index] ?? 0) / 100, currency)}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
};

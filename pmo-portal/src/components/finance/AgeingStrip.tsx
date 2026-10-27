import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrencyCents } from '@/src/lib/format';
import type { AgeingBuckets, PayablesAgeingBuckets } from '@/src/lib/finance/financePosition';

type AgeingKind = 'receivables' | 'payables';
type AgeingValues = Record<string, AgeingBuckets | PayablesAgeingBuckets>;

export interface AgeingStripProps {
  kind: AgeingKind;
  values: AgeingValues;
}

export const AgeingStrip: React.FC<AgeingStripProps> = ({ kind, values }) => {
  const { t } = useTranslation();
  const bucketKeys = kind === 'receivables'
    ? ['notDue', 'd1_30', 'd31_60', 'd61_90', 'over90'] as const
    : ['d0_30', 'd31_60', 'd61_90', 'over90'] as const;
  const labels: Record<string, string> = {
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

  return (
    <section aria-label={title} className="mb-5">
      <h2 className="mb-2 text-[14px] font-semibold">{title}</h2>
      {Object.entries(values).map(([currency, buckets]) => (
        <div key={currency} className="mb-3 min-w-0">
          <div className="mb-1 text-xs font-medium text-muted-foreground">{currency}</div>
          <div className="grid grid-cols-2 sm:grid-cols-5">
            {bucketKeys.map((key, index) => (
              <div key={key} className={`min-w-0 py-1.5 ${index > 0 ? 'border-l border-border pl-3' : ''}`}>
                <div className="text-xs text-muted-foreground">{labels[key]}</div>
                <div className="tabular text-[16px] font-semibold">{formatCurrencyCents(buckets[key] ?? 0, currency)}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
};

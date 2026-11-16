import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatTableMoney } from '@/src/lib/format';
import { claimNet } from '@/src/lib/progressBilling';

/** The money a claim's invoice will carry, as aligned figures: what the client is about to be billed. */
export const ClaimRaiseFigures: React.FC<{ gross: number | string; recovery: number | string; currency: string }> = ({ gross, recovery, currency }) => {
  const { t } = useTranslation('project');
  const rows = [
    { label: t('projectDetail.billing.claims.column.claimedLabel', 'Claimed'), value: Number(gross) },
    { label: t('projectDetail.billing.claims.column.recoveryLong', 'Down payment recovered'), value: Number(recovery) },
  ];
  return (
    <dl data-testid="raise-figures" className="rounded-md border border-border text-sm">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 px-3 py-2">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="tabular-nums text-foreground">{formatTableMoney(row.value, currency)}</dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-4 border-t border-border px-3 py-2.5">
        <dt className="font-medium text-foreground">{t('projectDetail.billing.claims.confirmRaise.netExclTax', 'Net (excl. PPN)')}</dt>
        <dd className="text-group font-semibold tabular-nums text-foreground">{formatTableMoney(claimNet(Number(gross), Number(recovery)), currency)}</dd>
      </div>
    </dl>
  );
};

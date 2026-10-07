/**
 * #876 (DD-VWH-6, FR-VWH-007) — the labelled withholding figures under a vendor invoice's amount: VAT, the tax
 * withheld (PPh — owed to the tax office, not the vendor) and the net payable to the vendor. Display only; the figures
 * come from `withholdingFigures` (integer cents) and the currency is the bill's own.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/src/lib/format';
import type { WithholdingFigures } from '@/src/lib/vendorWithholding';
import { VI_WITHHOLDING_TEST_IDS } from './vendorInvoiceTestIds';

export const WithholdingBreakdown: React.FC<{ figures: WithholdingFigures; currency: string }> = ({ figures, currency }) => {
  const { t } = useTranslation();
  return (
    <dl
      data-testid={VI_WITHHOLDING_TEST_IDS.breakdown}
      className="grid grid-cols-[auto_auto] justify-end gap-x-2 text-right text-[12px] text-muted-foreground"
    >
      <dt>{t('procurementDetail.withholding.vat', 'VAT')}</dt>
      <dd className="tabular-nums" data-testid={VI_WITHHOLDING_TEST_IDS.vat}>{formatCurrency(figures.vat, currency)}</dd>
      <dt>{t('procurementDetail.withholding.withheld', 'Tax withheld (PPh)')}</dt>
      <dd className="tabular-nums" data-testid={VI_WITHHOLDING_TEST_IDS.withheld}>{formatCurrency(figures.withheld, currency)}</dd>
      <dt className="font-semibold text-foreground">{t('procurementDetail.withholding.netPayable', 'Net payable')}</dt>
      <dd className="tabular-nums font-semibold text-foreground" data-testid={VI_WITHHOLDING_TEST_IDS.net}>
        {formatCurrency(figures.netPayable, currency)}
      </dd>
    </dl>
  );
};

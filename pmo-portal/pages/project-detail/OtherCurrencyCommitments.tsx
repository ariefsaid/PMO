import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency } from '@/src/lib/format';
import type { CommittedOtherCurrencies } from '@/src/hooks/useProcurements';

/**
 * A short note beside a project-currency committed figure: the project also has commitments in other currencies.
 * Each is shown in its own currency; none is converted or added to the project-currency figure (0373). Renders nothing
 * when every commitment is in the project currency.
 */
export function OtherCurrencyCommitments({ positions }: { positions: CommittedOtherCurrencies | undefined }) {
  const { t } = useTranslation();
  if (!positions || positions.length === 0) return null;
  const amounts = positions.map((position) => formatCurrency(position.amount, position.currency)).join(', ');
  return (
    <span className="block text-xs text-muted-foreground" data-testid="committed-other-currencies">
      {t('uxs01.otherCurrencies', 'Plus amounts in other currencies: {{amounts}}', { amounts })}
    </span>
  );
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatProjectDetailMoney } from './formatProjectDetailMoney';
import type { CommittedOtherCurrencies } from '@/src/hooks/useProcurements';

/**
 * A short note beside a project-currency committed figure: the project also has commitments in other currencies.
 * Each is shown in its own currency; none is converted or added to the project-currency figure (0373). Renders nothing
 * when every commitment is in the project currency.
 */
export function OtherCurrencyCommitments({ positions }: { positions: CommittedOtherCurrencies | undefined }) {
  const { t, i18n } = useTranslation();
  if (!positions || positions.length === 0) return null;
  const amounts = positions.map((position) => formatProjectDetailMoney(position.amount, position.currency, i18n.language, true)).join(', ');
  return (
    <span className="block text-xs text-muted-foreground" data-testid="committed-other-currencies">
      {t('projects:committed.otherCurrencies', 'Plus amounts in other currencies: {{amounts}}', { amounts })}
    </span>
  );
}

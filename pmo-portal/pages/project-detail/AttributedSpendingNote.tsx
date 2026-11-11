import React from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { attributedSplit, formatExactMoney } from '@/src/lib/projectFinances';

/** A compact, project-wide context note; the Forecast figures below remain fiscal-year scoped. */
export function AttributedSpendingNote({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const { data } = useProjectFinances(projectId);
  const actuals = data?.actuals;
  const split = actuals?.currency ? attributedSplit({ attributed: actuals.attributed_total }) : null;
  const amount = split && actuals?.currency ? formatExactMoney(split.attributed, actuals.currency, i18n.language, { wholeUnits: true }) : null;
  if (!amount) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="budget-attributed-note">
      {t('costAttribution:split.budget', 'Across all years, {{attributed}} of recorded spending is attributed by cost rules, not tagged to this project in the ERP.', { attributed: amount })}
    </p>
  );
}

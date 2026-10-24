import React from 'react';
import { useTranslation } from 'react-i18next';
import { useProjectFinances } from '@/src/hooks/useProjectFinances';
import { attributedSplit, formatExactMoney } from '@/src/lib/projectFinances';

/**
 * #1271 AC-3, budget vs actual: one secondary line naming the part of the project's recorded spending that cost
 * attribution rules placed here, apart from cost tagged to the project in the ERP. The forecast table below is per
 * fiscal year; this figure is project-wide (`get_project_finances`), so it is worded that way. Renders nothing when
 * there is no attributed cost, so a project without rules is unchanged.
 */
export function AttributedSpendingNote({ projectId }: { projectId: string }) {
  const { t, i18n } = useTranslation();
  const { data } = useProjectFinances(projectId);
  const actuals = data?.actuals;
  const split = actuals?.currency ? attributedSplit({ attributed: actuals.attributed_total }) : null;
  const amount = split && actuals?.currency ? formatExactMoney(split.attributed, actuals.currency, i18n.language) : null;
  if (!amount) return null;
  return (
    <p className="text-[12px] text-muted-foreground" data-testid="budget-attributed-note">
      {t('costAttribution:split.budget', 'Across all years, {{attributed}} of recorded spending is attributed by cost rules, not tagged to this project in the ERP.', { attributed: amount })}
    </p>
  );
}

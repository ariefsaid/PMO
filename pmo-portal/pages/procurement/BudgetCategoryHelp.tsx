import React from 'react';
import { useTranslation } from 'react-i18next';
import { HelpPopover } from '@/src/components/ui';
import { useIsDesktop } from '@/src/components/ui/useIsDesktop';
import { BUDGET_CATEGORY_HELPER } from './budgetCategoryOptions';

export const BudgetCategoryHelp: React.FC = () => {
  const { t } = useTranslation('procurementCreate');
  const side = useIsDesktop() ? 'left' : 'top';

  return (
    <span className="inline-flex items-center gap-1">
      {t('budgetCategoryHelp', 'Decides who approves')}
      <HelpPopover side={side} subject={t('budgetCategoryHelpSubject', 'who approves')}>
        {t('budgetCategoryHelpFull', BUDGET_CATEGORY_HELPER)}
      </HelpPopover>
    </span>
  );
};

import React from 'react';
import { useTranslation } from 'react-i18next';
import { HelpPopover } from '@/src/components/ui';
import { BUDGET_CATEGORY_HELPER } from './budgetCategoryOptions';

export const BudgetCategoryHelp: React.FC = () => {
  const { t } = useTranslation('procurementCreate');

  return (
    <span className="inline-flex items-center gap-1">
      {t('budgetCategoryHelp', 'Decides who approves')}
      <HelpPopover subject={t('budgetCategoryHelpSubject', 'who approves')}>
        {t('budgetCategoryHelpFull', BUDGET_CATEGORY_HELPER)}
      </HelpPopover>
    </span>
  );
};

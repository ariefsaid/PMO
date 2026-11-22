import React from 'react';
import { useTranslation } from 'react-i18next';
import { OrgSwitchSetting } from '@/src/components/admin/OrgSwitchSetting';

/**
 * Administration > Accounting > Profit per discipline (#2669). One organisation setting, off by default: while off,
 * no screen shows revenue per discipline. The switch card (#2746) gates on `can('manage', 'orgAccounting')` (UX); the setter
 * enforces the same rule in the database (ADR-0016).
 */
const OrgDisciplineProfit: React.FC = () => {
  const { t } = useTranslation('workOrderPva');
  return (
    <OrgSwitchSetting setting="disciplineProfit" id="org-discipline-profit" title={t('profit.setting.title', 'Profit per discipline')}
      label={t('profit.setting.label', 'Show revenue next to cost per discipline')}
      helper={t('profit.setting.helper', 'Adds a table to the project\'s plan-vs-actual section and a discipline field on contract lines. Off by default.')} />
  );
};

export default OrgDisciplineProfit;

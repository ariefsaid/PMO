import React from 'react';
import { useTranslation } from 'react-i18next';
import { OrgSwitchSetting } from '@/src/components/admin/OrgSwitchSetting';

/** The Admin switch for work-order transfers (#2691), off by default. The card (#2746) shows the read, the refusal and the Admin-only note. */
export const WoTransferToggle: React.FC = () => {
  const { t } = useTranslation('stock');
  return <OrgSwitchSetting setting="stockWoTransfers" label={t('workOrderTransfer.setting')} helper={t('workOrderTransfer.settingHelp')} />;
};

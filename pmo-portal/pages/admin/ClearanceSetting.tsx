import React from 'react';
import { useTranslation } from 'react-i18next';
import { OrgSwitchSetting } from '@/src/components/admin/OrgSwitchSetting';

/**
 * #2707 — the organisation switch for the cleared-for-site checklist, default off. Anyone who can open the People section sees
 * it; only an Admin changes it (UX gate; RLS and the column grant are the authority). While off, nothing else in PMO changes.
 */
export default function ClearanceSetting() {
  const { t } = useTranslation('administration');
  return (
    <OrgSwitchSetting setting="clearance" id="clearance-setting" title={t('clearance.setting.heading', 'Cleared-for-site checklist')}
      label={t('clearance.setting.label', 'Track who is cleared to go to site')}
      helper={t('clearance.setting.help', 'Adds a Clearance section where you list what each person needs and record when it is done. Nothing else changes.')} />
  );
}

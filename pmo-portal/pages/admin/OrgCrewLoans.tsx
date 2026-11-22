import React from 'react';
import { useTranslation } from 'react-i18next';
import { OrgSwitchSetting } from '@/src/components/admin/OrgSwitchSetting';

/**
 * Administration › People › Crew loans (#2704, migration 1249). Off by default: the Crews page then shows no loans.
 * The switch card (#2746) gates on `can('manage', 'orgAccounting')` (UX); `set_org_crew_loans_enabled` is the authority (ADR-0016).
 */
export default function OrgCrewLoans() {
  const { t } = useTranslation('administration');
  return (
    <OrgSwitchSetting setting="crewLoans" id="org-crew-loans" title={t('admin.crewLoans.title', 'Crew loans')}
      label={t('admin.crewLoans.label', 'Allow lending workers between crews')}
      helper={t('admin.crewLoans.helper', 'A lent worker follows the host crew on its roster and attendance for the loan period. Off, the Crews page shows no loans.')} />
  );
}

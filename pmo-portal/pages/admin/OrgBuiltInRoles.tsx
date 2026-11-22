import React from 'react';
import { useTranslation } from 'react-i18next';
import { usePermission } from '@/src/auth/usePermission';
import { OrgSwitchSetting } from '@/src/components/admin/OrgSwitchSetting';
import { SeatReport } from '@/src/components/my/SeatReport';

/**
 * Administration › People › Built-in roles (#2709). One organization setting, off by default: while off, the Users screen is
 * exactly what it was. Turning it on lets an Admin give people any of the 28 built-in roles from Edit role; turning it off keeps
 * the roles people already hold. Admin-only via `can('manage', 'orgAccounting')` (UX); the server setter enforces it (ADR-0016).
 */
const OrgBuiltInRoles: React.FC = () => {
  const { t } = useTranslation('administration');
  const canManage = usePermission()('manage', 'orgAccounting');
  return (
    <OrgSwitchSetting setting="builtInRoles" id="org-built-in-roles" title={t('admin.builtInRoles.title', 'Built-in roles')}
      label={t('admin.builtInRoles.label', 'Offer built-in roles')}
      helper={t('admin.builtInRoles.helper', 'Offer 28 roles across the functions of a contractor, in three levels. Each starts from one of the five access levels, so turning this on changes nothing until someone is given a role. People already given a role keep it if you turn this off.')}>
      {canManage && <SeatReport />}
    </OrgSwitchSetting>
  );
};

export default OrgBuiltInRoles;

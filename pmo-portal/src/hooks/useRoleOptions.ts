import { useTranslation } from 'react-i18next';
import { ALL_ROLES } from '@/src/auth/coarseRoles';

/** The organisation's role set as select options plus a labeller (#2680). No role name is coded here beyond the shared role list. */
export function useRoleOptions() {
  const { t } = useTranslation();
  const names: Record<string, string> = {
    Engineer: t('admin.roles.engineer', 'Engineer'),
    'Project Manager': t('admin.roles.projectManager', 'Project Manager'),
    Finance: t('admin.roles.finance', 'Finance'),
    Executive: t('admin.roles.executive', 'Executive'),
    Admin: t('admin.roles.admin', 'Admin'),
  };
  const label = (role: string | null | undefined) => (role ? names[role] ?? role : '');
  return { options: ALL_ROLES.map((r) => ({ value: r, label: label(r) })), label };
}

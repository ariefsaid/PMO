import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { UserRole } from '@/src/lib/db/adminUsers';

/**
 * The five user_role enum values, ordered for the role <select>, with their display names. A role is
 * NAMED in many places (pill, both selects, the manager combobox, confirm titles, toasts), so its
 * translation lives here once. The stored enum value (`UserRole`) is never translated.
 */
export function useRoleLabels(): {
  label: (role: UserRole) => string;
  options: { value: UserRole; label: string }[];
} {
  const { t } = useTranslation();
  return useMemo(() => {
    const labels: Record<UserRole, string> = {
      Engineer: t('admin.roles.engineer', 'Engineer'),
      'Project Manager': t('admin.roles.projectManager', 'Project Manager'),
      Finance: t('admin.roles.finance', 'Finance'),
      Executive: t('admin.roles.executive', 'Executive'),
      Admin: t('admin.roles.admin', 'Admin'),
    };
    const order: UserRole[] = ['Engineer', 'Project Manager', 'Finance', 'Executive', 'Admin'];
    return {
      label: (role) => labels[role],
      options: order.map((value) => ({ value, label: labels[value] })),
    };
  }, [t]);
}

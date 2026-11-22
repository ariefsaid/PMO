import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { BUILT_IN_ROLES, BUILT_IN_ROLE_TIERS, type BuiltInRoleTier } from '@/src/auth/builtInRoles';
import type { SelectOption } from '@/src/components/ui/FormFields';
import { useBuiltInRoleName } from './useOrgRoleNames';

/**
 * Built-in role (job role) choices for a picker, grouped by tier under a disabled heading, in the viewer's language with the
 * organisation's names. `none` is the first option's label (value ''). `tiers` limits the groups: an approver or orderer is never
 * a field (light) account, so those pickers pass manager and officer only.
 */
export function useJobRoleOptions(none: string, tiers: readonly BuiltInRoleTier[] = BUILT_IN_ROLE_TIERS): SelectOption[] {
  const { t } = useTranslation('administration');
  const roleName = useBuiltInRoleName();
  return useMemo(() => {
    const tierLabel: Record<BuiltInRoleTier, string> = {
      manager: t('admin.users.builtIn.tier.manager', 'Managers'),
      officer: t('admin.users.builtIn.tier.officer', 'Officers'),
      field: t('admin.users.builtIn.tier.field', 'Field'),
    };
    return [
      { value: '', label: none },
      ...tiers.flatMap((tier) => [
        { value: `__${tier}`, label: tierLabel[tier], disabled: true },
        ...BUILT_IN_ROLES.filter((role) => role.tier === tier).map((role) => ({ value: role.key, label: roleName(role.key) })),
      ]),
    ];
  }, [t, roleName, none, tiers]);
}

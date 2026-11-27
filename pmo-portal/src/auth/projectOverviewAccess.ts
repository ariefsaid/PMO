import type { Role } from './AuthContext';
import type { usePermission } from './usePermission';

export interface ProjectOverviewAccess { may: ReturnType<typeof usePermission>; realRole: Role | null }

export function projectOverviewFlags({ may, realRole }: ProjectOverviewAccess) {
  return {
    money: may('view', 'salesInvoice'),
    commitments: may('view', 'procurement'),
    budget: realRole === 'Admin' || realRole === 'Executive' || realRole === 'Finance' || realRole === 'Project Manager',
  };
}


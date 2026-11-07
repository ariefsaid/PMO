import { usePermission } from '@/src/auth/usePermission';

/**
 * #1459 — the finance view gate, written once. `canView`/`canAct` are the UX gate only:
 * RLS policies and RPCs are the enforcement authority (ADR-0016).
 */
export function useFinanceAccess(): { canView: boolean; canAct: boolean } {
  const may = usePermission();
  return { canView: may('view', 'finance'), canAct: may('act', 'finance') };
}

import { can } from '@/src/auth/policy';
import { useEffectiveRole } from '@/src/auth/impersonation';

/** The Odoo affordance gates (AC-ODC-082). Writes read the REAL role and are fenced while viewing as another role; reads follow the role being viewed. UX only: the edge routers and RPCs enforce. */
export function useOdooCan() {
  const { realRole, effectiveRole } = useEffectiveRole();
  const write = { realRole, record: { viewOnly: realRole !== effectiveRole } };
  return {
    manage: can('manage_external_bindings', 'integration', write),
    setValue: can('setValue', 'integration', write),
    viewFinancialDirectory: can('view', 'integration', { realRole: effectiveRole }),
  };
}

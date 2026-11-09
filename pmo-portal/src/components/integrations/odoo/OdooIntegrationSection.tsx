import { OdooConnectionCard } from './OdooConnectionCard';
import { OdooLedgerCard } from './OdooLedgerCard';
import { OdooMapOnce } from './OdooMapOnce';
import { OdooSetupChecklist } from './OdooSetupChecklist';
import { useOdooCan } from './useOdooCan';
import { useOdooConnection } from '@/src/hooks/useOdoo';
import { usePermission } from '@/src/auth/usePermission';

/** The Odoo card plus its setup steps, mounted on the Integrations page beside ERPNext. Steps are for the roles that can act on them. */
export function OdooIntegrationSection() {
  const may = useOdooCan();
  const can = usePermission();
  const conn = useOdooConnection().data;
  const ledger = Boolean(conn && conn.status === 'active' && conn.activated) && can('view', 'odooLedgerHealth');
  return (
    <div data-testid="odoo-section">
      <OdooConnectionCard />
      {(may.manage || may.setValue) && <OdooSetupChecklist />}
      {may.setValue && <OdooMapOnce />}
      {ledger && <div className="mt-3"><OdooLedgerCard /></div>}
    </div>
  );
}

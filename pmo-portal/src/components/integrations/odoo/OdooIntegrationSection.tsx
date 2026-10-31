import { OdooConnectionCard } from './OdooConnectionCard';
import { OdooSetupChecklist } from './OdooSetupChecklist';
import { useOdooCan } from './useOdooCan';

/** The Odoo card plus its setup steps, mounted on the Integrations page beside ERPNext. Steps are for the roles that can act on them. */
export function OdooIntegrationSection() {
  const may = useOdooCan();
  return (
    <div data-testid="odoo-section">
      <OdooConnectionCard />
      {(may.manage || may.setValue) && <OdooSetupChecklist />}
    </div>
  );
}

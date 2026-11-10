import type { AdministrationSection } from '../Administration';

export interface AdministrationPanelProps {
  orgId: string;
  isOperator: boolean;
  label: (id: AdministrationSection) => string;
}

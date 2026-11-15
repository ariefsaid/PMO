import type { AdministrationSection } from '../Administration';

/** Props every lazily loaded Administration section receives from the shell. */
export interface AdministrationPanelProps {
  orgId: string;
  isOperator: boolean;
  label: (id: AdministrationSection) => string;
}

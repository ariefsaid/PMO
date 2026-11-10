import React from 'react';
import AdministrationCredits from '../AdministrationCredits';
import type { AdministrationPanelProps } from './types';

const CreditsPanel: React.FC<AdministrationPanelProps> = ({ isOperator, orgId }) => (
  <div data-testid="administration-panel-credits" className="min-w-0">
    <AdministrationCredits isOperator={isOperator} orgId={orgId} />
  </div>
);

export default CreditsPanel;

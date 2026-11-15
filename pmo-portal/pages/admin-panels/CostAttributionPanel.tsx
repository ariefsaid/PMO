import React from 'react';
import CostAttribution from '../admin/CostAttribution';
import type { AdministrationPanelProps } from './types';

const CostAttributionPanel: React.FC<AdministrationPanelProps> = () => (
  <div data-testid="administration-panel-cost-attribution" className="min-w-0">
    <CostAttribution />
  </div>
);

export default CostAttributionPanel;

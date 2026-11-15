import React from 'react';
import YourPlan from '../YourPlan';
import { SectionName } from './SectionName';
import type { AdministrationPanelProps } from './types';

const PlanPanel: React.FC<AdministrationPanelProps> = ({ label }) => (
  <div data-testid="administration-panel-plan" className="min-w-0">
    <SectionName name={label('plan')} />
    <YourPlan />
  </div>
);

export default PlanPanel;

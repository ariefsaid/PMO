import React from 'react';
import { SectionHeader } from '@/src/components/ui';
import YourPlan from '../YourPlan';
import type { AdministrationPanelProps } from './types';

const PlanPanel: React.FC<AdministrationPanelProps> = ({ label }) => (
  <div data-testid="administration-panel-plan" className="min-w-0">
    <SectionHeader title={label('plan')} />
    <YourPlan />
  </div>
);

export default PlanPanel;

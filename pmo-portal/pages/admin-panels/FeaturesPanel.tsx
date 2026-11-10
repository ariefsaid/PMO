import React from 'react';
import { SectionHeader } from '@/src/components/ui';
import AdministrationFeatures from '../AdministrationFeatures';
import type { AdministrationPanelProps } from './types';

const FeaturesPanel: React.FC<AdministrationPanelProps> = ({ isOperator, orgId, label }) => (
  <div data-testid="administration-panel-features" className="min-w-0">
    <SectionHeader title={label('features')} />
    <AdministrationFeatures isOperator={isOperator} orgId={orgId} />
  </div>
);

export default FeaturesPanel;

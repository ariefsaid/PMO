import React from 'react';
import AdministrationFeatures from '../AdministrationFeatures';
import { SectionName } from './SectionName';
import type { AdministrationPanelProps } from './types';

const FeaturesPanel: React.FC<AdministrationPanelProps> = ({ orgId, isOperator, label }) => (
  <div data-testid="administration-panel-features" className="min-w-0">
    <SectionName name={label('features')} />
    <AdministrationFeatures isOperator={isOperator} orgId={orgId} />
  </div>
);

export default FeaturesPanel;

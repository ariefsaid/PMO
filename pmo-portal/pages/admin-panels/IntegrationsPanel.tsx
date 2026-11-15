import React from 'react';
import { FeedbackSurveysSetting } from '@/src/components/feedback/FeedbackSurveysSetting';
import { IntegrationsView } from '@/src/components/integrations/IntegrationsView';
import { SectionName } from './SectionName';
import type { AdministrationPanelProps } from './types';

const IntegrationsPanel: React.FC<AdministrationPanelProps> = ({ label }) => (
  <div data-testid="administration-panel-integrations" className="min-w-0">
    <SectionName name={label('integrations')} />
    <IntegrationsView />
    <FeedbackSurveysSetting />
  </div>
);

export default IntegrationsPanel;

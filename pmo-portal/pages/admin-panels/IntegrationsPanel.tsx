import React from 'react';
import { FeedbackSurveysSetting } from '@/src/components/feedback/FeedbackSurveysSetting';
import { IntegrationsView } from '@/src/components/integrations/IntegrationsView';
import { SectionHeader } from '@/src/components/ui';
import type { AdministrationPanelProps } from './types';

const IntegrationsPanel: React.FC<AdministrationPanelProps> = ({ label }) => (
  <div data-testid="administration-panel-integrations" className="min-w-0">
    <SectionHeader title={label('integrations')} />
    <IntegrationsView />
    <FeedbackSurveysSetting />
  </div>
);

export default IntegrationsPanel;

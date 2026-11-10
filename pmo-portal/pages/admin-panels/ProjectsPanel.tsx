import React from 'react';
import { SectionHeader } from '@/src/components/ui';
import OrgProjectClassificationOptions from '../admin/OrgProjectClassificationOptions';
import OrgProjectNumberPattern from '../admin/OrgProjectNumberPattern';
import type { AdministrationPanelProps } from './types';

const ProjectsPanel: React.FC<AdministrationPanelProps> = ({ label }) => (
  <div data-testid="administration-panel-projects" className="min-w-0">
    <SectionHeader title={label('projects')} />
    <div className="space-y-6">
      <OrgProjectNumberPattern />
      <OrgProjectClassificationOptions />
    </div>
  </div>
);

export default ProjectsPanel;

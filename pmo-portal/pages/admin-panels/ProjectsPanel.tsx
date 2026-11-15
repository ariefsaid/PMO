import React from 'react';
import OrgProjectNumberPattern from '../admin/OrgProjectNumberPattern';
import OrgProjectClassificationOptions from '../admin/OrgProjectClassificationOptions';
import { SectionName } from './SectionName';
import type { AdministrationPanelProps } from './types';

const ProjectsPanel: React.FC<AdministrationPanelProps> = ({ label }) => (
  <div data-testid="administration-panel-projects" className="min-w-0">
    <SectionName name={label('projects')} />
    <div className="space-y-6 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-6">
      <OrgProjectNumberPattern />
      <OrgProjectClassificationOptions />
    </div>
  </div>
);

export default ProjectsPanel;

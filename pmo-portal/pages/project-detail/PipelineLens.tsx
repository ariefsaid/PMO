import React from 'react';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import DealBand from '../sales/DealBand';

export interface PipelineLensProps {
  project: ProjectWithRefs;
  locationState?: unknown;
}

export const PipelineLens: React.FC<PipelineLensProps> = ({ project }) => <DealBand project={project} />;
export default PipelineLens;

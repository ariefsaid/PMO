import { createViewStorage } from './viewStorage';

/** The two Sales Pipeline body layouts (ViewToggle options). */
export const PIPELINE_VIEWS = ['kanban', 'table'] as const;
export type PipelineView = (typeof PIPELINE_VIEWS)[number];

export const DEFAULT_PIPELINE_VIEW: PipelineView = 'kanban';

const storage = createViewStorage('pipeline', PIPELINE_VIEWS, DEFAULT_PIPELINE_VIEW);

export const readPipelineView = storage.read;
export const writePipelineView = storage.write;

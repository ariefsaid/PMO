import { createViewStorage } from './viewStorage';

/** The Projects index body layouts (ViewToggle options): table, cards, calendar, or kanban board. */
export const PROJECT_VIEWS = ['table', 'cards', 'calendar', 'kanban'] as const;
export type ProjectView = (typeof PROJECT_VIEWS)[number];

export const DEFAULT_PROJECT_VIEW: ProjectView = 'table';

const storage = createViewStorage('project', PROJECT_VIEWS, DEFAULT_PROJECT_VIEW);

export const readProjectView = storage.read;
export const writeProjectView = storage.write;

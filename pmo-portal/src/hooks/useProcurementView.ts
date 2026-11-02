import { createViewStorage } from './viewStorage';

/** The two Procurement body layouts (ViewToggle options). */
export const PROCUREMENT_VIEWS = ['table', 'board'] as const;
export type ProcurementView = (typeof PROCUREMENT_VIEWS)[number];

export const DEFAULT_PROCUREMENT_VIEW: ProcurementView = 'table';

const storage = createViewStorage('procurement', PROCUREMENT_VIEWS, DEFAULT_PROCUREMENT_VIEW);

export const readProcurementView = storage.read;
export const writeProcurementView = storage.write;

import { lazyWithPreload } from '@/src/lib/lazyWithPreload';
import type { Area } from './projectDetailAreas';

/**
 * The ONE lazy home for project-detail's late chunks (#1834).
 *
 * ProjectSections used to declare each tab chunk with its own `React.lazy`, so
 * a tab's code started downloading only after the project record had arrived
 * AND the user had switched to that tab — one more serial step on slow
 * machines. This module keeps the lazy declarations (the chunk graph is
 * unchanged — every tab is still reached only via import()) but exposes a
 * `preload()` per chunk:
 *  - `ProjectSCurve` renders on the overview of every non-pipeline project, so
 *    the `/projects/:projectId` route entry preloads it alongside the page
 *    chunk (App.tsx PRELOAD_RULES).
 *  - `preloadProjectTab(area)` preloads a tab's chunk on tab hover/focus/
 *    pointerdown (ProjectSections wires it to the tab strip), mirroring the
 *    rail's nav-link preload.
 *
 * It lives in its own tiny module — importing it must NOT pull the tab
 * implementations into the entry chunk; the only static import is the helper.
 */
export const BudgetTab = lazyWithPreload(() => import('./tabs/BudgetTab'));
export const ProcurementTab = lazyWithPreload(() => import('./tabs/ProcurementTab'));
export const MaterialsTab = lazyWithPreload(() => import('./tabs/MaterialsTab'));
export const TasksTab = lazyWithPreload(() => import('./tabs/TasksTab'));
export const DocumentsTab = lazyWithPreload(() => import('./tabs/DocumentsTab'));
export const WorkOrdersTab = lazyWithPreload(() => import('./tabs/WorkOrdersTab'));
export const BillingTab = lazyWithPreload(() => import('./tabs/BillingTab'));
export const ContractCascade = lazyWithPreload(() =>
  import('./ContractCascade').then((module) => ({ default: module.ContractCascade })),
);
export const ProjectSCurve = lazyWithPreload(() => import('./ProjectSCurve'));
export const ProjectGantt = lazyWithPreload(() => import('./ProjectGantt'));

/**
 * The contract tab renders ContractCascade around BillingTab (contract tools)
 * and WorkOrdersTab in one go, so preloading one means preloading all three —
 * otherwise the cascade chunk lands and the two inside it start a fresh
 * waterfall. Activity is not lazy (ProjectActivity is a static import).
 * Exported for App.tsx's PRELOAD_RULES (deep-linked tab route entry).
 */
/** Anything with the lazyWithPreload preload() handle — structural, so each
 * chunk keeps its own precise prop types in the array below. */
interface Preloadable {
  preload: () => Promise<unknown>;
}

export const PROJECT_TAB_CHUNKS: Partial<Record<Area, Preloadable[]>> = {
  budget: [BudgetTab],
  procurement: [ProcurementTab],
  materials: [MaterialsTab],
  tasks: [TasksTab],
  documents: [DocumentsTab],
  contract: [ContractCascade, BillingTab, WorkOrdersTab],
};

/** Preload every chunk the given project-detail area needs (idempotent). */
export function preloadProjectTab(area: Area): void {
  for (const chunk of PROJECT_TAB_CHUNKS[area] ?? []) void chunk.preload();
}

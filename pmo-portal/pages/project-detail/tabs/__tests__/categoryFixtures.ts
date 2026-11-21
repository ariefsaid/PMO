import type { DocumentCategory } from '@/src/lib/db/documentCategories';

const ALL_ROLES: DocumentCategory['roles'] = ['Executive', 'Project Manager', 'Finance', 'Engineer', 'Admin'];

/** The system categories a caller who may see everything is offered in the register forms (the `useViewableCategories` result). */
export const SYSTEM_CATEGORIES: DocumentCategory[] = ['Drawing', 'Specification', 'Report', 'Transmittal', 'Submittal', 'Certificate', 'Other'].map(
  (name, i) => ({ id: `cat-${name.toLowerCase()}`, name, is_system: true, sort_order: (i + 1) * 10, archived_at: null, roles: ALL_ROLES }),
);

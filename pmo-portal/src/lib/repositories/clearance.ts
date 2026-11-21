/** repositories/clearance.ts (#2707) — the seam over the cleared-for-site checklist (ADR-0017). Standalone module like `crews.ts`: imported directly by its hooks, not listed on the `repositories` aggregate. Errors keep their Postgres code via `wrap`. */
import * as clearance from '@/src/lib/db/clearance';
import { wrap } from './repositoryErrors';
import type { ClearanceRepository } from './contracts/clearance';

export type {
  ClearanceItemRow, ClearanceItemInput, ClearanceState, PersonChecklistRow, ClearanceSummaryRow, ClearanceStateInput,
} from '@/src/lib/db/clearance';

export const clearanceRepository: ClearanceRepository = {
  enabled: () => wrap(() => clearance.getClearanceEnabled()),
  setEnabled: (enabled) => wrap(() => clearance.setClearanceEnabled(enabled)),
  items: () => wrap(() => clearance.listClearanceItems()),
  createItem: (input) => wrap(() => clearance.createClearanceItem(input)),
  updateItem: (id, patch) => wrap(() => clearance.updateClearanceItem(id, patch)),
  summary: () => wrap(() => clearance.listClearanceSummary()),
  checklist: (personId) => wrap(() => clearance.listPersonChecklist(personId)),
  saveState: (personId, itemId, input) => wrap(() => clearance.saveClearanceState(personId, itemId, input)),
  clearState: (personId, itemId) => wrap(() => clearance.clearClearanceState(personId, itemId)),
};

/** repositories/labourCost.ts (#2670) — the seam over labour cost setup (ADR-0017). Errors keep their Postgres code via `wrap`. */
import {
  addLabourClass, archiveLabourRate, endLabourRate, getLabourCostEnabled, listLabourClasses, listLabourRates, renameLabourClass,
  saveLabourRate, setLabourClassArchived, setLabourCostEnabled, type LabourRateInput,
} from '@/src/lib/db/labourCost';
import { wrap } from './repositoryErrors';

export type { LabourRateInput };

export const labourCostRepository = {
  enabled: () => wrap(getLabourCostEnabled),
  setEnabled: (on: boolean) => wrap(() => setLabourCostEnabled(on)),
  classes: () => wrap(listLabourClasses),
  addClass: (code: string, name: string) => wrap(() => addLabourClass(code, name)),
  renameClass: (id: string, name: string) => wrap(() => renameLabourClass(id, name)),
  archiveClass: (id: string, archived: boolean) => wrap(() => setLabourClassArchived(id, archived)),
  rates: () => wrap(listLabourRates),
  saveRate: (input: LabourRateInput) => wrap(() => saveLabourRate(input)),
  endRate: (id: string, endDate: string) => wrap(() => endLabourRate(id, endDate)),
  archiveRate: (id: string) => wrap(() => archiveLabourRate(id)),
};

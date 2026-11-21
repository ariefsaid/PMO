/** repositories/disciplineProfit.ts (#2669): the seam over profit per discipline (ADR-0017). Errors keep their Postgres code via `wrap`. */
import {
  getDisciplineProfitEnabled,
  listDisciplineRevenue,
  setBoqItemDiscipline,
  setDisciplineProfitEnabled,
} from '@/src/lib/db/disciplineProfit';
import { wrap } from './repositoryErrors';

export const disciplineProfitRepository = {
  isEnabled: () => wrap(() => getDisciplineProfitEnabled()),
  setEnabled: (enabled: boolean) => wrap(() => setDisciplineProfitEnabled(enabled)),
  revenue: (projectId: string) => wrap(() => listDisciplineRevenue(projectId)),
  setItemDiscipline: (itemId: string, disciplineId: string | null) => wrap(() => setBoqItemDiscipline(itemId, disciplineId)),
};

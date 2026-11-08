import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { TopProject } from '@/src/lib/db/dashboard';

const MAX_ROWS = 8;

export interface PlanVsActualRow { id: string; name: string; plan: number; actual: number | null; /** Active budget, only when in the contract currency. */ budget: number | null; /** Spent as a whole percent of the contract; null when spent is unknown. */ percent: number | null }

/**
 * Plan = contract value, actual = recorded spending. One currency only (the organisation's: bars in two
 * currencies share no axis); an actual that is incomplete or in another currency is left out, never 0.
 * The biggest contracts come first, capped at eight.
 */
export function planVsActualRows(projects: TopProject[], currency: string): PlanVsActualRow[] {
  return projects
    .filter((project) => project.currency === currency && project.contract_value != null && project.contract_value > 0)
    .map((project) => {
      const plan = project.contract_value as number;
      const actual = project.spent != null && project.actual_complete && (project.actual_currency ?? project.currency) === currency ? project.spent : null;
      return {
        id: project.id,
        name: projectDisplayName(project),
        plan,
        actual,
        budget: project.budget != null && (project.budget_currency ?? project.currency) === currency ? project.budget : null,
        percent: actual == null ? null : Math.round((actual / plan) * 100),
      };
    })
    .sort((a, b) => b.plan - a.plan)
    .slice(0, MAX_ROWS);
}

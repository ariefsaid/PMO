import { projectDisplayName } from '@/src/lib/projectDisplayName';
import type { TopProject } from '@/src/lib/db/dashboard';

const MAX_ROWS = 8;

export interface PlanVsActualRow { id: string; name: string; plan: number; actual: number | null }

/**
 * Plan = contract value, actual = recorded spending. One currency only (the organisation's: bars in two
 * currencies share no axis); an actual that is incomplete or in another currency is left out, never 0.
 * The biggest contracts come first, capped at eight.
 */
export function planVsActualRows(projects: TopProject[], currency: string): PlanVsActualRow[] {
  return projects
    .filter((project) => project.currency === currency && project.contract_value != null && project.contract_value > 0)
    .map((project) => ({
      id: project.id,
      name: projectDisplayName(project),
      plan: project.contract_value as number,
      actual: project.spent != null && project.actual_complete && (project.actual_currency ?? project.currency) === currency ? project.spent : null,
    }))
    .sort((a, b) => b.plan - a.plan)
    .slice(0, MAX_ROWS);
}

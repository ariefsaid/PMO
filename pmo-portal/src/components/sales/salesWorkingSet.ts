import type { PipelineProject } from '@/src/lib/db/dashboard';
import { matchesProjectClassification } from '@/src/lib/projectClassification';
import type { ProjectClassificationFilters } from '@/src/lib/projectClassification';
import {
  isNeedsAttention,
} from '../../../components/salesPipeline';
import type { SalesScope, SalesSort, SalesStage } from '@/src/lib/listWorkingSet';

export interface SalesWorkingSetFilters extends ProjectClassificationFilters {
  scope: SalesScope;
  status: SalesStage;
  sort: SalesSort;
  q: string;
}

type ActivityProject = Pick<PipelineProject, 'id' | 'name' | 'last_update'>;

function activityTimestamp(project: ActivityProject): number | null {
  if (!project.last_update) return null;
  const timestamp = Date.parse(project.last_update);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareIdentity(a: ActivityProject, b: ActivityProject): number {
  const aName = a.name.toLowerCase();
  const bName = b.name.toLowerCase();
  if (aName !== bName) return aName < bName ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/** Order one visible Sales set without mutating the source rows. Unknown activity remains first. */
export function sortSalesProjects<T extends ActivityProject>(
  projects: readonly T[],
  sort: SalesSort,
): T[] {
  const direction = sort === 'activity-newest' ? -1 : 1;
  return [...projects].sort((a, b) => {
    const aTimestamp = activityTimestamp(a);
    const bTimestamp = activityTimestamp(b);
    if (aTimestamp === null && bTimestamp !== null) return -1;
    if (bTimestamp === null && aTimestamp !== null) return 1;
    if (aTimestamp !== null && bTimestamp !== null && aTimestamp !== bTimestamp) {
      return (aTimestamp - bTimestamp) * direction;
    }
    return compareIdentity(a, b);
  });
}

/** Select the one filtered, ordered row set shared by Board, Table, phone, and export. */
export function selectSalesProjects(
  openProjects: readonly PipelineProject[],
  lostProjects: readonly PipelineProject[],
  filters: SalesWorkingSetFilters,
): PipelineProject[] {
  let rows: PipelineProject[];
  if (filters.scope === 'Lost') {
    rows = [...lostProjects];
  } else if (filters.scope === 'Needs attention') {
    rows = [...openProjects, ...lostProjects].filter(isNeedsAttention);
  } else {
    rows = [...openProjects];
  }

  if (filters.status) rows = rows.filter((project) => project.status === filters.status);
  rows = rows.filter((project) => matchesProjectClassification(project, filters));

  const query = filters.q.trim().toLowerCase();
  if (query) {
    rows = rows.filter((project) => [
      project.name,
      project.short_name,
      project.pmo_project_number,
      project.code,
      project.client_name,
      project.end_client_name,
      project.client_legal_name,
      project.end_client_legal_name,
    ].some((value) => value?.toLowerCase().includes(query)));
  }

  return sortSalesProjects(rows, filters.sort);
}

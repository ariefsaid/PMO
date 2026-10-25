import type { PipelineProject } from '@/src/lib/db/dashboard';
import type { SalesSort } from '@/src/lib/listWorkingSet';

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

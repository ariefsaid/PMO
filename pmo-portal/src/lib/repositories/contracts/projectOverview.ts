/** Project Overview read-model contract. */
import type { ProjectOverviewFlags, ProjectOverviewRead } from '@/src/lib/db/projectOverview';

export interface ProjectOverviewRepository {
  /** The Overview's above-the-fold summaries in one request; reads under the caller's own role and RLS. */
  read(projectId: string, flags: ProjectOverviewFlags): Promise<ProjectOverviewRead>;
}

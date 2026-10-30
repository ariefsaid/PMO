import type { PipelineProject } from '@/src/lib/db/dashboard';
import { matchesProjectClassification, type ProjectClassificationFilters } from '@/src/lib/projectClassification';
import { isNeedsAttention, type OpenFunnelStage } from '../../components/salesPipeline';

export type DealScope = 'Open' | 'Won' | 'Lost' | 'Needs attention';
export const DEAL_SCOPES: DealScope[] = ['Open', 'Won', 'Lost', 'Needs attention'];

/**
 * Shared eight-field search predicate for both table and board views (OE04-004, PGA05-008).
 * Checks deal name, short name, PMO project number, client code, customer names, and legal names.
 */
export function matchesPipelineSearch(p: PipelineProject, search: string): boolean {
  const q = search.trim().toLowerCase();
  if (!q) return true;
  return (
    p.name.toLowerCase().includes(q) ||
    (p.short_name ?? '').toLowerCase().includes(q) ||
    (p.pmo_project_number ?? '').toLowerCase().includes(q) ||
    (p.code ?? '').toLowerCase().includes(q) ||
    (p.client_name ?? '').toLowerCase().includes(q) ||
    (p.end_client_name ?? '').toLowerCase().includes(q) ||
    (p.client_legal_name ?? '').toLowerCase().includes(q) ||
    (p.end_client_legal_name ?? '').toLowerCase().includes(q)
  );
}

export interface FilterPipelineTableOptions {
  openProjects: PipelineProject[];
  wonProjects: PipelineProject[];
  lostProjects: PipelineProject[];
  scope: DealScope;
  selectedStatus?: OpenFunnelStage | null;
  workingSet?: ProjectClassificationFilters;
  search?: string;
}

/**
 * Scope-selected and filtered rows for table and mobile list presentations.
 * Retains table-scope semantics (Open / Won / Lost / Needs attention) and funnel stage filter.
 */
export function filterPipelineTable({
  openProjects,
  wonProjects,
  lostProjects,
  scope,
  selectedStatus = null,
  workingSet = {},
  search = '',
}: FilterPipelineTableOptions): PipelineProject[] {
  let base: PipelineProject[];
  if (scope === 'Won') {
    base = wonProjects;
  } else if (scope === 'Lost') {
    base = lostProjects;
  } else if (scope === 'Needs attention') {
    base = [...openProjects, ...lostProjects].filter(isNeedsAttention);
  } else {
    base = openProjects;
  }

  if (selectedStatus !== null) {
    base = base.filter((p) => p.status === selectedStatus);
  }

  base = base.filter((project) => matchesProjectClassification(project, workingSet));

  if (!search.trim()) return base;
  return base.filter((p) => matchesPipelineSearch(p, search));
}

export interface FilterPipelineBoardOptions {
  openProjects: PipelineProject[];
  wonProjects: PipelineProject[];
  lostProjects: PipelineProject[];
  workingSet?: ProjectClassificationFilters;
  search?: string;
}

/**
 * Board set spans open ∪ won ∪ lost, filtered by classification and shared search predicate.
 */
export function filterPipelineBoard({
  openProjects,
  wonProjects,
  lostProjects,
  workingSet = {},
  search = '',
}: FilterPipelineBoardOptions): PipelineProject[] {
  const allProjects = [...openProjects, ...wonProjects, ...lostProjects];
  const classified = allProjects.filter((project) => matchesProjectClassification(project, workingSet));
  if (!search.trim()) return classified;
  return classified.filter((p) => matchesPipelineSearch(p, search));
}

import React from 'react';
import type { TFunction } from 'i18next';
import type { StatusFilter } from './useProjectListModel';

export interface ProjectsHealth {
  total: number;
  atRisk: number;
  overBudget: number;
  late: number;
}

/**
 * The list's one finding line (screen rules "Words"): today's off-track facts, each clause filtering
 * the list to its rows. Omitted when nothing is off track.
 */
export const ProjectsFinding: React.FC<{
  health: ProjectsHealth;
  filter: StatusFilter;
  onFilter: (filter: StatusFilter) => void;
  t: TFunction;
}> = ({ health, filter, onFilter, t }) => {
  const clauses: { key: StatusFilter; text: string }[] = [];
  if (health.atRisk > 0) {
    clauses.push({ key: 'at-risk', text: t('projects:health.atRisk', '{{count}} of {{total}} at risk', { count: health.atRisk, total: health.total }) });
  }
  if (health.overBudget > 0) {
    clauses.push({ key: 'over-budget', text: t('projects:health.overBudget', '{{count}} over budget', { count: health.overBudget }) });
  }
  if (health.late > 0) {
    clauses.push({ key: 'late', text: t('projects:health.late', '{{count}} late', { count: health.late }) });
  }
  if (clauses.length === 0) return null;
  return (
    <p data-testid="projects-finding" className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-control text-foreground">
      {clauses.map((clause, index) => (
        <React.Fragment key={clause.key}>
          {index > 0 && <span aria-hidden className="text-muted-foreground">·</span>}
          <button
            type="button"
            aria-pressed={filter === clause.key}
            onClick={() => onFilter(filter === clause.key ? 'All' : clause.key)}
            className="min-h-11 rounded-sm font-medium text-primary-text underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:underline sm:min-h-0"
          >
            {clause.text}
          </button>
        </React.Fragment>
      ))}
    </p>
  );
};

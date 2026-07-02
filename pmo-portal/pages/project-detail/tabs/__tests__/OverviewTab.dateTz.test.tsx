/**
 * AC-W2-3-02: record-rail start/end dates do NOT day-shift in behind-UTC timezones.
 *
 * L3-RECORD moved the identifying fields out of OverviewTab and into the persistent
 * ProjectDetailRail. The oracle stays the same: date-only YYYY-MM-DD values must render
 * the correct local calendar day via `formatDate`, never the UTC-shifted previous day.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => false,
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({ updateHeader: { mutateAsync: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isError: false,
    error: null,
    isPending: false,
  }),
}));

import ProjectDetailRail from '../../ProjectDetailRail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

function makeProject(overrides: Partial<ProjectWithRefs> = {}): ProjectWithRefs {
  return {
    id: 'proj-tz',
    org_id: 'org-001',
    name: 'TZ Test',
    status: 'Ongoing Project',
    contract_value: 500000,
    budget: 0,
    spent: 0,
    code: null,
    customer_contract_ref: null,
    client_id: null,
    client: null,
    project_manager_id: null,
    pm: null,
    contract_date: null,
    archived_at: null,
    ...overrides,
  } as unknown as ProjectWithRefs;
}

const renderRail = (project: ProjectWithRefs) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectDetailRail project={project} />
      </ToastProvider>
    </MemoryRouter>,
  );

describe('AC-W2-3-02: ProjectDetailRail start/end dates — no UTC day-shift', () => {
  it('renders start_date 2026-06-14 as "Jun 14, 2026" (not Jun 13 behind UTC)', () => {
    renderRail(makeProject({ start_date: '2026-06-14', end_date: '2026-12-31' }));

    expect(screen.getByText('Jun 14, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Jun 13, 2026')).not.toBeInTheDocument();
  });

  it('renders end_date 2026-12-31 as "Dec 31, 2026" (not Dec 30 behind UTC)', () => {
    renderRail(makeProject({ start_date: '2026-01-01', end_date: '2026-12-31' }));

    expect(screen.getByText('Dec 31, 2026')).toBeInTheDocument();
    expect(screen.queryByText('Dec 30, 2026')).not.toBeInTheDocument();
  });
});

/**
 * AC-W2-3-02: page-scope start/end dates do NOT day-shift in behind-UTC timezones.
 *
 * L3-RECORD moved the identifying dates into ProjectDetailHeader's scope line. Keep the oracle
 * on the shipped surface: date-only YYYY-MM-DD values must render the stored calendar day.
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => false }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => ({
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/hooks/useProjectVatEditability', () => ({
  useProjectVatEditability: () => ({
    data: { eligible: true, reason: null, hasInvoices: false },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));

import ProjectDetailHeader from '../../ProjectDetailHeader';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

function makeProject(overrides: Partial<ProjectWithRefs> = {}): ProjectWithRefs {
  return {
    id: 'proj-tz',
    org_id: 'org-001',
    name: 'TZ Test',
    status: 'Ongoing Project',
    contract_value: 500000,
    currency: 'USD',
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

const renderHeader = (project: ProjectWithRefs) =>
  render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectDetailHeader project={project} />
      </ToastProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  vi.stubEnv('TZ', 'America/Los_Angeles');
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'America/Los_Angeles' });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetActiveLocale();
});

describe('AC-W2-3-02: ProjectDetailHeader scope dates — no UTC day-shift', () => {
  it('renders start_date 2026-06-14 as Jun 14, 2026 (not Jun 13)', () => {
    renderHeader(makeProject({ start_date: '2026-06-14', end_date: '2026-12-31' }));

    const scope = screen.getByRole('group', { name: 'Project scope' });
    expect(scope).toHaveTextContent('Jun 14, 2026');
    expect(scope).not.toHaveTextContent('Jun 13, 2026');
  });

  it('renders end_date 2026-12-31 as Dec 31, 2026 (not Dec 30)', () => {
    renderHeader(makeProject({ start_date: '2026-01-01', end_date: '2026-12-31' }));

    const scope = screen.getByRole('group', { name: 'Project scope' });
    expect(scope).toHaveTextContent('Dec 31, 2026');
    expect(scope).not.toHaveTextContent('Dec 30, 2026');
  });
});

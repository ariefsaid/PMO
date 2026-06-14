import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

/**
 * A-1 PipelineLens write-affordance gate (AC-W2-RBAC-001/002, rbac-visibility §B2):
 *   Pipeline lifecycle control (Advance / Mark won / Mark lost) is Admin·Exec·PM (delivery).
 *   Finance·Engineer = ○ (read-only). The gate reads the REAL JWT role.
 *
 * Two-sided gating-invariant: the AUTHORIZED role (PM) sees + can act; the DENIED role
 * (Engineer) sees the stage + journey but NO reject-bound lifecycle control — instead a clean
 * read-only note. RLS stays the authority (ADR-0016); this is FE clarity.
 */
const { transitionProject } = vi.hoisted(() => ({
  transitionProject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/src/lib/db/projectTransitions', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, transitionProject };
});

const pipelineState = {
  data: {
    stages: [],
    projects: [
      { id: 'd1', name: 'Acme Tender Bid', status: 'Tender Submitted', contract_value: 1200000, win_probability: 0.5 },
    ] as Array<Record<string, unknown>>,
  },
};
vi.mock('@/src/hooks/useDashboard', () => ({ useSalesPipeline: () => pipelineState }));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: 'Project Manager' }),
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useQueryClient: () => ({ invalidateQueries: vi.fn() }) };
});

import PipelineLens from '../PipelineLens';

const dealRow = {
  id: 'd1',
  name: 'Acme Tender Bid',
  code: 'OPP-0042',
  status: 'Tender Submitted',
  client_id: 'c1',
  project_manager_id: 'u-alice',
  contract_value: 1200000,
  budget: 0,
  spent: 0,
  decided_at: null,
  client: { name: 'Acme' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const renderAs = (realRole: Role) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <ToastProvider>
        <PipelineLens project={dealRow} />
      </ToastProvider>
    </ImpersonationProvider>,
  );

beforeEach(() => transitionProject.mockClear());

describe('PipelineLens — RBAC write-affordance gate (A-1)', () => {
  it('AC-W2-RBAC-002: a PM sees Advance / Mark won / Mark lost (authorized)', () => {
    renderAs('Project Manager');
    expect(screen.getByRole('button', { name: /Advance to/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark won/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mark lost/i })).toBeInTheDocument();
  });

  it('AC-W2-RBAC-001: an Engineer sees the stage + journey but NO lifecycle control (denied)', () => {
    renderAs('Engineer');
    // The deal still renders its stats + journey (read-only surface).
    expect(screen.getByRole('list', { name: /Project stage journey/i })).toBeInTheDocument();
    // No reject-bound lifecycle control is rendered.
    expect(screen.queryByRole('button', { name: /Advance to/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark won/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark lost/i })).not.toBeInTheDocument();
    // A clean read-only note explains who manages the pipeline (not a wall of dead buttons).
    expect(screen.getByText(/managed by the project owner/i)).toBeInTheDocument();
  });

  it('AC-W2-RBAC-001: Finance is read-only on the pipeline lens too (denied)', () => {
    renderAs('Finance');
    expect(screen.queryByRole('button', { name: /Advance to/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark won/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Mark lost/i })).not.toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import type { Role } from '@/src/auth/AuthContext';

/**
 * B-3 (AC-W2-IXD-005): the "+ New opportunity" CTA on the Sales Pipeline is
 * shown to roles that can create a project (Admin·Exec·PM) and hidden from
 * Finance and Engineer (rbac-visibility §C).
 *
 * The CTA reuses the ProjectFormModal that Projects.tsx uses — no new create
 * path, just surfaced at the natural place (the pipeline you manage deals on).
 *
 * Two-sided gating invariant:
 *  - PM (authorized): CTA present.
 *  - Finance (denied): CTA absent.
 */

vi.mock('react-router-dom', async (orig) => {
  const actual = await (orig() as Promise<Record<string, unknown>>);
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock('@/src/hooks/useDashboard', () => ({
  useSalesPipeline: () => ({ data: { stages: [], projects: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useLostDeals: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/usePipelineView', () => ({ usePipelineView: () => ['table', vi.fn()] }));

// Stub the create modal (tested elsewhere).
vi.mock('../../components/ProjectFormModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div role="dialog" aria-label="New opportunity">
      <button onClick={onClose}>Cancel</button>
    </div>
  ),
}));

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({ data: [], isPending: false }),
  useClientCompanies: () => ({ data: [] }),
  useProjectManagers: () => ({ data: [] }),
  useProjectMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
}));

import SalesPipeline from '../SalesPipeline';

const renderAs = (realRole: Role) =>
  render(
    <ImpersonationProvider realRole={realRole}>
      <MemoryRouter>
        <ToastProvider>
          <SalesPipeline />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

describe('SalesPipeline — + New opportunity CTA gating (B-3, AC-W2-IXD-005)', () => {
  it('AC-W2-IXD-005: a PM sees the "+ New opportunity" CTA on the Sales Pipeline', () => {
    renderAs('Project Manager');
    expect(
      screen.getByRole('button', { name: /new opportunity/i }),
    ).toBeInTheDocument();
  });

  it('AC-W2-IXD-005: Finance does NOT see the "+ New opportunity" CTA (gating regression)', () => {
    renderAs('Finance');
    expect(
      screen.queryByRole('button', { name: /new opportunity/i }),
    ).not.toBeInTheDocument();
  });

  it('AC-W2-IXD-005: an Engineer does NOT see the "+ New opportunity" CTA', () => {
    renderAs('Engineer');
    // Engineers are denied the Sales Pipeline page entirely (A-4); CTA also absent.
    expect(
      screen.queryByRole('button', { name: /new opportunity/i }),
    ).not.toBeInTheDocument();
  });
});

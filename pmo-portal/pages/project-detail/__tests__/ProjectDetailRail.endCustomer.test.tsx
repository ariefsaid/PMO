/**
 * AC-EC-003 — issue #758: the project detail rail shows the End customer row ONLY when the
 * project has one (an optional value is omitted, not rendered as "Not set").
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectDetailRail from '../ProjectDetailRail';
// ProjectErpLink reads the org's ERP binding through react-query; it has its own test (AC-SETUP-001).
vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

vi.mock('../../components/ProjectStatusControl', () => ({
  default: () => <div data-testid="status-control" />,
}));

const baseProject = {
  id: 'p1', name: 'X', code: 'OPP-1', status: 'Ongoing Project' as const,
  client_id: 'c1', client: { name: 'Main Contractor' }, project_manager_id: null, pm: null,
  customer_contract_ref: null,
};

const renderRail = (project: Record<string, unknown>) =>
  render(
    <ToastProvider>
      <ProjectDetailRail
        project={project as never}
        showActionSection={false}
      />
    </ToastProvider>,
  );

describe('AC-EC-003 — project detail rail end customer', () => {
  it('AC-CODE-003: the rail labels both identity fields and intentionally shows an absent Client Project Code', () => {
    renderRail({ ...baseProject, pmo_project_number: 'PMO-26-7711', code: null, end_client_id: null, end_client: null });
    expect(screen.getByText('PMO Project Number')).toBeInTheDocument();
    expect(screen.getByText('PMO-26-7711')).toBeInTheDocument();
    expect(screen.getByText('Client Project Code')).toBeInTheDocument();
    expect(screen.getByText('Client Project Code').nextElementSibling).toHaveTextContent('Not set');
  });

  it('AC-EC-003: the rail shows the End customer row when the project has one', () => {
    renderRail({
      ...baseProject,
      end_client_id: '75800000-0000-0000-0000-0000000000a1',
      end_client: { name: 'Asset Owner PT' },
    });
    expect(screen.getByText('End customer')).toBeInTheDocument();
    expect(screen.getByText('Asset Owner PT')).toBeInTheDocument();
  });

  it('AC-EC-003: the rail omits the End customer row when it is null', () => {
    renderRail({ ...baseProject, end_client_id: null, end_client: null });
    expect(screen.queryByText('End customer')).not.toBeInTheDocument();
  });
});
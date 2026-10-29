import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import ProjectSections from '../ProjectSections';

/**
 * The former OverviewTab was removed when the approved project composition moved to
 * ProjectSections. Keep this guard path bound to the active Overview area and its role lenses.
 * Money arithmetic, honest unknowns and a11y details remain owned by the focused live suites.
 */
const h = vi.hoisted(() => ({ role: 'Finance' as string }));

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => (_action: string, entity: string) => entity === 'salesInvoice'
    ? ['Admin', 'Executive', 'Finance'].includes(h.role)
    : entity === 'workOrder'
      ? ['Admin', 'Executive', 'Finance', 'Project Manager'].includes(h.role)
      : true,
}));
vi.mock('../ProjectAttention', () => ({ ProjectAttention: () => <section aria-label="Project attention" /> }));
vi.mock('../ProjectBlocks', () => ({
  CostBlock: () => <section aria-label="Project costs">Cost content</section>,
  DeliveryBlock: () => <section aria-label="Project delivery">Delivery content</section>,
  MoneyBlock: () => <section aria-label="Project finances">Money content</section>,
}));
vi.mock('../ProjectActivity', () => ({
  ActivityFooter: () => <section aria-label="Project activity" />,
  MyOpenTasks: () => <section aria-label="My open tasks" />,
  ProjectActivity: () => <section aria-label="Project activity" />,
}));
vi.mock('../useProjectPosition', () => ({
  useOverdueReceivables: () => ({ data: null, isPending: false, isError: false, refetch: vi.fn() }),
  useProjectAttention: () => ({ items: [], isPending: false, error: null, myVisibleTaskKeys: new Set() }),
}));
vi.mock('../ProjectSCurve', () => ({ default: () => null }));

const project = {
  id: 'p1', name: 'Alpha', code: 'A-1', status: 'Ongoing Project', currency: 'IDR',
  contract_value: 10_000, project_manager_id: 'u-pm', client_id: null,
} as unknown as ProjectWithRefs;

const renderOverview = (role = 'Finance') => {
  h.role = role;
  return render(
    <MemoryRouter>
      <ProjectSections project={project} area="overview" setArea={vi.fn()} isPipeline={false} header={<h1>Alpha</h1>} />
    </MemoryRouter>,
  );
};

beforeEach(() => { h.role = 'Finance'; });

describe('active project Overview role composition', () => {
  it('AC-PFIN-019: Finance sees the money cockpit alongside project costs and delivery', () => {
    renderOverview();

    const panel = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(within(panel).getByRole('region', { name: 'Project finances' })).toHaveTextContent('Money content');
    expect(within(panel).getByRole('region', { name: 'Project costs' })).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'Project delivery' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Project activity' })).toBeInTheDocument();
  });

  it('AC-PFIN-019: an Engineer gets the delivery lens without finance figures', () => {
    renderOverview('Engineer');

    const panel = screen.getByRole('tabpanel', { name: 'Overview' });
    expect(within(panel).getByRole('region', { name: 'My open tasks' })).toBeInTheDocument();
    expect(within(panel).getByRole('region', { name: 'Project delivery' })).toBeInTheDocument();
    expect(within(panel).queryByRole('region', { name: 'Project finances' })).not.toBeInTheDocument();
  });
});

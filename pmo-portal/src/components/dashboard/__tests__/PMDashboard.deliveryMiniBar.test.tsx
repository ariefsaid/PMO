import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { PMDashboard } from '../PMDashboard';

vi.mock('@/src/hooks/useProjects', () => ({
  useProjects: () => ({
    data: [
      {
        id: 'p1',
        name: 'Meridian Steelworks',
        contract_value: 4_000_000,
        budget: 3_000_000,
        spent: 1_000_000,
        status: 'Ongoing Project',
        project_manager_id: 'pm-1',
        client: { name: 'Acme' },
        pm: null,
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({
  useProjectsDelivery: () => ({ data: { p1: 32 } }),
}));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({
  useTimesheetsAwaitingApproval: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => ({ data: [], isPending: false }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: 'Project Manager' }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'pm-1', org_id: 'org-1' }, role: 'Project Manager' }),
}));

describe('PMDashboard delivery mini-bar', () => {
  it('renders the delivery mini-bar beside the status pill and preserves the accessible label', () => {
    const { container } = render(
      <MemoryRouter>
        <PMDashboard />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText('Delivery 32%')).toBeInTheDocument();
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
    expect(container.querySelector('[class*="h-1.5"][class*="w-12"]')).not.toBeNull();
  });
});

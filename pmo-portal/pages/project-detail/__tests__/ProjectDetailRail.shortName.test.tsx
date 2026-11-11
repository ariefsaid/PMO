/** AC-002 #1325: the Details rail states the contractual name beside a short name, readable without hover. */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import ProjectDetailRail from '../ProjectDetailRail';

vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => <div data-testid="status-control" /> }));

const base = {
  id: 'p1', name: 'Contractual Depot Expansion', short_name: null, code: null, pmo_project_number: 'PMO-1',
  status: 'Ongoing Project' as const, client_id: null, client: null, project_manager_id: null, pm: null,
  customer_contract_ref: null, end_client: null,
};
const renderRail = (project: Record<string, unknown>) =>
  render(<ToastProvider><ProjectDetailRail project={project as never} showActionSection={false} /></ToastProvider>);

describe('ProjectDetailRail contract name (AC-002 #1325)', () => {
  it('shows a Contract name row when a short name is set', () => {
    renderRail({ ...base, short_name: 'Depot' });
    expect(screen.getByText('Contract name').nextElementSibling).toHaveTextContent('Contractual Depot Expansion');
  });
  it.each([null, '  ', 'Contractual Depot Expansion'])('omits the row when the short name is %j', (short_name) => {
    renderRail({ ...base, short_name });
    expect(screen.queryByText('Contract name')).toBeNull();
  });
});

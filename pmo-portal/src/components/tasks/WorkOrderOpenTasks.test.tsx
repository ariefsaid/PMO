import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const h = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { task: { listOpenByWorkOrder: h.list } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

import { WorkOrderOpenTasks } from './WorkOrderOpenTasks';

const wrap = (ui: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);

describe('AC-TWOP-009 a work order page lists its open tasks', () => {
  it('lists the two open tasks with assignee and due date', async () => {
    h.list.mockResolvedValue([
      { id: 'a', name: 'Pour slab', assignee: { id: 'u', full_name: 'Dana' }, end_date: '2026-12-01' },
      { id: 'b', name: 'Cure check', assignee: null, end_date: null },
    ]);
    wrap(<WorkOrderOpenTasks workOrderId="wo-1" />);
    expect(await screen.findByText('Pour slab')).toBeInTheDocument();
    expect(screen.getByText('Cure check')).toBeInTheDocument();
    expect(screen.getByText('Dana')).toBeInTheDocument();
    expect(screen.getByText('2026-12-01')).toBeInTheDocument();
    expect(screen.getByText('workOrderTasks.unassigned')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(h.list).toHaveBeenCalledWith('wo-1');
  });
  it('says so when there are none', async () => {
    h.list.mockResolvedValue([]);
    wrap(<WorkOrderOpenTasks workOrderId="wo-2" />);
    expect(await screen.findByText('workOrderTasks.empty')).toBeInTheDocument();
  });
});

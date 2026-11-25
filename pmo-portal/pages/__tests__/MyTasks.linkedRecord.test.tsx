/**
 * AC-RLT-014 (list): a task that follows a record shows the record's type, number and live status; a record the
 * person cannot view shows only "linked record you cannot view"; a closed task says why. One batched read serves the
 * whole page (the hook is called once with every linked task id).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const h = vi.hoisted(() => {
  const base = { assignee_id: 'u-self', project_id: null, project_name: null, start_date: null, end_date: null, priority: null, archived_at: null };
  return {
    ids: [] as string[][],
    tasks: {
      data: [
        { ...base, id: 't1', name: 'Chase the claim', status: 'In Progress', procurement_id: null, expense_claim_id: 'c1', material_request_id: null },
        { ...base, id: 't2', name: 'Chase the purchase', status: 'To Do', procurement_id: 'p1', expense_claim_id: null, material_request_id: null },
        { ...base, id: 't3', name: 'Plain task', status: 'To Do' },
        { ...base, id: 't4', name: 'Check the drawings', status: 'To Do', work_order_id: 'wo-9', work_order_name: 'Site works' },
      ] as Array<Record<string, unknown>>,
      isPending: false, isError: false, refetch: vi.fn(),
    },
  };
});

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => h.tasks,
  useMyTaskMutations: () => ({ updateStatus: { mutate: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useTaskLinkedRecords', () => ({
  useTaskLinkedRecords: (ids: string[]) => {
    h.ids.push([...ids]);
    return {
      data: new Map([
        ['t1', { taskId: 't1', linkType: 'expense_claim', recordId: 'c1', label: 'EXP-0007', status: 'Approved', isEndState: false, readable: true }],
        ['t2', { taskId: 't2', linkType: 'procurement', recordId: null, label: null, status: null, isEndState: null, readable: false }],
      ]),
    };
  },
}));

import MyTasks from '../MyTasks';

describe('AC-RLT-014 My tasks rows show the followed record', () => {
  it('shows the number and status of a readable record, the placeholder for an unreadable one, and nothing for a plain task', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ImpersonationProvider realRole="Engineer"><MemoryRouter><ToastProvider><MyTasks /></ToastProvider></MemoryRouter></ImpersonationProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('link', { name: /EXP-0007/ })).toHaveAttribute('href', '/expenses/c1');
    expect(screen.getByText('Approved')).toBeInTheDocument();
    expect(screen.getByText(/linked record you cannot view/i)).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: /linked record/i })).toHaveLength(1);
  });

  it('NFR-RLT-001 asks for the linked status of the whole page at once, only for tasks that carry a link', () => {
    h.ids.length = 0;
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ImpersonationProvider realRole="Engineer"><MemoryRouter><ToastProvider><MyTasks /></ToastProvider></MemoryRouter></ImpersonationProvider>
      </QueryClientProvider>,
    );
    expect(h.ids.at(-1)).toEqual(['t1', 't2']);
  });
  it('AC-WOC-004 a check on a work order names that work order and links to it', () => {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ImpersonationProvider realRole="Engineer"><MemoryRouter><ToastProvider><MyTasks /></ToastProvider></MemoryRouter></ImpersonationProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('link', { name: 'Site works' })).toHaveAttribute('href', '/work-orders/wo-9');
  });
});

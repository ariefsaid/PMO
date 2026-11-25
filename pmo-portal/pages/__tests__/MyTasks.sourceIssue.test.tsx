/**
 * JOB-F17: a task that was made from an issue shows a link back to that issue on its My Tasks row;
 * a plain task shows none. One batched read serves the whole page, asked only of the loaded tasks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const h = vi.hoisted(() => ({ asked: [] as string[][], issues: new Map<string, string>() }));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => ({
    data: [
      { id: 't1', name: 'Replace the guard rail', status: 'To Do', assignee_id: 'u-self', project_id: 'p1', project_name: 'Harbour wall', start_date: null, end_date: null, priority: null, archived_at: null, procurement_id: null, expense_claim_id: null, material_request_id: null, closed_by_record_type: null, closed_by_record_status: null },
      { id: 't2', name: 'Plain task', status: 'To Do', assignee_id: 'u-self', project_id: 'p1', project_name: 'Harbour wall', start_date: null, end_date: null, priority: null, archived_at: null, procurement_id: null, expense_claim_id: null, material_request_id: null, closed_by_record_type: null, closed_by_record_status: null },
    ],
    isPending: false, isError: false, refetch: vi.fn(),
  }),
  useMyTaskMutations: () => ({ updateStatus: { mutate: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useTaskLinkedRecords', () => ({
  useTaskLinkedRecords: () => ({ data: undefined }),
}));
vi.mock('@/src/lib/repositories', () => ({
  repositories: {
    task: {
      sourceIssues: (ids: readonly string[]) => { h.asked.push([...ids]); return Promise.resolve(h.issues); },
    },
  },
}));

import MyTasks from '../MyTasks';

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImpersonationProvider realRole="Engineer"><MemoryRouter><ToastProvider><MyTasks /></ToastProvider></MemoryRouter></ImpersonationProvider>
    </QueryClientProvider>,
  );
};

beforeEach(() => { h.asked.length = 0; h.issues = new Map([['t1', 'issue-1']]); });

describe('JOB-F17 My tasks rows link back to the source issue', () => {
  it('shows a link to the issue on the task that was made from one, and none on a plain task', async () => {
    renderPage();
    const links = await screen.findAllByRole('link', { name: 'From issue' });
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', '/incidents/issue-1');
  });

  it('asks for the source issues of the whole page in one call', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: 'From issue' });
    expect(h.asked).toHaveLength(1);
    expect(h.asked[0]).toEqual(['t1', 't2']);
  });
});

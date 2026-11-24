import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const { detail, addTask, saveRootCause, auth } = vi.hoisted(() => ({
  detail: { data: undefined as Record<string, unknown> | null | undefined, isPending: false, isError: false, error: null, refetch: vi.fn() },
  addTask: vi.fn().mockResolvedValue('t3'),
  saveRootCause: vi.fn().mockResolvedValue(undefined),
  auth: { id: 'u-self' },
}));

vi.mock('@/src/hooks/useIncidents', () => ({
  useIncident: () => detail,
  useIncidentMutations: () => ({ update: { mutateAsync: vi.fn(), isPending: false }, transition: { mutateAsync: vi.fn(), isPending: false } }),
  useAssigneeOptions: () => ({ data: [{ value: 'u-a', label: 'Ana Site' }] }),
  useSupervisorMayTask: () => false,
  useIncidentEvidenceMutations: () => ({
    upload: { mutateAsync: vi.fn(), isPending: false },
    makeTask: { mutateAsync: vi.fn(), isPending: false },
    addTask: { mutateAsync: addTask, isPending: false },
    saveRootCause: { mutateAsync: saveRootCause, isPending: false },
  }),
  useIncidentFiles: () => ({ data: [] }),
}));
vi.mock('@/src/hooks/useIncidentLinkedTask', () => ({ useIncidentLinkedTask: () => ({ data: { project_id: 'p1' } }) }));
vi.mock('@/src/hooks/useWorkOrders', () => ({ useProjectWorkOrders: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useFkOptions', () => ({ useProjectOptions: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: auth.id, org_id: 'org-1' } }) }));
let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import IncidentDetail from './IncidentDetail';

const base = {
  id: 'i1', org_id: 'org-1', incident_date: '2026-03-15', type: 'Defect', severity: 'Low', location: null, description: 'Rail loose',
  status: 'Open', reported_by: 'u1', assignee_id: 'u-a', project_id: 'p1', created_at: '2026-03-15T00:00:00Z', root_cause: null, type_id: null,
  incident_tasks: [
    { created_at: '2026-03-16T00:00:00Z', tasks: { id: 't1', name: 'Replace the rail', status: 'To Do', assignee_id: 'u-a', end_date: '2026-04-01', project_id: 'p1' } },
    { created_at: '2026-03-17T00:00:00Z', tasks: { id: 't2', name: 'Order the part', status: 'Done', assignee_id: null, end_date: null, project_id: 'p1' } },
  ],
};

const renderPage = (role: Role) => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/incidents/i1']}>
        <Routes><Route path="/incidents/:incidentId" element={<IncidentDetail />} /></Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  detail.data = base;
  auth.id = 'u-self';
  addTask.mockClear();
  saveRootCause.mockClear();
});

describe('IncidentDetail tasks and root cause (#2677)', () => {
  it('AC-ITR-009: lists every task of the issue with its status and a link', () => {
    renderPage('Project Manager');
    const rows = screen.getAllByTestId('incident-task-row');
    expect(rows).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Replace the rail' })).toHaveAttribute('href', '/projects/p1/tasks?open=t1');
    expect(screen.getByRole('link', { name: 'Order the part' })).toBeInTheDocument();
  });

  it('AC-ITR-009: a manager sees "Add a task" and it calls the repository seam', async () => {
    const user = userEvent.setup();
    renderPage('Project Manager');
    await user.click(screen.getByTestId('incident-add-task'));
    await user.type(await screen.findByLabelText(/^Task/), 'Inspect the weld');
    await user.click(screen.getByRole('button', { name: 'Add a task', hidden: false }));
    expect(addTask).toHaveBeenCalledWith({ incidentId: 'i1', name: 'Inspect the weld', assigneeId: null, dueDate: null });
  });

  it('AC-ITR-009: an Engineer does not see "Add a task"', () => {
    renderPage('Engineer');
    expect(screen.queryByTestId('incident-add-task')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('incident-task-row')).toHaveLength(2);
  });

  it('AC-ITR-009: a task hidden by row security shows a plain line with no name', () => {
    detail.data = { ...base, incident_tasks: [{ created_at: 'x', tasks: null }] };
    renderPage('Engineer');
    expect(screen.getByText('A task you cannot view')).toBeInTheDocument();
  });

  it('AC-ITR-010: a manager records the root cause and the repository receives it', async () => {
    const user = userEvent.setup();
    renderPage('Project Manager');
    expect(screen.queryByTestId('incident-root-cause')).not.toBeInTheDocument();
    await user.click(screen.getByTestId('incident-root-cause-add'));
    await user.type(screen.getByLabelText('Root cause'), 'Wrong fixing spec');
    await user.click(screen.getByTestId('incident-root-cause-save'));
    expect(saveRootCause).toHaveBeenCalledWith({ id: 'i1', rootCause: 'Wrong fixing spec' });
  });

  it('AC-ITR-010: the person in charge may edit it; a reporter-only Engineer sees it read-only', () => {
    detail.data = { ...base, root_cause: 'Supplier changed the bolt' };
    auth.id = 'u-a';
    const { unmount } = renderPage('Engineer');
    expect(screen.getByText('Supplier changed the bolt')).toBeInTheDocument();
    expect(screen.getByTestId('incident-root-cause-edit')).toBeInTheDocument();
    unmount();
    auth.id = 'u1';
    renderPage('Engineer');
    expect(screen.getByText('Supplier changed the bolt')).toBeInTheDocument();
    expect(screen.queryByTestId('incident-root-cause-edit')).not.toBeInTheDocument();
  });

  it('AC-ITR-008: an issue with no root cause and no extra tasks renders as before (no Root cause card, no task list)', () => {
    detail.data = { ...base, incident_tasks: [] };
    auth.id = 'u1';
    renderPage('Engineer');
    expect(screen.queryByText('Root cause')).not.toBeInTheDocument();
    expect(screen.queryByTestId('incident-root-cause')).not.toBeInTheDocument();
    expect(screen.queryByTestId('incident-root-cause-add')).not.toBeInTheDocument();
    expect(screen.queryByTestId('incident-tasks')).not.toBeInTheDocument();
  });

  it('AC-ITR-008: a manager with no root cause gets no card until they choose to record one', () => {
    detail.data = { ...base, incident_tasks: [] };
    renderPage('Project Manager');
    expect(screen.queryByTestId('incident-root-cause')).not.toBeInTheDocument();
    expect(screen.queryByTestId('incident-root-cause-form')).not.toBeInTheDocument();
  });
});

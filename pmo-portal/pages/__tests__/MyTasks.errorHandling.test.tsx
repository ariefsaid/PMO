import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ImpersonationProvider } from '@/src/auth/impersonation';
import { ToastProvider } from '@/src/components/ui';

/**
 * W2-2 — MyTasks silent no-op error handling.
 * AC-W2-2-01: failed status write surfaces a toast (no silent revert).
 * AC-W2-2-02: status SelectField is disabled while a status mutation is pending.
 */

vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-self', org_id: 'org-1' }, role: 'Engineer' }),
}));

const { mutateState, toastSpy } = vi.hoisted(() => ({
  mutateState: {
    isPending: false,
    mutate: vi.fn(),
  },
  toastSpy: vi.fn(),
}));

vi.mock('@/src/hooks/useMyTasks', () => ({
  useMyTasks: () => ({
    data: [
      {
        id: 'task-1',
        name: 'Fix the login bug',
        status: 'In Progress',
        end_date: null,
        project_id: 'proj-1',
        project_name: 'Alpha Project',
        assignee_id: 'u-self',
      },
    ],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useMyTaskMutations: () => ({
    updateStatus: mutateState,
  }),
}));

vi.mock('@/src/components/ui/Toast', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/src/components/ui/Toast')>();
  return {
    ...real,
    useToast: () => ({ toast: toastSpy }),
  };
});

import MyTasks from '../MyTasks';

const renderMyTasks = () =>
  render(
    <ImpersonationProvider realRole="Engineer">
      <MemoryRouter>
        <ToastProvider>
          <MyTasks />
        </ToastProvider>
      </MemoryRouter>
    </ImpersonationProvider>,
  );

beforeEach(() => {
  mutateState.isPending = false;
  mutateState.mutate.mockClear();
  toastSpy.mockClear();
});

describe('MyTasks — status mutation error handling (W2-2)', () => {
  it('AC-W2-2-01: a permission-denied (42501) status write surfaces classifyMutationError\'s SoD-specific copy (no silent revert, no generic fallback)', async () => {
    // Simulate mutate calling the onError callback with a PostgREST-shaped RLS-denial error
    // (code 42501 — insufficient privilege / SoD), the real shape classifyMutationError branches
    // on. Asserting the SPECIFIC classified headline (not just "some non-empty string") proves
    // MyTasks actually wires the error through classifyMutationError rather than a generic catch.
    mutateState.mutate.mockImplementation((_vars: unknown, opts?: { onError?: (err: unknown) => void }) => {
      opts?.onError?.(Object.assign(new Error('permission denied for table tasks'), { code: '42501' }));
    });

    renderMyTasks();

    // The task row should show a SelectField for status
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);

    // Change status to trigger mutation
    fireEvent.change(selects[0], { target: { value: 'Done' } });

    // The toast surfaces classifyMutationError's exact 42501 headline + the underlying message
    // as detail — not a generic "Update failed" or an unasserted non-empty string.
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith(
        "You don't have permission to do that.",
        'permission denied for table tasks',
        'warning',
      );
    });
  });

  it('AC-W2-2-01b: an unclassified status-write error falls back to classifyMutationError\'s generic "Update failed" headline (distinguishes the fallback branch from the SoD branch above)', async () => {
    mutateState.mutate.mockImplementation((_vars: unknown, opts?: { onError?: (err: unknown) => void }) => {
      opts?.onError?.(new Error('unexpected server error'));
    });

    renderMyTasks();

    const selects = screen.getAllByRole('combobox');
    fireEvent.change(selects[0], { target: { value: 'Done' } });

    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalledWith('Update failed', 'unexpected server error', 'warning');
    });
  });

  it('AC-W2-2-02: status SelectField is disabled while mutation is pending', () => {
    mutateState.isPending = true;

    renderMyTasks();

    const selects = screen.getAllByRole('combobox');
    // The status select for this task should be disabled
    expect(selects[0]).toBeDisabled();
  });
});

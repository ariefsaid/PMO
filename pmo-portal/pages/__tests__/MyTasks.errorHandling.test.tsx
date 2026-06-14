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
  it('AC-W2-2-01: failed status write calls onError which surfaces a toast (no silent revert)', async () => {
    // Simulate mutate calling the onError callback with an error
    mutateState.mutate.mockImplementation((_vars: unknown, opts?: { onError?: (err: unknown) => void }) => {
      opts?.onError?.(new Error('RLS policy violation'));
    });

    renderMyTasks();

    // The task row should show a SelectField for status
    const selects = screen.getAllByRole('combobox');
    expect(selects.length).toBeGreaterThan(0);

    // Change status to trigger mutation
    fireEvent.change(selects[0], { target: { value: 'Done' } });

    // The toast should have been called with a non-empty headline
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
      const [headline] = toastSpy.mock.calls[0];
      expect(typeof headline).toBe('string');
      expect(headline.length).toBeGreaterThan(0);
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

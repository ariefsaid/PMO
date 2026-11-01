import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const winEligibility = vi.hoisted(() => ({ data: 'allowed' as string | undefined, isFetching: false, isError: false }));

const mockEligibility = vi.fn((..._args: unknown[]) => winEligibility);
const mockMutate = vi.fn();
const mockMutateAsync = vi.fn();

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: vi.fn(() => ({ effectiveRole: 'Project Manager' })),
}));

vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectWinEligibility: (...args: unknown[]) => mockEligibility(...args),
  useProjectTransition: vi.fn(() => ({
    mutate: mockMutate,
    mutateAsync: mockMutateAsync,
    isError: false,
    error: null,
    isPending: false,
  })),
}));

import ProjectStatusControl from './ProjectStatusControl';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useProjectTransition } from '@/src/hooks/useProjectTransitions';

const negotiationProject = {
  id: 'proj-1',
  status: 'Negotiation' as const,
  customer_contract_ref: null as string | null,
};

const renderControl = (project = negotiationProject) =>
  render(
    <ToastProvider>
      <ProjectStatusControl project={project} />
    </ToastProvider>,
  );

const getConfirmButton = (label: RegExp) =>
  screen.getByRole('button', { name: label });

beforeEach(() => {
  vi.clearAllMocks();
  winEligibility.data = 'allowed';
  winEligibility.isFetching = false;
  winEligibility.isError = false;
  vi.mocked(useEffectiveRole).mockReturnValue({
    effectiveRole: 'Project Manager',
    realRole: 'Project Manager',
    canImpersonate: false,
    viewAs: vi.fn(),
  });
  vi.mocked(useProjectTransition).mockReturnValue({
    mutate: mockMutate,
    mutateAsync: mockMutateAsync,
    isError: false,
    error: null,
    isPending: false,
  } as unknown as ReturnType<typeof useProjectTransition>);
});

describe('ProjectStatusControl - Lost Reason (AC-LR-010)', () => {
  it('AC-LR-010: choosing Loss Tender opens confirm with empty reason and disabled Confirm button; selecting Price enables it and submits reason', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValue(undefined);

    renderControl();
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('button', { name: /Loss Tender/i }));

    const dlg = screen.getByRole('alertdialog');
    expect(dlg).toBeInTheDocument();

    const reasonSelect = screen.getByRole('combobox', { name: /Reason/i });
    expect(reasonSelect).toHaveValue('');

    const confirmBtn = getConfirmButton(/Mark lost/i);
    expect(confirmBtn).toBeDisabled();

    await user.selectOptions(reasonSelect, 'price');
    expect(confirmBtn).toBeEnabled();

    await user.click(confirmBtn);
    expect(mockMutateAsync).toHaveBeenCalledWith({
      id: 'proj-1',
      to: 'Loss Tender',
      opts: { lostReason: 'price', lostNote: undefined },
    });
  });

  it('AC-LR-010: selecting Other keeps Confirm disabled until a note is entered', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValue(undefined);

    renderControl();
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('button', { name: /Loss Tender/i }));

    const reasonSelect = screen.getByRole('combobox', { name: /Reason/i });
    const confirmBtn = getConfirmButton(/Mark lost/i);

    await user.selectOptions(reasonSelect, 'other');
    expect(confirmBtn).toBeDisabled();

    const noteInput = screen.getByRole('textbox', { name: /Note/i });
    await user.type(noteInput, 'Budget cuts by client');
    expect(confirmBtn).toBeEnabled();

    await user.click(confirmBtn);
    expect(mockMutateAsync).toHaveBeenCalledWith({
      id: 'proj-1',
      to: 'Loss Tender',
      opts: { lostReason: 'other', lostNote: 'Budget cuts by client' },
    });
  });

  it('AC-LR-010 / FR-LR-015: choosing a non-lost target shows no reason field and Confirm is enabled immediately', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockResolvedValue(undefined);

    renderControl();
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('button', { name: /Tender Submitted/i }));

    expect(screen.queryByTestId('lost-reason-fields')).not.toBeInTheDocument();
    const confirmBtn = getConfirmButton(/Move to Tender Submitted/i);
    expect(confirmBtn).toBeEnabled();

    await user.click(confirmBtn);
    expect(mockMutateAsync).toHaveBeenCalledWith({
      id: 'proj-1',
      to: 'Tender Submitted',
      opts: undefined,
    });
  });

  it('AC-LR-010 / AC-LR-013: server error path toasts Status change failed with the server message', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockRejectedValue(new Error('P0001: a reason is required when a deal is lost or declined'));

    renderControl();
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('button', { name: /Loss Tender/i }));

    const reasonSelect = screen.getByRole('combobox', { name: /Reason/i });
    await user.selectOptions(reasonSelect, 'price');
    await user.click(getConfirmButton(/Mark lost/i));

    await waitFor(() => {
      const toastEl = screen.getByRole('alert');
      expect(toastEl).toHaveTextContent(/Status change failed/i);
      expect(toastEl).toHaveTextContent(/a reason is required/i);
    });
  });
});

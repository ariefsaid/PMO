import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMutate = vi.fn();
const mockMutateAsync = vi.fn();

vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: vi.fn(() => ({ effectiveRole: 'Project Manager' })),
}));

vi.mock('@/src/hooks/useProjectTransitions', () => ({
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

const wonProject = {
  id: 'proj-2',
  status: 'Won, Pending KoM' as const,
  customer_contract_ref: 'CPO-2026-001',
};

// useToast requires a ToastProvider ancestor (PR1-PR3 toast-on-resolve).
const renderControl = (project: typeof negotiationProject | typeof wonProject) =>
  render(
    <ToastProvider>
      <ProjectStatusControl project={project} />
    </ToastProvider>,
  );

/** The ConfirmDialog primary/destructive commit button (inside the portal). */
const getConfirmButton = (label: RegExp) =>
  screen.getByRole('button', { name: label });

beforeEach(() => {
  vi.clearAllMocks();
  // Reset to PM role
  vi.mocked(useEffectiveRole).mockReturnValue({ effectiveRole: 'Project Manager', realRole: 'Project Manager', canImpersonate: false, viewAs: vi.fn() });
  vi.mocked(useProjectTransition).mockReturnValue({
    mutate: mockMutate,
    mutateAsync: mockMutateAsync,
    isError: false,
    error: null,
    isPending: false,
  } as unknown as ReturnType<typeof useProjectTransition>);
});

describe('ProjectStatusControl', () => {
  it('AC-1004: ProjectStatusControl offers exactly the legal next statuses for the current status, requires a customer contract ref + date when target is Won, Pending KoM, surfaces a mutation error inline, and is hidden for a non-write role (FR-PR-005/011, NFR-PR-UI-001)', async () => {
    const user = userEvent.setup();

    // Render the control for a Negotiation project
    renderControl(negotiationProject);

    // Open the status control (click "Change Status" button)
    const changeBtn = screen.getByRole('button', { name: /change status/i });
    await user.click(changeBtn);

    // Offers exactly the legal next statuses for Negotiation
    // LEGAL: ['Won, Pending KoM', 'Tender Submitted', 'Loss Tender']
    expect(screen.getByRole('button', { name: /Won, Pending KoM/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tender Submitted/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Loss Tender/i })).toBeInTheDocument();
    // NOT legal from Negotiation:
    expect(screen.queryByRole('button', { name: /Ongoing Project/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /PQ Submitted/i })).not.toBeInTheDocument();

    // Selecting 'Won, Pending KoM' reveals contract ref + contract date inputs
    await user.click(screen.getByRole('button', { name: /Won, Pending KoM/i }));

    const refInput = screen.getByRole('textbox', { name: /customer contract ref/i });
    const dateInput = screen.getByLabelText(/contract date/i);
    const submitBtn = screen.getByRole('button', { name: /confirm/i });

    // Submit is blocked until both filled
    await user.click(submitBtn);
    expect(mockMutate).not.toHaveBeenCalled();

    // Fill both inputs
    await user.type(refInput, 'CPO-TEST-1');
    await user.type(dateInput, '2026-03-15');
    await user.click(submitBtn);

    expect(mockMutate).toHaveBeenCalledWith({
      id: 'proj-1',
      to: 'Won, Pending KoM',
      opts: { customerContractRef: 'CPO-TEST-1', contractDate: '2026-03-15' },
    });
  });

  it('surfaces mutation error inline (NFR-PR-UI-001)', () => {
    vi.mocked(useProjectTransition).mockReturnValue({
      mutate: mockMutate,
      mutateAsync: mockMutateAsync,
      isError: true,
      error: new Error('illegal transition P0001'),
      isPending: false,
    } as unknown as ReturnType<typeof useProjectTransition>);

    renderControl(negotiationProject);
    expect(screen.getByText(/illegal transition P0001/i)).toBeInTheDocument();
  });

  it('is hidden for a non-write role (Engineer)', () => {
    vi.mocked(useEffectiveRole).mockReturnValue({
      effectiveRole: 'Engineer',
      realRole: 'Engineer',
      canImpersonate: false,
      viewAs: vi.fn(),
    });

    renderControl(negotiationProject);
    expect(screen.queryByRole('button', { name: /change status/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// PR1-PR3 — confirm-before-write (owner rule: nothing mutates on a single click)
// ---------------------------------------------------------------------------
describe('ProjectStatusControl — confirm before write (PR1-PR3)', () => {
  it('PR1: a forward target opens a default-tone confirm and does NOT mutate until Confirm; then toasts on resolve', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockReset();
    // mutateAsync resolves so the toast-on-resolve path runs (the control awaits it).
    mockMutateAsync.mockResolvedValue(undefined);

    renderControl(negotiationProject);
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('button', { name: /Tender Submitted/i }));

    // The dropdown selection must NOT have fired the mutation yet.
    expect(mockMutateAsync).not.toHaveBeenCalled();
    // A confirm dialog (default tone => role=dialog) is shown.
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Commit via the confirm button (verb + object).
    await user.click(getConfirmButton(/Move to Tender Submitted/i));
    expect(mockMutateAsync).toHaveBeenCalledWith({
      id: 'proj-1',
      to: 'Tender Submitted',
      opts: undefined,
    });

    // PR1 toast-on-resolve (§6.7): success toast appears.
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Tender Submitted/i),
    );
  });

  it('PR3: a Loss/terminal target opens a DESTRUCTIVE modal (role=alertdialog) and only Confirm mutates', async () => {
    const user = userEvent.setup();
    mockMutateAsync.mockReset();
    mockMutateAsync.mockResolvedValue(undefined);

    renderControl(negotiationProject);
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('button', { name: /Loss Tender/i }));

    expect(mockMutateAsync).not.toHaveBeenCalled();
    // Destructive => alertdialog with a Mark-lost confirm.
    const dlg = screen.getByRole('alertdialog');
    expect(dlg).toBeInTheDocument();

    await user.click(getConfirmButton(/Mark lost/i));
    expect(mockMutateAsync).toHaveBeenCalledWith({
      id: 'proj-1',
      to: 'Loss Tender',
      opts: undefined,
    });
  });

  it('PR2: the win path is unchanged — submitting the inline win form mutates directly (no extra confirm)', async () => {
    const user = userEvent.setup();
    mockMutate.mockReset();

    renderControl(negotiationProject);
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('button', { name: /Won, Pending KoM/i }));
    await user.type(screen.getByRole('textbox', { name: /customer contract ref/i }), 'CPO-W-1');
    await user.type(screen.getByLabelText(/contract date/i), '2026-03-15');
    await user.click(screen.getByRole('button', { name: /^confirm$/i }));

    expect(mockMutate).toHaveBeenCalledWith({
      id: 'proj-1',
      to: 'Won, Pending KoM',
      opts: { customerContractRef: 'CPO-W-1', contractDate: '2026-03-15' },
    });
  });
});

describe('ProjectStatusControl — popover collision-aware placement (#2)', () => {
  it('the MOVE TO dropdown anchors right-0 (not left-0) to stay within the viewport when far-right', async () => {
    const user = userEvent.setup();
    renderControl(negotiationProject);
    await user.click(screen.getByRole('button', { name: /change status/i }));

    // Find the dropdown panel (it has the "Move to" heading)
    const panel = screen.getByText(/move to/i).closest('div')!;
    // Must anchor to the right edge of the trigger (right-0) not left-0
    expect(panel.className).toContain('right-0');
    expect(panel.className).not.toContain('left-0');
  });

  it('the win-capture form panel also anchors right-0 to avoid viewport overflow', async () => {
    const user = userEvent.setup();
    renderControl(negotiationProject);
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('button', { name: /Won, Pending KoM/i }));

    const form = screen.getByRole('textbox', { name: /customer contract ref/i }).closest('form')!;
    expect(form.className).toContain('right-0');
    expect(form.className).not.toContain('left-0');
  });
});

describe('ProjectStatusControl — Won project', () => {
  it('shows legal next statuses for Won, Pending KoM project', async () => {
    const user = userEvent.setup();
    renderControl(wonProject);

    await user.click(screen.getByRole('button', { name: /change status/i }));

    // Legal from Won, Pending KoM: Ongoing Project, On Hold, Close Out
    expect(screen.getByRole('button', { name: /Ongoing Project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /On Hold/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close Out/i })).toBeInTheDocument();
    // NOT legal from Won, Pending KoM (pipeline move would be illegal)
    expect(screen.queryByRole('button', { name: /Negotiation/i })).not.toBeInTheDocument();
  });
});

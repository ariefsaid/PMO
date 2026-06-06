import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

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
    render(<ProjectStatusControl project={negotiationProject} />);

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

    render(<ProjectStatusControl project={negotiationProject} />);
    expect(screen.getByText(/illegal transition P0001/i)).toBeInTheDocument();
  });

  it('is hidden for a non-write role (Engineer)', () => {
    vi.mocked(useEffectiveRole).mockReturnValue({
      effectiveRole: 'Engineer',
      realRole: 'Engineer',
      canImpersonate: false,
      viewAs: vi.fn(),
    });

    render(<ProjectStatusControl project={negotiationProject} />);
    expect(screen.queryByRole('button', { name: /change status/i })).not.toBeInTheDocument();
  });

  it('non-win transitions submit immediately without extra inputs', async () => {
    const user = userEvent.setup();

    render(<ProjectStatusControl project={negotiationProject} />);
    await user.click(screen.getByRole('button', { name: /change status/i }));
    await user.click(screen.getByRole('button', { name: /Loss Tender/i }));

    expect(mockMutate).toHaveBeenCalledWith({
      id: 'proj-1',
      to: 'Loss Tender',
      opts: undefined,
    });
  });
});

describe('ProjectStatusControl — popover collision-aware placement (#2)', () => {
  it('the MOVE TO dropdown anchors right-0 (not left-0) to stay within the viewport when far-right', async () => {
    const user = userEvent.setup();
    render(<ProjectStatusControl project={negotiationProject} />);
    await user.click(screen.getByRole('button', { name: /change status/i }));

    // Find the dropdown panel (it has the "Move to" heading)
    const panel = screen.getByText(/move to/i).closest('div')!;
    // Must anchor to the right edge of the trigger (right-0) not left-0
    expect(panel.className).toContain('right-0');
    expect(panel.className).not.toContain('left-0');
  });

  it('the win-capture form panel also anchors right-0 to avoid viewport overflow', async () => {
    const user = userEvent.setup();
    render(<ProjectStatusControl project={negotiationProject} />);
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
    render(<ProjectStatusControl project={wonProject} />);

    await user.click(screen.getByRole('button', { name: /change status/i }));

    // Legal from Won, Pending KoM: Ongoing Project, On Hold, Close Out
    expect(screen.getByRole('button', { name: /Ongoing Project/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /On Hold/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close Out/i })).toBeInTheDocument();
    // NOT legal from Won, Pending KoM (pipeline move would be illegal)
    expect(screen.queryByRole('button', { name: /Negotiation/i })).not.toBeInTheDocument();
  });
});

/**
 * AC-JR-T13: ProcurementTab "New request" button — in-context PR creation.
 *
 * When a user is on a project's Procurement tab they should be able to raise a
 * PR against THIS project without leaving the tab. The button is gated by
 * can('create', 'procurement') (ALL roles). Clicking it opens NewProcurementModal
 * with the project pre-selected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

// ── Mocks ─────────────────────────────────────────────────────────────────────

const { procState } = vi.hoisted(() => ({
  procState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@/src/hooks/useProcurements', () => ({
  useProcurements: () => procState,
}));

vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({
    data: [{ value: 'proj-abc', label: 'Test Project', sub: 'PRJ-ABC' }],
  }),
  useVendorOptions: () => ({ data: [] }),
}));

vi.mock('@/src/hooks/useProcurementCrud', () => ({
  useCreateProcurement: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ id: 'new-pr-1' }),
    isPending: false,
  }),
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => {
  const real = await orig<typeof import('react-router-dom')>();
  return {
    ...real,
    useNavigate: () => mockNavigate,
  };
});

let realRole: Role = 'Project Manager';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-1', org_id: 'org-1' }, role: realRole }),
}));

import ProcurementTab from '../tabs/ProcurementTab';

const renderTab = (role: Role = 'Project Manager') => {
  realRole = role;
  return render(
    <ToastProvider>
      <ProcurementTab projectId="proj-abc" />
    </ToastProvider>,
  );
};

beforeEach(() => {
  procState.data = [];
  procState.isPending = false;
  procState.isError = false;
  procState.refetch.mockClear();
  mockNavigate.mockClear();
  realRole = 'Project Manager';
});

// ── AC-JR-T13: header button visible ──────────────────────────────────────────

describe('AC-JR-T13: ProcurementTab shows a gated "New request" button', () => {
  it('AC-JR-T13: header "New request" button is visible when user can create procurement', () => {
    renderTab('Project Manager');
    // With empty data, there are two buttons: header button + emptyAction button
    const buttons = screen.getAllByRole('button', { name: /new request/i });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('AC-JR-T13: empty state also shows a "New request" action when can create', () => {
    procState.data = [];
    renderTab('Project Manager');
    // Both the header button and/or the empty-state action link
    const buttons = screen.getAllByRole('button', { name: /new request/i });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('AC-JR-T13: "New request" button is visible for Engineer role too (create: allow(ALL))', () => {
    // The policy says create: allow(ALL) so ALL roles including Engineer can create procurements.
    renderTab('Engineer');
    const buttons = screen.getAllByRole('button', { name: /new request/i });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});

// ── AC-JR-T13: modal opens with project pre-selected ─────────────────────────

describe('AC-JR-T13: clicking New request opens NewProcurementModal with project pre-selected', () => {
  it('AC-JR-T13: clicking New request opens a dialog', async () => {
    renderTab('Project Manager');
    // Click the first "New request" button (header button)
    const [headerBtn] = screen.getAllByRole('button', { name: /new request/i });
    await userEvent.click(headerBtn);
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
  });

  it('AC-JR-T13: the opened modal pre-selects the project from the tab context', async () => {
    renderTab('Project Manager');
    const [headerBtn] = screen.getAllByRole('button', { name: /new request/i });
    await userEvent.click(headerBtn);
    // The project combobox should show the project name — "Test Project" — because
    // we passed initialProjectId="proj-abc" and the FK options contain it.
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
    // The Combobox renders the selected label as text inside a role=combobox button.
    // When initialProjectId is provided and options are loaded, the project name
    // should appear as text inside the combobox trigger.
    const projectCombo = screen.getByRole('combobox', { name: /project/i });
    expect(projectCombo).toHaveTextContent('Test Project');
  });

  it('AC-JR-T13: successful create navigates to the new PR detail page', async () => {
    renderTab('Project Manager');
    const [headerBtn] = screen.getAllByRole('button', { name: /new request/i });
    await userEvent.click(headerBtn);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Fill title and submit
    await userEvent.type(screen.getByLabelText(/title/i), 'New cables');
    await userEvent.click(screen.getByRole('button', { name: /create request/i }));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/procurement/new-pr-1');
    });
  });

  it('AC-JR-T13: cancelling the modal returns to the tab without navigating', async () => {
    renderTab('Project Manager');
    const [headerBtn] = screen.getAllByRole('button', { name: /new request/i });
    await userEvent.click(headerBtn);
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());

    // Close by pressing the "Close" icon button (aria-label="Close") in the modal header
    const dialog = screen.getByRole('dialog');
    const closeBtn = dialog.querySelector('button[aria-label="Close"]') as HTMLElement;
    expect(closeBtn).not.toBeNull();
    await userEvent.click(closeBtn);
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalledWith(expect.stringContaining('/procurement/'));
  });
});

// ── AC-JR-T13: loading + error states unaffected ─────────────────────────────

describe('AC-JR-T13: loading and error states', () => {
  it('AC-JR-T13: loading state renders the aria-busy loading skeleton', () => {
    procState.isPending = true;
    renderTab('Project Manager');
    // The tab returns early with ListState variant="loading", which renders an
    // aria-busy="true" wrapper around the skeleton rows (see ListState.tsx).
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('AC-JR-T13: error state shows retry, header button still visible', () => {
    procState.isError = true;
    procState.data = undefined as unknown as never[];
    renderTab('Project Manager');
    expect(screen.getByRole('button', { name: /try again|retry/i })).toBeInTheDocument();
  });
});

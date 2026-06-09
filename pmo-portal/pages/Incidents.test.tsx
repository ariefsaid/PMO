import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

// ── Repository-seam-backed hooks are mocked; the page is the unit under test. ──
const { listState, mutations } = vi.hoisted(() => ({
  listState: {
    data: [] as unknown[],
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  },
  mutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false },
    transition: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  },
}));

vi.mock('@/src/hooks/useIncidents', () => ({
  useIncidents: () => listState,
  useIncidentMutations: () => mutations,
}));

// usePermission reads the REAL JWT role from the impersonation context.
let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole, effectiveRole: realRole }),
}));

import Incidents from './Incidents';

const seed = [
  {
    id: 'i1',
    org_id: 'org-1',
    incident_date: '2026-03-15',
    type: 'Near Miss',
    severity: 'Low',
    location: 'Site B',
    description: 'Trip hazard',
    status: 'Open',
    reported_by: 'u1',
    created_at: '2026-03-15T00:00:00Z',
  },
  {
    id: 'i2',
    org_id: 'org-1',
    incident_date: '2026-04-02',
    type: 'Equipment Damage',
    severity: 'High',
    location: 'HQ',
    description: 'Forklift impact',
    status: 'Investigating',
    reported_by: 'u2',
    created_at: '2026-04-02T00:00:00Z',
  },
  {
    id: 'i3',
    org_id: 'org-1',
    incident_date: '2026-04-10',
    type: 'Spill',
    severity: 'Critical',
    location: 'Yard',
    description: 'Chemical spill',
    status: 'Closed',
    reported_by: 'u3',
    created_at: '2026-04-10T00:00:00Z',
  },
];

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <ToastProvider>
      <MemoryRouter>
        <Incidents />
      </MemoryRouter>
    </ToastProvider>,
  );
};

beforeEach(() => {
  listState.data = seed;
  listState.isPending = false;
  listState.isError = false;
  listState.refetch.mockClear();
  Object.values(mutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
  realRole = 'Admin';
});

describe('Incidents index — rows + badges + filters (AC-IN-001)', () => {
  it('AC-IN-001: renders seeded incidents with type, severity + status badges', () => {
    renderPage();
    expect(screen.getByText('Near Miss')).toBeInTheDocument();
    expect(screen.getByText('Equipment Damage')).toBeInTheDocument();
    // severity badge
    expect(screen.getAllByText('Low').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Critical').length).toBeGreaterThan(0);
    // status badge
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Investigating').length).toBeGreaterThan(0);
  });

  it('AC-IN-001: the status filter narrows the visible rows', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /^Investigating$/ }));
    expect(screen.queryByText('Near Miss')).not.toBeInTheDocument();
    expect(screen.getByText('Equipment Damage')).toBeInTheDocument();
  });

  it('AC-IN-001: search filters rows by type/location', async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText(/Search incidents/i), 'spill');
    expect(screen.queryByText('Near Miss')).not.toBeInTheDocument();
    expect(screen.getByText('Spill')).toBeInTheDocument();
  });

  it('AC-IN-001: each severity renders a DISTINCT tinted pill (Low/High/Critical differentiated)', () => {
    renderPage();
    const pillCls = (label: string, rowType: string) => {
      const row = screen.getByText(rowType).closest('tr')!;
      return within(row).getByText(label).closest('span')!.className;
    };
    const low = pillCls('Low', 'Near Miss');
    const high = pillCls('High', 'Equipment Damage');
    const critical = pillCls('Critical', 'Spill');
    // Low is the quiet neutral; High = warn (amber); Critical = destructive (red).
    expect(high).toContain('bg-warning/18');
    expect(critical).toContain('bg-destructive/10');
    expect(low).not.toBe(high);
    expect(high).not.toBe(critical);
  });
});

describe('Incidents index — states', () => {
  it('AC-IN-001: loading skeleton while pending', () => {
    listState.isPending = true;
    renderPage();
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('AC-IN-001: error state with retry', async () => {
    listState.isError = true;
    renderPage();
    const retry = screen.getByRole('button', { name: /Retry/i });
    await userEvent.click(retry);
    expect(listState.refetch).toHaveBeenCalled();
  });

  it('AC-IN-001: empty state teaches with a gated File incident action', () => {
    listState.data = [];
    renderPage('Engineer');
    expect(screen.getByText(/No incidents/i)).toBeInTheDocument();
    // even Engineer (any member) can file → the empty-state action is present
    expect(screen.getAllByRole('button', { name: /File incident/i }).length).toBeGreaterThan(0);
  });
});

describe('Incidents — RBAC affordance gating (AC-IN-007)', () => {
  it('AC-IN-007: Engineer can File incident but sees NO investigate/close/delete row actions', async () => {
    renderPage('Engineer');
    // ANY member can file (reporter server-stamped)
    expect(screen.getByRole('button', { name: /File incident/i })).toBeInTheDocument();
    // Engineer is not a manager → no row write menu on an Open incident
    const openRow = screen.getByText('Near Miss').closest('tr')!;
    expect(within(openRow).queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
  });

  it('AC-IN-007: PM (manager) can advance an Open incident to Investigating', async () => {
    renderPage('Project Manager');
    const openRow = screen.getByText('Near Miss').closest('tr')!;
    await userEvent.click(within(openRow).getByRole('button', { name: /Row actions/i }));
    expect(screen.getByRole('menuitem', { name: /Start investigating/i })).toBeInTheDocument();
    // PM is not Admin → no Delete
    expect(screen.queryByRole('menuitem', { name: /Delete/i })).not.toBeInTheDocument();
  });

  it('AC-IN-007: Finance (non-manager) sees no investigate/close row actions', () => {
    renderPage('Finance');
    expect(screen.getByRole('button', { name: /File incident/i })).toBeInTheDocument();
    const openRow = screen.getByText('Near Miss').closest('tr')!;
    expect(within(openRow).queryByRole('button', { name: /Row actions/i })).not.toBeInTheDocument();
  });

  it('AC-IN-007: a Closed incident exposes no further status transition', async () => {
    renderPage('Admin');
    const closedRow = screen.getByText('Spill').closest('tr')!;
    await userEvent.click(within(closedRow).getByRole('button', { name: /Row actions/i }));
    // Closed is terminal: no Start investigating / Close incident transitions
    expect(screen.queryByRole('menuitem', { name: /Start investigating/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Close incident/i })).not.toBeInTheDocument();
    // Admin still has Delete on a closed row
    expect(screen.getByRole('menuitem', { name: /Delete/i })).toBeInTheDocument();
  });
});

describe('Incidents — File incident form (AC-IN-003)', () => {
  it('AC-IN-003: File incident opens the modal; blank required fields keep submit disabled (F8 readiness)', async () => {
    renderPage('Engineer');
    await userEvent.click(screen.getByRole('button', { name: /File incident/i }));
    const dialog = screen.getByRole('dialog');
    // F8 (AC-IXD-FORM-F8): the blank required date + type disable submit, so the user
    // cannot silently submit a blank form and no create mutation fires. The modal's own
    // submit shares the "File incident" verb-object label; scope to the dialog.
    const submit = within(dialog).getByRole('button', { name: /^File incident$/i });
    expect(submit).toBeDisabled();
    await userEvent.click(submit);
    expect(mutations.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-IN-003: a valid file submits the form fields to the mutation (org_id/status server-stamped)', async () => {
    renderPage('Engineer');
    await userEvent.click(screen.getByRole('button', { name: /File incident/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Date/i), '2026-06-08');
    await userEvent.type(within(dialog).getByLabelText(/Type/i), 'Near Miss');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Severity/i), 'Medium');
    await userEvent.type(within(dialog).getByLabelText(/Location/i), 'Site C');
    await userEvent.type(within(dialog).getByLabelText(/Description/i), 'Slippery floor');
    await userEvent.click(within(dialog).getByRole('button', { name: /^File incident$/i }));
    await waitFor(() =>
      expect(mutations.create.mutateAsync).toHaveBeenCalledWith({
        incident_date: '2026-06-08',
        type: 'Near Miss',
        severity: 'Medium',
        location: 'Site C',
        description: 'Slippery floor',
      }),
    );
  });

  it('AC-IN-003: a file rejected by RLS (42501) surfaces a classified warning toast', async () => {
    mutations.create.mutateAsync.mockRejectedValue(new AppError('not permitted', '42501'));
    renderPage('Engineer');
    await userEvent.click(screen.getByRole('button', { name: /File incident/i }));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Date/i), '2026-06-08');
    await userEvent.type(within(dialog).getByLabelText(/Type/i), 'Spill');
    await userEvent.selectOptions(within(dialog).getByLabelText(/Severity/i), 'High');
    await userEvent.click(within(dialog).getByRole('button', { name: /^File incident$/i }));
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/don't have permission/i);
  });
});

describe('Incidents — status workflow (AC-IN-004)', () => {
  it('AC-IN-004: Start investigating routes through a confirm and calls transition(Investigating)', async () => {
    renderPage('Admin');
    const openRow = screen.getByText('Near Miss').closest('tr')!;
    await userEvent.click(within(openRow).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Start investigating/i }));
    // confirm dialog appears; mutation not yet called
    expect(mutations.transition.mutateAsync).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /Start investigating/i }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'i1', status: 'Investigating' }),
    );
  });

  it('AC-IN-004: Close incident on an Investigating row routes through a confirm and calls transition(Closed)', async () => {
    renderPage('Admin');
    const invRow = screen.getByText('Equipment Damage').closest('tr')!;
    await userEvent.click(within(invRow).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Close incident/i }));
    await userEvent.click(screen.getByRole('button', { name: /Close incident/i }));
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({ id: 'i2', status: 'Closed' }),
    );
  });

  it('AC-IN-004: a transition rejected by RLS (42501) surfaces a classified warning toast', async () => {
    mutations.transition.mutateAsync.mockRejectedValue(new AppError('not permitted', '42501'));
    renderPage('Admin');
    const openRow = screen.getByText('Near Miss').closest('tr')!;
    await userEvent.click(within(openRow).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Start investigating/i }));
    await userEvent.click(screen.getByRole('button', { name: /Start investigating/i }));
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/don't have permission/i);
  });
});

describe('Incidents — delete (AC-IN-005)', () => {
  it('AC-IN-005: Delete routes through a destructive confirm and calls remove', async () => {
    renderPage('Admin');
    const openRow = screen.getByText('Near Miss').closest('tr')!;
    await userEvent.click(within(openRow).getByRole('button', { name: /Row actions/i }));
    await userEvent.click(screen.getByRole('menuitem', { name: /Delete/i }));
    await userEvent.click(screen.getByRole('button', { name: /Delete incident/i }));
    await waitFor(() => expect(mutations.remove.mutateAsync).toHaveBeenCalledWith('i1'));
  });
});

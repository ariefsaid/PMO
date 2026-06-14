import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';
import ProjectDetailHeader from '../ProjectDetailHeader';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

// Mutable real-role box + project mutations (hoisted) — drive the edit/archive/value gating.
const { roleBox, projectMutations } = vi.hoisted(() => ({
  roleBox: { value: 'Project Manager' },
  projectMutations: {
    create: { mutateAsync: vi.fn(), isPending: false },
    updateHeader: { mutateAsync: vi.fn(), isPending: false },
    archive: { mutateAsync: vi.fn(), isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
    setContractValue: { mutateAsync: vi.fn(), isPending: false },
  },
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProjectMutations: () => projectMutations,
  useClientCompanies: () => ({ data: [{ id: 'c2', name: 'Innovate Corp', type: 'Client' }] }),
  useProjectManagers: () => ({ data: [{ id: 'u-alice', full_name: 'Alice Manager' }] }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u-alice', org_id: 'org-1' }, role: roleBox.value }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: roleBox.value, realRole: roleBox.value, canImpersonate: false, viewAs: vi.fn() }),
}));

const onHand = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'PRJ-001',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  contract_value: 5000000,
  budget: 4700000,
  spent: 2100000,
  start_date: '2026-01-01',
  end_date: '2026-12-18',
  contract_date: '2026-01-10',
  customer_contract_ref: 'CPO-2026-001',
  client: { name: 'Innovate Corp' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

const preWin = { ...onHand, status: 'Leads', customer_contract_ref: null } as ProjectWithRefs;

const renderHeader = (role = 'Project Manager', project: ProjectWithRefs = onHand, committedSpend = 2_100_000) => {
  roleBox.value = role;
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectDetailHeader project={project} committedSpend={committedSpend} />
      </ToastProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  roleBox.value = 'Project Manager';
  Object.values(projectMutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
});

describe('ProjectDetailHeader — content', () => {
  it('renders the project name + StatusPill + customer + mono code + Customer PO ref (AC-G)', () => {
    renderHeader();
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
    expect(screen.getByText(/Innovate Corp · PRJ-001 · PO CPO-2026-001/)).toBeInTheDocument();
  });

  it('renders a 5-stat strip with contract/actual figures (AC-G)', () => {
    renderHeader();
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('Actual')).toBeInTheDocument();
    expect(screen.getByText('On-hand margin')).toBeInTheDocument();
    expect(screen.getAllByText('$5,000,000').length).toBeGreaterThan(0);
    expect(screen.getByText('$2,900,000')).toBeInTheDocument();
  });

  it('shows a negative committed margin with a true minus glyph and destructive tone (edge)', () => {
    renderHeader('Project Manager', onHand, 6_000_000);
    expect(screen.getByText(/−\$1,000,000/)).toBeInTheDocument();
  });

  it('C3: renders no disabled "Edit Project" stub action', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: /Edit Project/i })).toBeNull();
  });

  it('CW-3a: the Project detail opens with the shared RecordHeader (icon + name + status + action zone)', () => {
    renderHeader();
    const header = screen.getByTestId('record-header');
    expect(header).toBeInTheDocument();
    // identity + status live in the one shared header
    expect(within(header).getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    expect(within(header).getByText('Ongoing Project')).toBeInTheDocument();
    // the standardized top-right action zone holds the record actions (Edit, etc.)
    expect(within(header).getByTestId('record-header-actions')).toBeInTheDocument();
  });
});

// ── AC-PRJ-004 edit-header / AC-PRJ-005 archive gating ───────────────────────
describe('ProjectDetailHeader — Edit + Archive affordances (gating)', () => {
  it('AC-PRJ-004: a delivery role (PM) sees the header Edit action', () => {
    renderHeader('Project Manager');
    expect(screen.getByRole('button', { name: /^Edit$/i })).toBeInTheDocument();
  });

  it('AC-PRJ-004: Finance does NOT see Edit (FE stricter than RLS)', () => {
    renderHeader('Finance');
    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
  });

  it('AC-PRJ-004: Engineer does NOT see Edit', () => {
    renderHeader('Engineer');
    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
  });

  it('AC-PRJ-005: Executive sees Archive (archive = Admin·Exec)', () => {
    renderHeader('Executive');
    expect(screen.getByRole('button', { name: /Archive/i })).toBeInTheDocument();
  });

  it('AC-PRJ-005: PM does NOT see Archive (archive = Admin·Exec)', () => {
    renderHeader('Project Manager');
    expect(screen.queryByRole('button', { name: /Archive/i })).not.toBeInTheDocument();
  });

  it('AC-PRJ-007: Admin sees the hard-Delete action', () => {
    renderHeader('Admin');
    expect(screen.getByRole('button', { name: /^Delete$/i })).toBeInTheDocument();
  });

  it.each(['Executive', 'Project Manager', 'Finance', 'Engineer'])(
    'AC-PRJ-007: %s does NOT see the hard-Delete action (Admin-only)',
    (role) => {
      renderHeader(role);
      expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument();
    },
  );

  it('AC-PRJ-007: Delete routes through a destructive confirm and calls the delete mutation (nothing on a single click)', async () => {
    renderHeader('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^Delete$/i }));
    // Nothing is deleted on the trigger click — only after the confirm.
    expect(projectMutations.remove.mutateAsync).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /delete project/i }));
    await waitFor(() => expect(projectMutations.remove.mutateAsync).toHaveBeenCalledWith('p1'));
  });

  it('AC-PRJ-007: a referenced-project delete (23503) surfaces a classified warning toast, suggesting Archive', async () => {
    projectMutations.remove.mutateAsync.mockRejectedValue(new AppError('referenced', '23503'));
    renderHeader('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^Delete$/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /delete project/i }));
    const toast = await screen.findByRole('status');
    expect(toast).toBeInTheDocument();
  });

  it('AC-PRJ-004: Edit opens the edit-header modal pre-filled with the project name', async () => {
    renderHeader('Admin');
    await userEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByDisplayValue('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
  });

  it('AC-PRJ-005: Archive routes through a destructive confirm and calls the archive mutation', async () => {
    renderHeader('Executive');
    await userEvent.click(screen.getByRole('button', { name: /Archive/i }));
    // The mutation is NOT called until the confirm is pressed (nothing writes on a single click).
    expect(projectMutations.archive.mutateAsync).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Archive project/i }));
    await waitFor(() => expect(projectMutations.archive.mutateAsync).toHaveBeenCalledWith('p1'));
  });
});

// ── AC-PRJ-006 contract_value SoD (ADR-0019) ─────────────────────────────────
describe('ProjectDetailHeader — contract_value SoD treatment', () => {
  // Model B (ADR-0020, AC-IXD-PROJ-004): a pre-win (pipeline) deal renders the PipelineLens,
  // NOT the delivery header — so the delivery contract-value SoD editor (and the StatTiles
  // spend summary) are not mounted on a pre-win record. The deal's value is captured at
  // create-time and surfaced as the PipelineLens "Value" stat; the on-hand SoD lock/edit
  // distinction (the goal-oracle) is asserted on the on-hand record below.
  it('AC-IXD-PROJ-004: PRE-WIN, the delivery contract-value editor + spend summary are NOT mounted', () => {
    renderHeader('Project Manager', preWin);
    expect(screen.queryByTestId('contract-value-sod')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit contract value/i })).not.toBeInTheDocument();
    // the delivery StatTiles strip (Contract / Committed / Actual / margin / Spend) is gone too
    expect(screen.queryByText('On-hand margin')).not.toBeInTheDocument();
  });

  it('AC-PRJ-006: on a WON/on-hand project, a PM sees the value as READ-ONLY (locked), no edit control', () => {
    renderHeader('Project Manager', onHand);
    expect(screen.getByText(/Read-only/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit contract value/i })).not.toBeInTheDocument();
  });

  it('AC-PRJ-006: on a WON/on-hand project, Finance CAN edit the value (money authority)', () => {
    renderHeader('Finance', onHand);
    expect(screen.getByRole('button', { name: /Edit contract value/i })).toBeInTheDocument();
    expect(screen.queryByText(/Read-only/i)).not.toBeInTheDocument();
  });

  it('AC-PRJ-006: editing the value on a WON project commits through an audit confirm naming the SoD', async () => {
    renderHeader('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    const input = screen.getByRole('textbox', { name: /Contract value/i });
    await userEvent.clear(input);
    await userEvent.type(input, '5140000');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    // Audit confirm appears; the RPC is NOT called until confirmed.
    expect(projectMutations.setContractValue.mutateAsync).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog');
    expect(confirm).toHaveTextContent(/segregation of duties/i);
    await userEvent.click(within(confirm).getByRole('button', { name: /record/i }));
    await waitFor(() =>
      expect(projectMutations.setContractValue.mutateAsync).toHaveBeenCalledWith({ id: 'p1', value: 5140000 }),
    );
  });

  it('polish#4: the inline editor shows formatted thousands ($5,000,000) on open, not the raw number', async () => {
    renderHeader('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    const input = screen.getByRole('textbox', { name: /Contract value/i }) as HTMLInputElement;
    // On open the draft reads the formatted figure, NOT the raw "5000000".
    expect(input.value).toBe('5,000,000');
  });

  it('polish#4: typing reformats with thousands separators while editing', async () => {
    renderHeader('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    const input = screen.getByRole('textbox', { name: /Contract value/i }) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '5140000');
    // The visible value is grouped; the committed number is still unformatted.
    expect(input.value).toBe('5,140,000');
  });

  it('AC-PRJ-006: an RPC SoD rejection (42501) surfaces a classified warning toast', async () => {
    projectMutations.setContractValue.mutateAsync.mockRejectedValue(new AppError('not authorized', '42501'));
    renderHeader('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    const input = screen.getByRole('textbox', { name: /Contract value/i });
    await userEvent.clear(input);
    await userEvent.type(input, '99');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: /record/i }));
    const toast = await screen.findByRole('status');
    expect(toast).toHaveTextContent(/don't have permission/i);
  });
});

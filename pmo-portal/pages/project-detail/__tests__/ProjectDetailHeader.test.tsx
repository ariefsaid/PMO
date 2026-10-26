import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import { AppError } from '@/src/lib/appError';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import ProjectDetailHeader from '../ProjectDetailHeader';
import { currencySymbol } from '@/src/lib/format';
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
// VAT editability comes from the scoped server reader, never an invoice list in the UI.
const { vatBox } = vi.hoisted(() => ({ vatBox: { data: { eligible: true, reason: null as string | null, hasInvoices: false }, isPending: false, isFetching: false, isError: false, refetch: vi.fn() } }));
vi.mock('@/src/hooks/useProjectVatEditability', () => ({ useProjectVatEditability: () => vatBox }));
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
vi.mock('../../../components/ProjectStatusControl', () => ({
  default: ({ triggerVariant }: { triggerVariant?: string }) => React.createElement('button', {
    type: 'button',
    'aria-label': 'Change status',
    'data-variant': triggerVariant ?? 'outline',
  }, 'Change status'),
}));

const onHand = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'CLIENT-81',
  pmo_project_number: 'PMO-26-7711',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  // ⚑ THE BACKFILL ARTIFACT, present on purpose (DD-TAX-2). 0197 wrote 'exclusive' onto EVERY
  // existing project, so a stored marker on an old row may be something nobody chose. Without it
  // on this fixture the assertion below cannot fail — seeding the editor from the row would look
  // identical to leaving it empty, which is exactly how DD-TAX-2's only guard went dead.
  tax_treatment: 'exclusive',
  tax_amount: 550000,
  contract_value: 5000000,
  currency: 'USD',
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

const renderHeader = (role = 'Project Manager', project: ProjectWithRefs = onHand) => {
  roleBox.value = role;
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ProjectDetailHeader project={project} />
      </ToastProvider>
    </MemoryRouter>,
  );
};

const renderHeaderWithMore = async (role = 'Project Manager', project: ProjectWithRefs = onHand) => {
  const view = renderHeader(role, project);
  const moreActions = screen.queryByText('More actions');
  if (moreActions) await userEvent.click(moreActions);
  return view;
};

beforeEach(() => {
  setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
  roleBox.value = 'Project Manager';
  vatBox.data = { eligible: true, reason: null, hasInvoices: false };
  vatBox.isPending = false;
  vatBox.isFetching = false;
  vatBox.isError = false;
  vatBox.refetch.mockReset();
  Object.values(projectMutations).forEach((m) => {
    m.mutateAsync.mockReset();
    m.mutateAsync.mockResolvedValue(undefined);
    m.isPending = false;
  });
});
afterEach(() => resetActiveLocale());

describe('ProjectDetailHeader — content', () => {
  it('UIP-006: contract editing remains reachable from the identity header and cancel makes no write', async () => {
    await renderHeaderWithMore('Finance', onHand);
    expect(screen.queryByText(/Changing the value on a won project/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    expect(screen.getByRole('textbox', { name: /Contract value/i })).toHaveValue('5,000,000');
    expect(screen.getByText(/Changing the value on a won project/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Cancel$/i }));
    expect(screen.queryByText('$5,000,000')).not.toBeInTheDocument();
    expect(projectMutations.setContractValue.mutateAsync).not.toHaveBeenCalled();
  });
  it('PA-02: keeps customer, PM and dates in the scope line and PO details after the section content', async () => {
    renderHeader();
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
    const scope = screen.getByRole('group', { name: 'Project scope' });
    expect(scope).toHaveTextContent('Innovate Corp');
    expect(scope).toHaveTextContent('PM: Alice Manager');
    expect(scope).toHaveTextContent('Jan 1, 2026 – Dec 18, 2026');
    expect(screen.queryByText(/PO CPO-2026-001/)).not.toBeInTheDocument();
    expect(screen.queryByText('More project details')).not.toBeInTheDocument();
    expect(screen.queryByText(/PMO-26-7711/)).not.toBeInTheDocument();
  });

  it('C3: renders no disabled "Edit Project" stub action', () => {
    renderHeader();
    expect(screen.queryByRole('button', { name: /Edit Project/i })).toBeNull();
  });

  it('H-09: delivery and pipeline headers show the full identity when a short name exists', () => {
    const delivery = { ...onHand, short_name: 'Harbor Operations' } as ProjectWithRefs;
    const pipeline = { ...preWin, short_name: 'Tender package' } as ProjectWithRefs;
    const { rerender } = renderHeader('Project Manager', delivery);
    const deliveryHeader = within(screen.getByTestId('record-header'));
    expect(deliveryHeader.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toHaveTextContent('Innovate Corp HQ Fit-Out');
    expect(deliveryHeader.queryByTitle('Innovate Corp HQ Fit-Out')).not.toBeInTheDocument();
    expect(deliveryHeader.queryByRole('heading', { name: 'Harbor Operations' })).not.toBeInTheDocument();
    rerender(<MemoryRouter><ToastProvider><ProjectDetailHeader project={pipeline} /></ToastProvider></MemoryRouter>);
    const pipelineHeader = within(screen.getByTestId('record-header'));
    expect(pipelineHeader.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toHaveTextContent('Innovate Corp HQ Fit-Out');
    expect(pipelineHeader.queryByRole('heading', { name: 'Tender package' })).not.toBeInTheDocument();
    rerender(<MemoryRouter><ToastProvider><ProjectDetailHeader project={onHand} /></ToastProvider></MemoryRouter>);
    expect(within(screen.getByTestId('record-header')).getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
  });

  it('R-002: leaves route return to the shared frame and links the customer parent', () => {
    roleBox.value = 'Project Manager';
    render(
      <MemoryRouter initialEntries={[{
        pathname: '/projects/p1',
        state: { pmoListReturn: { list: 'sales', path: '/sales?stage=Tender+Submitted&view=table', scrollTop: 265 } },
      }] }>
        <ToastProvider><ProjectDetailHeader project={preWin} /></ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /Back to (?:Sales Pipeline|Projects)/i })).not.toBeInTheDocument();
    const header = screen.getByTestId('record-header');
    expect(within(header).getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Project scope' })).getByRole('link', { name: 'Innovate Corp' }))
      .toHaveAttribute('href', '/companies/c2');
  });

  it('R-002: keeps route return out of the identity header for pipeline and delivery stages', () => {
    const projectContext = { pmoListReturn: { list: 'projects', path: '/projects?status=Leads' } };
    const { rerender } = render(
      <MemoryRouter initialEntries={[{ pathname: '/projects/p1', state: projectContext }] }>
        <ToastProvider><ProjectDetailHeader project={preWin} /></ToastProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /Back to (?:Sales Pipeline|Projects)/i })).not.toBeInTheDocument();

    rerender(<MemoryRouter><ToastProvider><ProjectDetailHeader project={preWin} /></ToastProvider></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /Back to (?:Sales Pipeline|Projects)/i })).not.toBeInTheDocument();

    rerender(<MemoryRouter><ToastProvider><ProjectDetailHeader project={onHand} /></ToastProvider></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /Back to (?:Sales Pipeline|Projects)/i })).not.toBeInTheDocument();
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

  it('PA-04 keeps Edit visible in the title action row and status transitions in More actions', async () => {
    renderHeader();
    const more = screen.getByText('More actions').closest('details');
    expect(more).not.toHaveAttribute('open');
    expect(within(screen.getByTestId('record-header-actions')).getByRole('button', { name: /^Edit$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change status' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByText('More actions'));
    expect(more).toHaveAttribute('open');
    expect(within(more!).queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change status' })).toBeInTheDocument();
  });

  it('PA-04 gives Finance an available Overview transition as the primary title action', () => {
    roleBox.value = 'Finance';
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProjectDetailHeader project={onHand} isOverview />
        </ToastProvider>
      </MemoryRouter>,
    );
    const actions = screen.getByTestId('record-header-actions');
    const status = within(actions).getByRole('button', { name: 'Change status' });
    expect(status).toHaveAttribute('data-variant', 'primary');
    expect(status.closest('details')).toBeNull();
    expect(within(actions).getByText('More actions')).toBeInTheDocument();
  });
});

// ── AC-PRJ-004 edit-header / AC-PRJ-005 archive gating ───────────────────────
describe('ProjectDetailHeader — Edit + Archive affordances (gating)', () => {
  it('AC-PRJ-004: a delivery role (PM) sees the header Edit action', async () => {
    await renderHeaderWithMore('Project Manager', onHand);
    expect(screen.getByRole('button', { name: /^Edit$/i })).toBeInTheDocument();
  });

  it('AC-PRJ-004: Finance does NOT see Edit (FE stricter than RLS)', async () => {
    await renderHeaderWithMore('Finance', onHand);
    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
  });

  it('AC-PRJ-004: Engineer does NOT see Edit', async () => {
    await renderHeaderWithMore('Engineer', onHand);
    expect(screen.queryByRole('button', { name: /^Edit$/i })).not.toBeInTheDocument();
  });

  it('AC-PRJ-005: Executive sees Archive (archive = Admin·Exec)', async () => {
    await renderHeaderWithMore('Executive', onHand);
    expect(screen.getByText('Archive', { exact: true }).closest('summary')).toBeInTheDocument();
  });

  it('AC-PRJ-005: PM does NOT see Archive (archive = Admin·Exec)', async () => {
    await renderHeaderWithMore('Project Manager', onHand);
    expect(screen.queryByText('Archive', { exact: true })).not.toBeInTheDocument();
  });

  it('AC-PRJ-007: Admin sees hard Delete only after opening the Archive menu', async () => {
    await renderHeaderWithMore('Admin', onHand);
    expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument();
    const archiveMenu = screen.getByText('Archive', { exact: true }).closest('details')!;
    await userEvent.click(within(archiveMenu).getByText('Archive', { exact: true }));
    expect(within(archiveMenu!).getByRole('button', { name: /^Delete$/i })).toBeInTheDocument();
  });

  it.each(['Executive', 'Project Manager', 'Finance', 'Engineer'])(
    'AC-PRJ-007: %s does NOT see the hard-Delete action (Admin-only)',
    async (role) => {
      await renderHeaderWithMore(role, onHand);
      expect(screen.queryByRole('button', { name: /^Delete$/i })).not.toBeInTheDocument();
    },
  );

  it('AC-PRJ-007: Delete routes through a destructive confirm and calls the delete mutation (nothing on a single click)', async () => {
    await renderHeaderWithMore('Admin', onHand);
    const archiveMenu = screen.getByText('Archive', { exact: true }).closest('details')!;
    await userEvent.click(within(archiveMenu).getByText('Archive', { exact: true }));
    await userEvent.click(within(archiveMenu).getByRole('button', { name: /^Delete$/i }));
    // Nothing is deleted on the trigger click — only after the confirm.
    expect(projectMutations.remove.mutateAsync).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /delete project/i }));
    await waitFor(() => expect(projectMutations.remove.mutateAsync).toHaveBeenCalledWith('p1'));
  });

  it('AC-PRJ-007: a referenced-project delete (23503) surfaces a classified warning toast, suggesting Archive', async () => {
    projectMutations.remove.mutateAsync.mockRejectedValue(new AppError('referenced', '23503'));
    await renderHeaderWithMore('Admin', onHand);
    const archiveMenu = screen.getByText('Archive', { exact: true }).closest('details')!;
    await userEvent.click(within(archiveMenu).getByText('Archive', { exact: true }));
    await userEvent.click(within(archiveMenu).getByRole('button', { name: /^Delete$/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /delete project/i }));
    const toast = await findToastAnnouncement('alert', /Still in use|Archive/i);
    expect(toast).toBeInTheDocument();
  });

  it('AC-PRJ-004: Edit delegates to the shared page-level edit flow host', async () => {
    const onEditProject = vi.fn();
    roleBox.value = 'Admin';
    render(
      <MemoryRouter>
        <ToastProvider>
          <ProjectDetailHeader project={onHand} onEditProject={onEditProject} />
        </ToastProvider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: /^Edit$/i }));
    expect(onEditProject).toHaveBeenCalledTimes(1);
  });

  it('AC-PRJ-005: Archive routes through a destructive confirm and calls the archive mutation', async () => {
    await renderHeaderWithMore('Executive', onHand);
    const archiveMenu = screen.getByText('Archive', { exact: true }).closest('details')!;
    await userEvent.click(within(archiveMenu).getByText('Archive', { exact: true }));
    // The mutation is NOT called until the confirm is pressed (nothing writes on a single click).
    expect(projectMutations.archive.mutateAsync).not.toHaveBeenCalled();
    await userEvent.click(within(archiveMenu).getByRole('button', { name: /^Archive project$/i }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: /Archive project/i }));
    await waitFor(() => expect(projectMutations.archive.mutateAsync).toHaveBeenCalledWith('p1'));
  });
});

/**
 * #513: a contract value may not be restated without restating its tax basis (migration 0197's RPC
 * demands it on EVERY set). The journey therefore gained a step — the GOAL these tests assert (the
 * value reaching the SoD RPC behind an audit confirm) is unchanged; only the steps to reach it are.
 */
async function stateTaxBasis() {
  await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'exclusive');
  await userEvent.type(screen.getByLabelText(/tax amount/i), '565400');
}

// ── AC-PRJ-006 contract_value SoD (ADR-0019) ─────────────────────────────────
describe('ProjectDetailHeader — contract_value SoD treatment', () => {
  // Model B (ADR-0020, AC-IXD-PROJ-004): a pre-win (pipeline) deal renders the PipelineLens,
  // NOT the delivery header — so the delivery contract-value SoD editor (and the StatTiles
  // spend summary) are not mounted on a pre-win record. The deal's value is captured at
  // create-time and surfaced as the PipelineLens "Value" stat; the on-hand SoD lock/edit
  // distinction (the goal-oracle) is asserted on the on-hand record below.
  it('AC-IXD-PROJ-004: PRE-WIN, the delivery contract-value editor + spend summary are NOT mounted', async () => {
    await renderHeaderWithMore('Project Manager', preWin);
    expect(screen.queryByTestId('contract-value-sod')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit contract value/i })).not.toBeInTheDocument();
    // the delivery StatTiles strip (Contract / Committed / Actual / margin / Spend) is gone too
    expect(screen.queryByText('On-hand margin')).not.toBeInTheDocument();
  });

  it('AC-PRJ-006: on a WON/on-hand project, a PM sees the value as READ-ONLY (locked), no edit control', async () => {
    await renderHeaderWithMore('Project Manager', onHand);
    expect(screen.queryByRole('button', { name: /Edit contract value/i })).not.toBeInTheDocument();
  });

  it('AC-PRJ-006: on a WON/on-hand project, Finance CAN edit the value (money authority)', async () => {
    await renderHeaderWithMore('Finance', onHand);
    expect(screen.getByRole('button', { name: /Edit contract value/i })).toBeInTheDocument();
    expect(screen.queryByText(/Read-only/i)).not.toBeInTheDocument();
  });

  it('AC-PRJ-006: editing the value on a WON project commits through an audit confirm naming the SoD', async () => {
    await renderHeaderWithMore('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    const input = screen.getByRole('textbox', { name: /Contract value/i });
    await userEvent.clear(input);
    await userEvent.type(input, '5140000');
    await stateTaxBasis();
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    // Audit confirm appears; the RPC is NOT called until confirmed.
    expect(projectMutations.setContractValue.mutateAsync).not.toHaveBeenCalled();
    const confirm = await screen.findByRole('dialog');
    expect(confirm).toHaveTextContent(/segregation of duties/i);
    await userEvent.click(within(confirm).getByRole('button', { name: /record/i }));
    await waitFor(() =>
      expect(projectMutations.setContractValue.mutateAsync).toHaveBeenCalledWith({
        id: 'p1',
        value: 5140000,
        taxTreatment: 'exclusive',
        taxAmount: 565400,
        taxRate: null, taxBaseNumerator: 1, taxBaseDenominator: 1,
      }),
    );
  });

  it('AC-PLC-009: does not open SoD confirmation for an en-US value with excess precision', async () => {
    setActiveLocale({ locale: 'en', numberLocale: 'en-US', timezone: 'UTC' });
    await renderHeaderWithMore('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    await userEvent.clear(screen.getByRole('textbox', { name: /Contract value/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /Contract value/i }), '1.234');
    await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'exclusive');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '0');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    expect(await screen.findByText(/valid|decimal/i, { selector: 'span[role="alert"]' })).toHaveTextContent(/valid|decimal/i);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(projectMutations.setContractValue.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-PLC-009: records id-ID grouped contract value as 1234 after SoD confirmation', async () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    await renderHeaderWithMore('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    await userEvent.clear(screen.getByRole('textbox', { name: /Contract value/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /Contract value/i }), '1.234');
    await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'exclusive');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '0');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: /record/i }));

    await waitFor(() =>
      expect(projectMutations.setContractValue.mutateAsync).toHaveBeenCalledWith({
        id: 'p1', value: 1234, taxTreatment: 'exclusive', taxAmount: 0,
        taxRate: null, taxBaseNumerator: 1, taxBaseDenominator: 1,
      }),
    );
  });

  // ── #513: the ceiling may not be restated without restating what it means ──
  it('#513: Save is blocked until the tax treatment is chosen, and the reason is on screen', async () => {
    await renderHeaderWithMore('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    await userEvent.type(screen.getByLabelText(/tax amount/i), '565400');
    // A value is present and the tax amount is stated, but nobody has said what the value MEANS.
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeDisabled();
    expect(screen.getByTestId('contract-tax-required-hint')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'exclusive');
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeEnabled();
    expect(screen.queryByTestId('contract-tax-required-hint')).not.toBeInTheDocument();
  });

  it('#513: the treatment select opens with NOTHING chosen — never the backfilled value', async () => {
    // 0197 backfilled every existing row to 'exclusive' to keep the arithmetic inert. Pre-selecting
    // from the row would re-assert a marker no human ever stated — the defect, not the fix.
    await renderHeaderWithMore('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    expect((screen.getByLabelText(/tax treatment/i) as HTMLSelectElement).value).toBe('');
    expect(screen.getByRole('button', { name: /^Save$/i })).toBeDisabled();
  });

  it('#513: the SoD confirm names the basis the new value is stated on, not just the number', async () => {
    await renderHeaderWithMore('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    const input = screen.getByRole('textbox', { name: /Contract value/i });
    await userEvent.clear(input);
    await userEvent.type(input, '5140000');
    await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'inclusive');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '509000');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    const confirm = await screen.findByRole('dialog');
    // ⚑ The basis now renders as the SAME label every other money figure uses ("incl. PPN"),
    // not the raw `inclusive` enum — #575, because interpolating the English column value drops
    // an untranslated word into an Indonesian sentence. The GOAL of this test is unchanged: the
    // confirm must name the basis the new value is stated on. Asserting the OPPOSITE basis is
    // absent is what keeps it an oracle rather than a substring sighting — a confirm that always
    // said "excl. PPN" would otherwise pass.
    expect(confirm).toHaveTextContent(/incl\. PPN/i);
    expect(confirm).not.toHaveTextContent(/excl\. PPN/i);
    expect(confirm).toHaveTextContent(/509,000/);
  });

  it('polish#4: the inline editor shows formatted thousands ($5,000,000) on open, not the raw number', async () => {
    await renderHeaderWithMore('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    const input = screen.getByRole('textbox', { name: /Contract value/i }) as HTMLInputElement;
    // On open the draft reads the formatted figure, NOT the raw "5000000".
    expect(input.value).toBe('5,000,000');
  });

  it('polish#4: typing reformats with thousands separators while editing', async () => {
    await renderHeaderWithMore('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    const input = screen.getByRole('textbox', { name: /Contract value/i }) as HTMLInputElement;
    await userEvent.clear(input);
    await userEvent.type(input, '5140000');
    // The visible value is grouped; the committed number is still unformatted.
    expect(input.value).toBe('5,140,000');
  });

  it('AC-PRJ-006: an RPC SoD rejection (42501) surfaces a classified warning toast', async () => {
    projectMutations.setContractValue.mutateAsync.mockRejectedValue(new AppError('not authorized', '42501'));
    await renderHeaderWithMore('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    const input = screen.getByRole('textbox', { name: /Contract value/i });
    await userEvent.clear(input);
    await userEvent.type(input, '99');
    await stateTaxBasis();
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    const confirm = await screen.findByRole('dialog');
    await userEvent.click(within(confirm).getByRole('button', { name: /record/i }));
    const toast = await findToastAnnouncement('alert', /don't have permission/i);
    expect(toast).toHaveTextContent(/don't have permission/i);
  });
});

describe('#694 ProjectDetailHeader — contract-value adornment is the project currency', () => {
  const idrProject = { ...onHand, currency: 'IDR' } as ProjectWithRefs;
  const adornmentOf = (label: RegExp) => screen.getByLabelText(label).parentElement!.textContent;

  it('#694: an IDR project shows the IDR glyph beside Contract value and Tax amount, never $', async () => {
    await renderHeaderWithMore('Finance', idrProject);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    expect(adornmentOf(/^Contract value/i)).toBe(currencySymbol('IDR'));
    expect(adornmentOf(/tax amount/i)).toBe(currencySymbol('IDR'));
    expect(adornmentOf(/^Contract value/i)).not.toContain('$');
  });

  it('#694: a USD project still shows $', async () => {
    await renderHeaderWithMore('Finance', onHand);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
    expect(adornmentOf(/^Contract value/i)).toBe('$');
  });
});

describe('OD-TAX-4 / #856: the project VAT flag in the contract-value editor', () => {
  const openEditor = async (role: string, project: ProjectWithRefs = onHand) => {
    await renderHeaderWithMore(role, project);
    await userEvent.click(screen.getByRole('button', { name: /Edit contract value/i }));
  };

  it('AC-856-9 Finance sees the flag (on by default) and can switch it off with the value', async () => {
    await openEditor('Finance');
    const flag = screen.getByRole('checkbox', { name: /Subject to VAT/i });
    expect(flag).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(flag);
    await userEvent.clear(screen.getByRole('textbox', { name: /Contract value/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /Contract value/i }), '100');
    await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'exclusive');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '0');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /record/i }));
    await waitFor(() =>
      expect(projectMutations.setContractValue.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1', subjectToVat: false })),
    );
  });

  it('AC-856-9 an Executive edits the value but is not offered the flag', async () => {
    await openEditor('Executive');
    expect(screen.queryByRole('checkbox', { name: /Subject to VAT/i })).not.toBeInTheDocument();
  });

  it('AC-PPNC-013 a live invoice disables the VAT flag with a clear reason', async () => {
    vatBox.data = { eligible: false, reason: 'vat-live-invoice', hasInvoices: true };
    await openEditor('Finance');
    expect(screen.getByRole('checkbox', { name: /Subject to VAT/i })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('contract-vat-flag-hint')).toHaveTextContent(/invoice that is not cancelled/i);
  });

  it('AC-PPNC-014 stale-save refusal retains the selected flag, shows one stable remedy, refetches, and never succeeds', async () => {
    projectMutations.setContractValue.mutateAsync.mockRejectedValueOnce(new AppError('diagnostic text', '42501', 'vat-live-invoice'));
    await openEditor('Finance');
    await userEvent.click(screen.getByRole('checkbox', { name: /Subject to VAT/i }));
    await userEvent.clear(screen.getByRole('textbox', { name: /Contract value/i }));
    await userEvent.type(screen.getByRole('textbox', { name: /Contract value/i }), '100');
    await userEvent.selectOptions(screen.getByLabelText(/tax treatment/i), 'exclusive');
    await userEvent.type(screen.getByLabelText(/tax amount/i), '0');
    await userEvent.click(screen.getByRole('button', { name: /^Save$/i }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /record/i }));
    const remedy = await findToastAnnouncement('alert', /PPN was not changed.*invoice state changed/i);
    expect(remedy).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Subject to VAT/i })).toHaveAttribute('aria-checked', 'false');
    expect(vatBox.refetch).toHaveBeenCalled();
    expect(screen.queryByText(/Contract value updated/i)).not.toBeInTheDocument();
  });

  it('AC-PPNC-013 loading and unavailable reader states fail closed while preserving the stored flag', async () => {
    vatBox.isPending = true;
    await openEditor('Finance');
    expect(screen.getByRole('checkbox', { name: /Subject to VAT/i })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('contract-vat-flag-hint')).toHaveTextContent(/checking whether PPN can be changed/i);
  });
});

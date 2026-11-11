import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, act, waitFor, cleanup } from '@testing-library/react';
import { toast as sonnerToast } from 'sonner';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { findToastAnnouncement } from '@/src/components/ui/__tests__/toastTestQueries';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { AppError } from '@/src/lib/appError';

// The BoardDnd seam: jsdom cannot drive dnd-kit sensors, so the test captures the controller's
// onMove / canDrop and calls them as a drop would. The real pointer path is proven in AC-DND-014.
const dnd = vi.hoisted(() => ({
  props: null as null | { onMove: (c: string, k: string) => void; canDrop: (c: string, k: string) => boolean; isHome: (c: string, k: string) => boolean },
}));
vi.mock('@/src/components/kanban/BoardDnd', () => ({
  BoardDnd: (p: { children: React.ReactNode; onMove: never; canDrop: never; isHome: never }) => { dnd.props = p; return <>{p.children}</>; },
  DroppableColumn: ({ children, testId }: { children: (s: undefined) => React.ReactNode; testId?: string }) => <div data-testid={testId}>{children(undefined)}</div>,
  DraggableCard: ({ children, moveState, disabled }: { children: React.ReactNode; moveState?: string | null; disabled?: boolean }) => (
    <div data-drag-state={moveState ?? undefined} data-drag-disabled={disabled ? 'true' : undefined}>{children}</div>
  ),
}));

let role = 'Project Manager';
const mutateAsync = vi.fn();
const eligibility = vi.fn(async (_id: string): Promise<string> => 'allowed');
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutateAsync, isPending: false, erpSetupPending: false }),
  winEligibilityQueryOptions: (_u: unknown, id: string) => ({ queryKey: ['wel', id], queryFn: () => eligibility(id), staleTime: 0 }),
}));
vi.mock('@/src/auth/useAuth', () => ({
  useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1', role, manager_id: null } }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: role, realRole: role, canImpersonate: false, viewAs: vi.fn() }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

import DraggableSalesBoard from '../DraggableSalesBoard';

// The toast library's store replays still-active toasts into the next provider — clear them.
afterEach(() => {
  act(() => { sonnerToast.dismiss(); });
});


const deal = (id: string, status: PipelineProject['status']): PipelineProject => ({
  id, name: `${id} deal`, short_name: null, client_name: 'Acme', status,
  contract_value: 1000, currency: 'USD', tax_treatment: 'exclusive', win_probability: 0.4,
});
const projects = [deal('won', 'Won, Pending KoM'), deal('negotiation2', 'Negotiation'), deal('leads', 'Leads'), deal('quotation', 'Quotation Submitted'), deal('tender', 'Tender Submitted'), deal('negotiation', 'Negotiation')];

let qc: QueryClient;
const renderBoard = (rows: PipelineProject[] = projects) => render(
  <QueryClientProvider client={qc}>
    <ToastProvider><DraggableSalesBoard projects={rows} onOpen={vi.fn()} /></ToastProvider>
  </QueryClientProvider>,
);
const drop = (id: string, col: string) => act(async () => { dnd.props!.onMove(id, col); });
const inColumn = (col: string, id: string) => within(screen.getByTestId(col)).queryByText(`${id} deal`);

beforeEach(() => {
  vi.clearAllMocks();
  role = 'Project Manager';
  mutateAsync.mockResolvedValue({ erpSetupPending: false });
  eligibility.mockResolvedValue('allowed');
  qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

describe('DraggableSalesBoard', () => {
  it("AC-DND-002: Leads → Pre-Qualification is refused: no request, card stays in Leads, refusal message shown", async () => {
    renderBoard();
    await drop('leads', 'stage-PQ Submitted');
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(inColumn('stage-Leads', 'leads')).toBeInTheDocument();
    expect(await screen.findByText("leads deal can't move from Leads to PQ submitted.")).toBeInTheDocument();
  });

  it('AC-DND-003: Quotation → Pre-Qualification opens the menu confirm; Cancel snaps back with no write; Confirm writes once', async () => {
    const user = userEvent.setup();
    renderBoard();
    await drop('quotation', 'stage-PQ Submitted');
    expect(await screen.findByText('Move project to PQ Submitted?')).toBeInTheDocument();
    expect(inColumn('stage-PQ Submitted', 'quotation')).toBeInTheDocument();
    expect(inColumn('stage-PQ Submitted', 'quotation')!.closest('[data-drag-state]')).toHaveAttribute('data-drag-state', 'held');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(inColumn('stage-Quotation Submitted', 'quotation')).toBeInTheDocument());
    expect(mutateAsync).not.toHaveBeenCalled();

    await drop('quotation', 'stage-PQ Submitted');
    await user.click(await screen.findByRole('button', { name: 'Move to PQ Submitted' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ id: 'quotation', to: 'PQ Submitted', opts: undefined });
  });

  it('AC-DND-004: Negotiation → Won with eligibility allowed opens the win form; submit needs ref and date', async () => {
    const user = userEvent.setup();
    renderBoard();
    await drop('negotiation', 'stage-Won');
    expect(await screen.findByText('Record the won project')).toBeInTheDocument();
    const submit = screen.getByRole('button', { name: 'Confirm won' });
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText('Customer contract ref'), 'CPO-1');
    await user.type(screen.getByLabelText('Contract date'), '2026-11-01');
    await user.click(submit);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'negotiation', to: 'Won, Pending KoM', opts: { customerContractRef: 'CPO-1', contractDate: '2026-11-01' },
    });
  });

  it('AC-DND-004: cancelling the win form returns the card to Negotiation with nothing written', async () => {
    const user = userEvent.setup();
    renderBoard();
    await drop('negotiation', 'stage-Won');
    await screen.findByText('Record the won project');
    expect(inColumn('stage-Won', 'negotiation')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(inColumn('stage-Negotiation', 'negotiation')).toBeInTheDocument());
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it.each([
    ['reviewer_required', 'Ask your supervisor or a more senior reviewer to confirm the value before winning this project.'],
    ['inactive_reviewer', 'Ask an active supervisor or a more senior reviewer to confirm the value.'],
    ['unavailable', 'Win eligibility is unavailable. Refresh this page and try again.'],
    ['ERROR', 'Win eligibility is unavailable. Refresh this page and try again.'],
  ])('AC-DND-005: a non-allowed or failed eligibility check (%s) snaps back with the menu message', async (decision, message) => {
    if (decision === 'ERROR') eligibility.mockRejectedValue(new Error('boom'));
    else eligibility.mockResolvedValue(decision);
    renderBoard();
    await drop('negotiation', 'stage-Won');
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.queryByText('Record the won project')).toBeNull();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(inColumn('stage-Negotiation', 'negotiation')).toBeInTheDocument();
  });

  it('AC-DND-006: Tender → Lost needs a choice between Loss Tender and Declined', async () => {
    const user = userEvent.setup();
    renderBoard();
    await drop('tender', 'stage-Lost');
    expect(await screen.findByText('Mark project as lost')).toBeInTheDocument();
    const confirm = screen.getByRole('button', { name: 'Mark lost' });
    expect(confirm).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Lost' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Declined' })).not.toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Declined' }));
    expect(confirm).toBeDisabled();
    await user.selectOptions(screen.getByRole('combobox', { name: /Reason/i }), 'capacity');
    expect(confirm).toBeEnabled();
    await user.click(confirm);
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({
      id: 'tender',
      to: 'Declined',
      opts: { lostReason: 'capacity', lostNote: undefined },
    });
  });

  it('AC-DND-007: a server refusal rolls the card back and shows "Status change failed" with the server message', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValueOnce(new Error('Illegal transition'));
    renderBoard();
    await drop('quotation', 'stage-PQ Submitted');
    await user.click(await screen.findByRole('button', { name: 'Move to PQ Submitted' }));
    expect(await screen.findByText('Status change failed')).toBeInTheDocument();
    expect(screen.getByText('Illegal transition')).toBeInTheDocument();
    await waitFor(() => expect(inColumn('stage-Quotation Submitted', 'quotation')).toBeInTheDocument());
  });

  it('AC-PLN-010: reviving a lost project at the active-project cap shows localized limit guidance', async () => {
    mutateAsync.mockRejectedValueOnce(
      new AppError('project_limit_reached: the starter plan allows 25 active projects', 'PL002'),
    );
    renderBoard([...projects, deal('lost-project', 'Loss Tender')]);

    await drop('lost-project', 'stage-Negotiation');
    await userEvent.click(await screen.findByRole('button', { name: 'Move to Negotiation' }));

    const toast = await findToastAnnouncement('alert', /active-project limit/i);
    expect(toast).toHaveTextContent(/active-project limit/i);
    expect(toast).toHaveTextContent(/project was not restored/i);
    expect(toast).not.toHaveTextContent(/project_limit_reached/);
    await waitFor(() => expect(inColumn('stage-Lost', 'lost-project')).toBeInTheDocument());
  });

  it('AC-DND-008: on success the card stays in the target column (saving) until the pipeline queries refetch', async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const spy = vi.spyOn(qc, 'invalidateQueries').mockImplementation(() => gate);
    renderBoard();
    await drop('quotation', 'stage-PQ Submitted');
    await user.click(await screen.findByRole('button', { name: 'Move to PQ Submitted' }));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    const card = inColumn('stage-PQ Submitted', 'quotation')!.closest('[data-drag-state]');
    expect(card).toHaveAttribute('data-drag-state', 'saving');
    expect(inColumn('stage-Quotation Submitted', 'quotation')).toBeNull();
    await act(async () => { release(); await gate; });
    // (the mocked mutation refetches nothing, so the card settles back on its server column)
    await waitFor(() => expect(document.querySelector('[data-drag-state]')).toBeNull());
    for (const root of ['sales-pipeline', 'won-deals', 'lost-deals'])
      expect(spy).toHaveBeenCalledWith({ queryKey: [root, 'o1'] }, { cancelRefetch: false });
  });

  it('AC-DND-012: canDrop mirrors resolveProjectDrop', () => {
    renderBoard();
    expect(dnd.props!.canDrop('leads', 'stage-PQ Submitted')).toBe(false);
    expect(dnd.props!.canDrop('quotation', 'stage-PQ Submitted')).toBe(true);
    expect(dnd.props!.canDrop('leads', 'stage-Leads')).toBe(false);
    expect(dnd.props!.canDrop('tender', 'stage-Lost')).toBe(true);
  });

  it('FR-DND-016: a card is draggable only when its status has a legal target', () => {
    renderBoard();
    expect(within(screen.getByTestId('stage-Leads')).getByText('leads deal').closest('[data-drag-disabled]')).toBeNull();
  });

  it('AC-DND-004: a rejected win keeps the form open with the typed details and shows the error inside it, not a toast', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValueOnce(new Error('Illegal transition'));
    renderBoard();
    await drop('negotiation', 'stage-Won');
    await user.type(await screen.findByLabelText('Customer contract ref'), 'CPO-1');
    await user.type(screen.getByLabelText('Contract date'), '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Confirm won' }));
    const form = await screen.findByRole('dialog');
    expect(await within(form).findByRole('alert')).toHaveTextContent('Illegal transition');
    expect(screen.queryByText('Status change failed')).toBeNull();
    expect(screen.getByLabelText('Customer contract ref')).toHaveValue('CPO-1');
    expect(screen.getByLabelText('Contract date')).toHaveValue('2026-11-01');
    // the card stays held in Won until the user cancels or retries
    expect(inColumn('stage-Won', 'negotiation')!.closest('[data-drag-state]')).toHaveAttribute('data-drag-state', 'held');

    mutateAsync.mockResolvedValueOnce({ erpSetupPending: false });
    await user.click(screen.getByRole('button', { name: 'Confirm won' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect(mutateAsync).toHaveBeenLastCalledWith({
      id: 'negotiation', to: 'Won, Pending KoM', opts: { customerContractRef: 'CPO-1', contractDate: '2026-11-01' },
    });
  });

  it('AC-DND-004: cancelling after a rejected win puts the card back in Negotiation', async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValueOnce(new Error('Illegal transition'));
    renderBoard();
    await drop('negotiation', 'stage-Won');
    await user.type(await screen.findByLabelText('Customer contract ref'), 'CPO-1');
    await user.type(screen.getByLabelText('Contract date'), '2026-11-01');
    await user.click(screen.getByRole('button', { name: 'Confirm won' }));
    await within(await screen.findByRole('dialog')).findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(inColumn('stage-Negotiation', 'negotiation')).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('AC-DND-008: the drop confirm stays open while the move saves, then closes', async () => {
    const user = userEvent.setup();
    let finish!: () => void;
    mutateAsync.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ erpSetupPending: false }); }));
    renderBoard();
    await drop('quotation', 'stage-PQ Submitted');
    await user.click(await screen.findByRole('button', { name: 'Move to PQ Submitted' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Move project to PQ Submitted?')).toBeInTheDocument();
    await act(async () => { finish(); });
    await waitFor(() => expect(screen.queryByText('Move project to PQ Submitted?')).toBeNull());
  });

  it('AC-DND-005: a second drop during the win-eligibility check is ignored and its card never leaves its column', async () => {
    let answer!: (d: string) => void;
    eligibility.mockImplementationOnce(() => new Promise<string>((resolve) => { answer = resolve; }));
    renderBoard();
    await drop('negotiation', 'stage-Won');
    await drop('quotation', 'stage-PQ Submitted');
    expect(screen.queryByText('Move project to PQ Submitted?')).toBeNull();
    expect(inColumn('stage-Quotation Submitted', 'quotation')).toBeInTheDocument();
    await act(async () => { answer('allowed'); });
    expect(await screen.findByText('Record the won project')).toBeInTheDocument();
    expect(inColumn('stage-Quotation Submitted', 'quotation')).toBeInTheDocument();
    expect(screen.queryByText('Move project to PQ Submitted?')).toBeNull();
  });

  it('AC-SETUP-001: the ERP-linking note shows after every win that needs it, including a second one', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({ erpSetupPending: true });
    renderBoard();
    const note = 'Project status saved. ERP linking needs attention; retry from the project page.';
    for (const id of ['negotiation', 'negotiation2']) {
      await drop(id, 'stage-Won');
      await user.type(await screen.findByLabelText('Customer contract ref'), 'CPO-1');
      await user.type(screen.getByLabelText('Contract date'), '2026-11-01');
      await user.click(screen.getByRole('button', { name: 'Confirm won' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    // Each win surfaces its own stacked note toast; the newest one is what's announced.
    await waitFor(() => expect(
      Array.from(document.querySelectorAll('[data-sonner-toast]')).filter((el) => (el.textContent ?? '').includes(note)),
    ).toHaveLength(2));
    expect(screen.getByRole('status')).toHaveTextContent(note);
  });

  it('AC-DND-012: the home column (and Won for a won deal) is not a drop target cue', () => {
    renderBoard();
    expect(dnd.props!.isHome('leads', 'stage-Leads')).toBe(true);
    expect(dnd.props!.isHome('won', 'stage-Won')).toBe(true);
    expect(dnd.props!.isHome('leads', 'stage-PQ Submitted')).toBe(false);
  });

  it('FR-DND-016: a card is not draggable without the transition permission or without a legal target', () => {
    renderBoard();
    const disabled = (id: string) => within(screen.getByTestId('stage-Leads')).queryByText(`${id} deal`)?.closest('[data-drag-disabled]');
    expect(disabled('leads')).toBeNull();
    cleanup();
    role = 'Viewer';
    renderBoard();
    expect(disabled('leads')).toHaveAttribute('data-drag-disabled', 'true');
    for (const id of ['tender', 'quotation', 'negotiation'])
      expect(screen.getAllByText(`${id} deal`)[0].closest('[data-drag-disabled]')).toHaveAttribute('data-drag-disabled', 'true');
  });

  it('AC-DND-017: the card menu "Move to" is the keyboard path and runs the same confirm: no write until Confirm', async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.click(screen.getByRole('button', { name: 'Actions for quotation deal' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Move to PQ submitted' }));
    expect(await screen.findByText('Move project to PQ Submitted?')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Move to PQ Submitted' }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ id: 'quotation', to: 'PQ Submitted', opts: undefined }));
  });

  it('AC-DND-017: "Move to Won" from the menu cannot bypass the win form: nothing is written until ref and date are entered', async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.click(screen.getAllByRole('button', { name: 'Actions for negotiation deal' })[0]);
    await user.click(await screen.findByRole('menuitem', { name: 'Move to Won' }));
    expect(await screen.findByText('Record the won project')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm won' })).toBeDisabled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-DND-017: the menu offers only moves the rules allow, and none without the transition permission', async () => {
    const user = userEvent.setup();
    renderBoard();
    await user.click(screen.getByRole('button', { name: 'Actions for leads deal' }));
    expect(await screen.findByRole('menuitem', { name: 'Move to Quotation submitted' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Move to PQ submitted' })).toBeNull();
    cleanup();
    role = 'Viewer';
    renderBoard();
    expect(screen.queryByRole('button', { name: /^Actions for/ })).toBeNull();
  });

  it('AC-DND-017: a card does not repeat its column as a stage chip, but a multi-status column keeps it', () => {
    renderBoard();
    const card = (col: string, id: string) => inColumn(col, id)!.closest('[data-testid="project-card"]') as HTMLElement;
    expect(within(card('stage-Leads', 'leads')).queryByText('Leads')).toBeNull();
    expect(within(card('stage-Won', 'won')).getByText(/pending kickoff/)).toBeInTheDocument();
  });
});

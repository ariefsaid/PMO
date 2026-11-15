import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { ApprovedSendFailure } from '@/src/lib/journals/approvedSendFailure';

const h = vi.hoisted(() => ({
  list: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
  details: {} as Record<string, unknown>,
  setup: { data: { tier: 'odoo', desk_journal_id: '7', needs_desk_journal: false } as unknown },
  listArgs: [] as unknown[][],
  saveDraft: vi.fn(), submit: vi.fn(), approve: vi.fn(), returnToMaker: vi.fn(), reverse: vi.fn(), post: vi.fn(),
  me: 'u-other',
  role: 'Finance' as Role,
  mayApprove: undefined as boolean | undefined,
}));
const mutation = (fn: (...a: unknown[]) => unknown) => ({ mutateAsync: fn, isPending: false });
vi.mock('@/src/hooks/useJournals', () => ({
  useJournals: (from: string, to: string) => { h.listArgs.push([from, to]); return h.list; },
  useJournal: (id: string | null) => ({ data: id ? h.details[id] : undefined, isPending: id !== null && !(id in h.details), isError: false, refetch: vi.fn() }),
  useJournalLedgerSetup: () => h.setup,
  useMayApproveJournal: () => ({ data: h.mayApprove }),
  useSaveJournalDraft: () => mutation(h.saveDraft),
  useSubmitJournal: () => mutation(h.submit),
  useApproveJournal: () => mutation(h.approve),
  useReturnJournal: () => mutation(h.returnToMaker),
  useRequestJournalReversal: () => mutation(h.reverse),
  usePostJournal: () => mutation(h.post),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjectPickerOptions: () => ({ data: [{ id: 'p1', name: 'Site Alpha', short_name: null }], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/hooks/useOrgToday', () => ({ useOrgToday: () => '2026-11-15' }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.me, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role, effectiveRole: h.role }) }));

import JournalsPage from './Journals';

const row = (over: Record<string, unknown> = {}) => ({
  origin: 'pmo', id: 'j1', kind: 'fee', date: '2026-11-10', memo: 'Bank fee November', status: 'submitted',
  maker_id: 'u-maker', approver_id: null, ledger_name: null, external_record_id: null, posted_date: null,
  held_reason: null, return_reason: null, reverses_journal_id: null, total: '25000.00', ...over,
});
const detail = (over: Record<string, unknown> = {}, authors = ['u-maker'], original: string[] = []) => ({
  entry: {
    id: 'j1', kind: 'fee', entry_date: '2026-11-10', memo: 'Bank fee November', status: 'submitted', maker_id: 'u-maker',
    approver_id: null, approved_at: null, return_reason: null, reverses_journal_id: null, reversal_reason: null,
    external_record_id: null, external_name: null, posted_date: null, held_reason: null, ...over,
  },
  lines: [
    { id: 'l1', journal_id: 'j1', line_no: 1, account: '6100 Bank charges', debit: '25000.00', credit: '0.00', partner_company_id: null, project_id: null, label: 'Fee' },
    { id: 'l2', journal_id: 'j1', line_no: 2, account: '1010 Bank', debit: '0.00', credit: '25000.00', partner_company_id: null, project_id: null, label: '' },
  ],
  authorIds: authors,
  originalAuthorIds: original,
});
const renderPage = () => render(<MemoryRouter><ToastProvider><JournalsPage /></ToastProvider></MemoryRouter>);
const openRow = async (name: RegExp) => { await userEvent.click(screen.getByRole('button', { name })); return screen.findByRole('dialog'); };

beforeEach(() => {
  h.me = 'u-other';
  h.role = 'Finance';
  h.mayApprove = undefined;
  h.list = { data: [row()], isPending: false, isError: false, refetch: vi.fn() };
  h.details = { j1: detail() };
  h.setup = { data: { tier: 'odoo', desk_journal_id: '7', needs_desk_journal: false } };
  h.listArgs.length = 0;
  for (const fn of [h.saveDraft, h.submit, h.approve, h.returnToMaker, h.reverse, h.post]) fn.mockReset();
});

describe('/journals (#895)', () => {
  it('lists the current organisation month by default', () => {
    renderPage();
    expect(h.listArgs[0]).toEqual(['2026-11-01', '2026-11-30']);
    expect(screen.getByRole('row', { name: /Bank fee November/ })).toBeInTheDocument();
  });

  it('FR-MJE-021 Approve and Return are offered to a second approver', async () => {
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Return' })).toBeInTheDocument();
  });

  it('FR-MJE-021 Approve and Return are hidden for the maker', async () => {
    h.me = 'u-maker';
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    expect(within(drawer).getByRole('heading', { name: 'Bank fee November' })).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Return' })).toBeNull();
  });

  it('FR-MJE-021 Approve is hidden for an editor who is not the maker', async () => {
    h.me = 'u-editor';
    h.details = { j1: detail({}, ['u-maker', 'u-editor']) };
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('FR-MJE-021 a reversal is not offered for approval to the original\'s author', async () => {
    h.me = 'u-orig';
    h.details = { j1: detail({ reverses_journal_id: 'j0', reversal_reason: 'posted twice' }, ['u-maker'], ['u-orig']) };
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('AC-MJE-002 the sole active member is offered Approve on their own journal, and told why', async () => {
    h.me = 'u-maker';
    h.mayApprove = true;
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    expect(within(drawer).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(within(drawer).getByText(/only member of this organisation/)).toBeInTheDocument();
  });

  it('AC-MJE-002 the maker is not offered Approve once the server says a second approver is needed', async () => {
    h.me = 'u-maker';
    h.mayApprove = false;
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(within(drawer).queryByText(/only member of this organisation/)).toBeNull();
  });

  it('a fractional line amount keeps its cents and carries the currency', async () => {
    h.details = { j1: detail() };
    (h.details.j1 as { lines: Array<Record<string, unknown>> }).lines[0].debit = '25000.50';
    (h.details.j1 as { lines: Array<Record<string, unknown>> }).lines[1].credit = '25000.50';
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    const lines = within(drawer).getAllByRole('row');
    expect(lines.some((r) => /IDR\s25,000\.50/.test(r.textContent ?? ''))).toBe(true);
    h.details = { j1: detail() };
  });

  it('a whole-rupiah line reads without cents and with its currency', async () => {
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    const line = within(drawer).getByRole('row', { name: /Fee/ });
    expect(line.textContent).toMatch(/IDR\s25,000(?![.,]\d)/);
  });

  it('the new-journal footer holds Cancel, Save draft and Submit together', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New journal' }));
    const dialog = await screen.findByRole('dialog', { name: 'New journal' });
    const submit = within(dialog).getByRole('button', { name: 'Submit' });
    const footer = submit.parentElement as HTMLElement;
    expect(within(footer).getAllByRole('button').map((b) => b.textContent)).toEqual(['Cancel', 'Save draft', 'Submit']);
  });

  it('approving asks to confirm and then calls approve_journal', async () => {
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this journal?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.approve).toHaveBeenCalledWith('j1'));
  });

  it('editing a stored draft in Bahasa re-reads each amount without misreading the decimal point', async () => {
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    try {
      h.me = 'u-maker';
      const d = detail({ status: 'draft' });
      d.lines = [
        { ...d.lines[0], debit: '1000.50', credit: '0.00' },
        { ...d.lines[1], debit: '1500000.00', credit: '0.00' },
        { ...d.lines[1], id: 'l3', debit: '12.345', credit: '0.00' },
      ];
      h.details = { j1: d };
      h.list = { data: [row({ status: 'draft' })], isPending: false, isError: false, refetch: vi.fn() };
      renderPage();
      const drawer = await openRow(/Open Bank fee November/);
      await userEvent.click(within(drawer).getByRole('button', { name: 'Edit' }));
      const dialog = await screen.findByRole('dialog', { name: 'Edit journal' });
      const debit = (n: number) => (within(within(dialog).getByRole('group', { name: `Line ${n}` })).getByLabelText('Debit (IDR)') as HTMLInputElement).value;
      expect(debit(1)).toBe('1000,50');
      expect(debit(2)).toBe('1500000');
      expect(debit(3)).toBe('12,345');
    } finally {
      resetActiveLocale();
    }
  });

  it('a failed ledger send after approval offers Retry send, never Approve again', async () => {
    h.approve.mockRejectedValue(new ApprovedSendFailure(Object.assign(new Error('the ledger is unreachable'), { code: 'P0001' })));
    h.post.mockResolvedValue(undefined);
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Approve' }));
    const confirm = await screen.findByRole('dialog', { name: 'Approve this journal?' });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));
    const failed = await screen.findByRole('dialog', { name: 'Approved, but not sent' });
    expect(within(failed).getByText(/the ledger is unreachable/)).toBeInTheDocument();
    expect(within(failed).queryByRole('button', { name: 'Approve' })).toBeNull();
    await userEvent.click(within(failed).getByRole('button', { name: 'Retry send' }));
    await waitFor(() => expect(h.post).toHaveBeenCalledWith('j1'));
    expect(h.approve).toHaveBeenCalledTimes(1);
  });

  it('Return asks for a reason and sends it', async () => {
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Return' }));
    const dialog = await screen.findByRole('dialog', { name: 'Return journal' });
    await userEvent.type(within(dialog).getByRole('textbox'), 'Wrong fee account');
    await userEvent.click(within(dialog).getByRole('button', { name: /Return/ }));
    await waitFor(() => expect(h.returnToMaker).toHaveBeenCalledWith({ id: 'j1', reason: 'Wrong fee account' }));
  });

  it('AC-MJE-028 Needs a check shows the held reason', () => {
    h.list = { data: [row({ status: 'held', held_reason: 'The ledger answered with an unknown state' })], isPending: false, isError: false, refetch: vi.fn() };
    renderPage();
    const r = screen.getByRole('row', { name: /Bank fee November/ });
    expect(within(r).getByText('Needs a check')).toBeInTheDocument();
    expect(within(r).getByText('The ledger answered with an unknown state')).toBeInTheDocument();
  });

  it('AC-MJE-029 Scheduled never says Posted, in the list or the record', async () => {
    h.list = { data: [row({ status: 'scheduled', ledger_name: 'MISC/2026/0052', posted_date: '2026-12-01' })], isPending: false, isError: false, refetch: vi.fn() };
    h.details = { j1: detail({ status: 'scheduled', external_name: 'MISC/2026/0052', posted_date: '2026-12-01' }) };
    renderPage();
    const r = screen.getByRole('row', { name: /Bank fee November/ });
    expect(within(r).getByText('Scheduled')).toBeInTheDocument();
    expect(within(r).queryByText(/Posted/)).toBeNull();
    const drawer = await openRow(/Open Bank fee November/);
    expect(within(drawer).getByText('Scheduled')).toBeInTheDocument();
    expect(within(drawer).queryByText(/Posted/)).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Reverse' })).toBeNull();
  });

  it('AC-MJE-021 the running difference blocks submit at 100.00 against 99.99', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New journal' }));
    const dialog = await screen.findByRole('dialog', { name: 'New journal' });
    await userEvent.type(within(dialog).getByLabelText(/Memo/), 'Bank fee');
    const line1 = within(dialog).getByRole('group', { name: 'Line 1' });
    const line2 = within(dialog).getByRole('group', { name: 'Line 2' });
    await userEvent.type(within(line1).getByLabelText('Account'), '6100');
    await userEvent.type(within(line1).getByLabelText('Debit (IDR)'), '100.00');
    await userEvent.type(within(line2).getByLabelText('Account'), '1010');
    await userEvent.type(within(line2).getByLabelText('Credit (IDR)'), '99.99');
    expect(within(dialog).getByText(/^Difference: IDR\s0\.01$/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Submit' })).toBeDisabled();
    await userEvent.clear(within(line2).getByLabelText('Credit (IDR)'));
    await userEvent.type(within(line2).getByLabelText('Credit (IDR)'), '100.00');
    expect(within(dialog).getByText(/^Difference: IDR\s0\.00$/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Submit' })).toBeEnabled();
  });

  it('Submit saves the draft with exact amounts, then submits it', async () => {
    h.saveDraft.mockResolvedValue('j-new');
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New journal' }));
    const dialog = await screen.findByRole('dialog', { name: 'New journal' });
    await userEvent.type(within(dialog).getByLabelText(/Memo/), 'Bank fee');
    const line1 = within(dialog).getByRole('group', { name: 'Line 1' });
    const line2 = within(dialog).getByRole('group', { name: 'Line 2' });
    await userEvent.type(within(line1).getByLabelText('Account'), '6100');
    await userEvent.type(within(line1).getByLabelText('Debit (IDR)'), '25,000.50');
    await userEvent.type(within(line2).getByLabelText('Account'), '1010');
    await userEvent.type(within(line2).getByLabelText('Credit (IDR)'), '25000.5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(h.submit).toHaveBeenCalledWith('j-new'));
    expect(h.saveDraft).toHaveBeenCalledWith({
      id: null, kind: 'fee', date: '2026-11-15', memo: 'Bank fee',
      lines: [
        { account: '6100', debit: '25000.50', credit: '0.00', label: '' },
        { account: '1010', debit: '0.00', credit: '25000.50', label: '' },
      ],
    });
  });

  it('a refused submit keeps the dialog open and says why', async () => {
    h.saveDraft.mockResolvedValue('j-new');
    h.submit.mockRejectedValue(Object.assign(new Error('account 6100 is archived in the ledger'), { code: 'P0001' }));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New journal' }));
    const dialog = await screen.findByRole('dialog', { name: 'New journal' });
    await userEvent.type(within(dialog).getByLabelText(/Memo/), 'Bank fee');
    const line1 = within(dialog).getByRole('group', { name: 'Line 1' });
    const line2 = within(dialog).getByRole('group', { name: 'Line 2' });
    await userEvent.type(within(line1).getByLabelText('Account'), '6100');
    await userEvent.type(within(line1).getByLabelText('Debit (IDR)'), '10');
    await userEvent.type(within(line2).getByLabelText('Account'), '1010');
    await userEvent.type(within(line2).getByLabelText('Credit (IDR)'), '10');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    expect(await within(dialog).findByText('account 6100 is archived in the ledger')).toBeInTheDocument();
    // a second try replaces the same draft rather than creating another
    await userEvent.click(within(dialog).getByRole('button', { name: 'Submit' }));
    await waitFor(() => expect(h.saveDraft).toHaveBeenCalledTimes(2));
    expect(h.saveDraft.mock.calls[1][0]).toMatchObject({ id: 'j-new' });
  });

  it('FR-MJE-024 the setup notice shows when an Admin still has to choose the Odoo desk journal', () => {
    h.setup = { data: { tier: 'odoo', desk_journal_id: null, needs_desk_journal: true } };
    renderPage();
    expect(screen.getByText(/An Admin must choose the Odoo journal for desk entries in Odoo setup before journals can post/)).toBeInTheDocument();
  });

  it('the setup notice is absent once the desk journal is chosen', () => {
    renderPage();
    expect(screen.queryByText(/An Admin must choose the Odoo journal/)).toBeNull();
  });

  it('a posted PMO journal can be reversed with a date and a reason', async () => {
    h.list = { data: [row({ status: 'posted', ledger_name: 'MISC/2026/0052' })], isPending: false, isError: false, refetch: vi.fn() };
    h.details = { j1: detail({ status: 'posted', external_name: 'MISC/2026/0052', posted_date: '2026-11-10' }) };
    h.reverse.mockResolvedValue('j-rev');
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Reverse' }));
    const confirm = await screen.findByRole('dialog', { name: 'Reverse this journal?' });
    await userEvent.type(within(confirm).getByLabelText(/Reason/), 'Posted twice');
    await userEvent.click(within(confirm).getByRole('button', { name: 'Draft the reversal' }));
    await waitFor(() => expect(h.reverse).toHaveBeenCalledWith({ id: 'j1', date: '2026-11-15', reason: 'Posted twice' }));
  });

  it('FR-MJE-022 a journal the ledger has not confirmed (Needs a check) can be sent to the ledger again', async () => {
    h.list = { data: [row({ status: 'held', held_reason: 'the ledger did not answer' })], isPending: false, isError: false, refetch: vi.fn() };
    h.details = { j1: detail({ status: 'held', held_reason: 'the ledger did not answer' }) };
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    await userEvent.click(within(drawer).getByRole('button', { name: 'Send to the ledger' }));
    expect(h.post).toHaveBeenCalledWith('j1');
  });

  it('FR-MJE-022 a draft or a posted journal is not offered a send', async () => {
    renderPage();
    const drawer = await openRow(/Open Bank fee November/);
    expect(within(drawer).queryByRole('button', { name: 'Send to the ledger' })).toBeNull();
  });

  it('a ledger move made outside PMO is read-only', async () => {
    h.list = { data: [row({ origin: 'outside-pmo', id: null, kind: null, status: 'posted', memo: 'Year-end accrual', ledger_name: 'MISC/2026/0040' })], isPending: false, isError: false, refetch: vi.fn() };
    renderPage();
    const r = screen.getByRole('row', { name: /Year-end accrual/ });
    expect(within(r).getByText('Outside PMO')).toBeInTheDocument();
    const drawer = await openRow(/Open Year-end accrual/);
    expect(within(drawer).queryByRole('button', { name: 'Reverse' })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('a failed list read shows the error state', () => {
    h.list = { data: undefined, isPending: false, isError: true, refetch: vi.fn() };
    renderPage();
    expect(screen.getByText("Couldn't load journals")).toBeInTheDocument();
  });
});

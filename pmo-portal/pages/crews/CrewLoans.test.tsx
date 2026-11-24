import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { ToastProvider } from '@/src/components/ui';
import { formatDay } from '@/src/lib/format';
import { uncoveredLoanDays } from '@/src/lib/crewLoanCoverage';
import crewsEn from '@/public/locales/en/crews.json';
import crewsId from '@/public/locales/id/crews.json';

/** AC-LOAN-010 — the loans card: off means nothing renders; on shows loans; only a crew manager lends. */
const h = vi.hoisted(() => ({
  enabled: false, canManage: true, lend: vi.fn().mockResolvedValue(undefined), endLoan: vi.fn().mockResolvedValue(undefined),
  loans: [{ id: 'l1', worker_id: 'w1', home_crew_id: 'a', host_crew_id: 'b', valid_from: '2999-01-01', valid_to: '2999-01-05', version: 1 }] as unknown[],
  schedule: [] as unknown[],
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Admin', effectiveRole: 'Admin' }) }));
vi.mock('@/src/hooks/useCrews', () => ({
  useCrews: () => ({ data: [{ id: 'a', code: 'A1', name: 'Home crew', archived_at: null }, { id: 'b', code: 'B1', name: 'Host crew', archived_at: null }] }),
  useCrewSchedule: (crewId: string | null) => ({ data: crewId === 'b' ? h.schedule : [] }),
  useCrewWorkers: () => ({ data: [{ id: 'w1', display_name: 'Lent Worker' }] }),
  useCrewMembers: (crewId: string | null) => ({ data: crewId === 'a' ? [{ id: 'm1', crew_id: 'a', worker_id: 'w1', valid_from: '2000-01-01', valid_to: null }] : [] }),
}));
vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => ({ data: h.enabled }) }));
vi.mock('@/src/hooks/useCrewLoans', () => ({
  useSupervisorLoanCrews: () => ({ data: [] }),
  useCrewLoans: () => ({ data: h.loans, isPending: false, isError: false }),
  useCrewLoanMutations: () => ({ lend: { mutateAsync: h.lend }, endLoan: { mutateAsync: h.endLoan } }),
}));
import { CrewLoans } from './CrewLoans';

const view = () => render(<ToastProvider><CrewLoans /></ToastProvider>);

/** Open the lend modal and fill home crew, person, host crew and a three-day span (2–4 Mar 2026). Every control is
 *  looked up inside the real lend dialog: the loans table behind it legitimately carries `From`/`To` column headers. */
const fillLoanSpan = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getAllByRole('button', { name: /Lend worker|Pinjamkan pekerja/ })[0]);
  const dialog = screen.getByRole('dialog');
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /Home crew|Kru asal/ }), 'a');
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /Person|Pilih orang/ }), 'w1');
  await user.selectOptions(within(dialog).getByRole('combobox', { name: /Host crew|Kru tujuan/ }), 'b');
  // The end first, so the range is never inverted while both are typed; the field reads an ISO day on blur.
  const to = within(dialog).getByLabelText(/^To/);
  const from = within(dialog).getByLabelText(/^From/);
  await user.clear(to);
  await user.type(to, '2026-03-04');
  await user.tab();
  await user.clear(from);
  await user.type(from, '2026-03-02');
  await user.tab();
};

beforeAll(() => {
  i18next.addResourceBundle('en', 'crews', crewsEn, true, true);
  i18next.addResourceBundle('id', 'crews', crewsId, true, true);
});

describe('AC-LOAN-010 crew loans card', () => {
  beforeEach(() => { h.enabled = true; h.canManage = true; h.lend.mockClear(); h.endLoan.mockClear(); });
  afterEach(async () => { await i18next.changeLanguage('en'); h.schedule = []; });

  it('renders nothing while the setting is off (the Crews page is as it was)', () => {
    h.enabled = false;
    view();
    expect(screen.queryByText('Crew loans')).not.toBeInTheDocument();
    expect(screen.queryByTestId('crew-loans')).not.toBeInTheDocument();
  });

  it('lists the loans when on, and a non-manager sees no Lend action', () => {
    h.canManage = false;
    view();
    expect(screen.getByText('Lent Worker')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lend worker' })).not.toBeInTheDocument();
  });

  it('AC-SD-002: a non-manager sees who can lend', () => {
    h.canManage = false;
    view();
    expect(screen.getByTestId('crew-loans-who')).toHaveTextContent('Only people who manage crews');
  });

  it('AC-SD-002: refuses a loan when the host crew is on no work order, naming the crew', async () => {
    const user = userEvent.setup();
    h.schedule = [];
    view();
    await user.click(screen.getAllByRole('button', { name: 'Lend worker' })[0]);
    await user.selectOptions(screen.getByRole('combobox', { name: /Home crew/ }), 'a');
    await user.selectOptions(screen.getByRole('combobox', { name: /Person/ }), 'w1');
    await user.selectOptions(screen.getByRole('combobox', { name: /Host crew/ }), 'b');
    expect(screen.getByTestId('loan-host-coverage')).toHaveTextContent('Host crew is not on any work order');
    expect(screen.getByTestId('loan-host-coverage')).toHaveAttribute('role', 'alert');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lend worker' })).toBeDisabled();
  });

  it('AC-SD-002 a partly covered span is allowed and says those days stay on the home crew’s roster', async () => {
    const user = userEvent.setup();
    // The host crew is on a work order on 3 Mar only; the loan spans 2–4 Mar, so 2 and 4 Mar fall back to the home crew.
    h.schedule = [{ valid_from: '2026-03-03', valid_to: '2026-03-03' }];
    view();
    await fillLoanSpan(user);
    const note = screen.getByTestId('loan-host-coverage');
    expect(note).toHaveAttribute('role', 'status');
    const homeDays = uncoveredLoanDays('2026-03-02', '2026-03-04', h.schedule as { valid_from: string; valid_to: string | null }[]).map((d) => formatDay(d)).join(', ');
    expect(note).toHaveTextContent(`Host crew is not on any work order on ${homeDays}. On those days this person stays on the Home crew roster.`);
    expect(note).not.toHaveTextContent('no roster');
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lend worker' })).not.toBeDisabled();
  });

  it('AC-SD-002 the same partial case in Bahasa Indonesia names the home crew, not a missing roster', async () => {
    const user = userEvent.setup();
    h.schedule = [{ valid_from: '2026-03-03', valid_to: '2026-03-03' }];
    view();
    await fillLoanSpan(user);
    await i18next.changeLanguage('id');
    const note = screen.getByTestId('loan-host-coverage');
    await waitFor(() => expect(note).toHaveTextContent('Pada hari-hari itu, orang ini tetap tercatat di daftar hadir Home crew.'));
    expect(note).not.toHaveTextContent('tidak akan muncul di daftar hadir pada hari tersebut');
  });

  it('lends a worker from the home crew to another crew', async () => {
    const user = userEvent.setup();
    view();
    await user.click(screen.getAllByRole('button', { name: 'Lend worker' })[0]);
    await user.selectOptions(screen.getByRole('combobox', { name: /Home crew/ }), 'a');
    await user.selectOptions(screen.getByRole('combobox', { name: /Person/ }), 'w1');
    h.schedule = [{ valid_from: '2000-01-01', valid_to: null }];
    await user.selectOptions(screen.getByRole('combobox', { name: /Host crew/ }), 'b');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lend worker' }));
    await waitFor(() => expect(h.lend).toHaveBeenCalledWith(expect.objectContaining({ worker_id: 'w1', home_crew_id: 'a', host_crew_id: 'b' })));
  });
});

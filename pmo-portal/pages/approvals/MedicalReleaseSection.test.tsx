import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  role: 'Project Manager' as string, viewAs: null as string | null, canEnter: false, rows: [] as unknown[],
  decide: vi.fn(), create: vi.fn(), withdraw: vi.fn(), reassign: vi.fn(), state: { isError: false, isPending: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useMedicalRelease', () => ({
  useMedicalReleases: () => ({ data: h.state.isError || h.state.isPending ? undefined : h.rows, ...h.state }),
  useCanEnterRelease: () => h.canEnter,
  useReleasePeople: () => ({ data: [{ id: 'p1', name: 'Ana' }] }),
  useMedicalReleaseMutations: () => ({
    decide: { mutateAsync: h.decide, isPending: false }, create: { mutateAsync: h.create, isPending: false },
    withdraw: { mutateAsync: h.withdraw, isPending: false }, reassign: { mutateAsync: h.reassign, isPending: false },
  }),
}));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: (h.viewAs ?? h.role) as Role }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org1', role: h.role } }) }));

import { MedicalReleaseSection } from './MedicalReleaseSection';

const row = (o: Record<string, unknown> = {}) => ({
  id: 'r1', person_id: 'p1', person_name: 'Ana', release_date: '2026-11-20', status: 'Pending', note: null,
  decided_at: null, decision_note: null, can_decide: false, own: false, decider_active: true, ...o,
});
const page = () => render(<MemoryRouter><ToastProvider><MedicalReleaseSection /></ToastProvider></MemoryRouter>);

describe('medical release section (AC-MR-009)', () => {
  beforeEach(() => {
    h.role = 'Project Manager'; h.viewAs = null; h.canEnter = false; h.rows = []; h.state = { isError: false, isPending: false, refetch: vi.fn() };
    h.decide = vi.fn().mockResolvedValue(undefined); h.create = vi.fn().mockResolvedValue('r9');
    h.withdraw = vi.fn().mockResolvedValue(undefined); h.reassign = vi.fn().mockResolvedValue(undefined);
  });

  it('renders nothing when there is no release and the viewer cannot open one', () => {
    page();
    expect(screen.queryByRole('region', { name: 'Medical releases' })).toBeNull();
  });

  it('the direct manager approves: the row the database allows offers Approve and Defer', async () => {
    h.rows = [row({ can_decide: true })];
    page();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Approve' }));
    expect(h.decide).toHaveBeenCalledWith({ id: 'r1', decision: 'Approved', note: null });
    expect(screen.getByRole('button', { name: 'Defer' })).toBeInTheDocument();
  });

  it('deferring asks for a reason and sends it', async () => {
    const user = userEvent.setup();
    h.rows = [row({ can_decide: true })];
    page();
    await user.click(screen.getByRole('button', { name: 'Defer' }));
    await user.type(screen.getByRole('textbox'), 'needs a check');
    await user.click(screen.getAllByRole('button', { name: 'Defer' }).at(-1)!);
    expect(h.decide).toHaveBeenCalledWith({ id: 'r1', decision: 'Deferred', note: 'needs a check' });
  });

  it('a failed read shows an error with Retry instead of vanishing', async () => {
    h.state = { isError: true, isPending: false, refetch: vi.fn() };
    page();
    expect(screen.getByRole('region', { name: 'Medical releases' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.state.refetch).toHaveBeenCalled();
  });

  it('while the read is loading the section shows the loading state, not nothing', () => {
    h.state = { isError: false, isPending: true, refetch: vi.fn() };
    page();
    expect(screen.getByRole('region', { name: 'Medical releases' })).toBeInTheDocument();
    expect(screen.queryByText(/No release is waiting/)).toBeNull();
  });

  it('anyone else sees the state and who decides, with no buttons', () => {
    h.rows = [row()];
    page();
    expect(screen.getByText('Release pending')).toBeInTheDocument();
    expect(screen.getByText(/direct manager decides/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('a view-as session offers neither, even on a row the database allows', () => {
    h.viewAs = 'Admin'; h.canEnter = true; h.rows = [row({ can_decide: true })];
    page();
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Open a release' })).toBeNull();
  });

  it('the people team opens a release for a person and a date', async () => {
    const user = userEvent.setup();
    h.canEnter = true;
    page();
    expect(screen.getByText(/The people team opens one/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open a release' }));
    await user.selectOptions(screen.getByLabelText(/Person/), 'p1');
    await user.click(screen.getByRole('button', { name: 'Open release' }));
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ personId: 'p1', note: null }));
  });

  it('#1126 the return date starts on the organisation\'s day, not the browser\'s', async () => {
    const user = userEvent.setup();
    h.canEnter = true;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-30T18:00:00Z'));
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    try {
      page();
      await user.click(screen.getByRole('button', { name: 'Open a release' }));
      await user.selectOptions(screen.getByLabelText(/Person/), 'p1');
      await user.click(screen.getByRole('button', { name: 'Open release' }));
      expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ personId: 'p1', date: '2026-12-01', note: null }));
    } finally {
      resetActiveLocale();
      vi.useRealTimers();
    }
  });

  it('an Admin withdraws a waiting release with a reason (1934)', async () => {
    const user = userEvent.setup();
    h.role = 'Admin'; h.rows = [row()];
    page();
    await user.click(screen.getByRole('button', { name: 'Withdraw' }));
    await user.type(screen.getByRole('textbox'), 'opened with the wrong date');
    await user.click(screen.getAllByRole('button', { name: 'Withdraw' }).at(-1)!);
    expect(h.withdraw).toHaveBeenCalledWith({ id: 'r1', reason: 'opened with the wrong date' });
  });

  it('nobody is offered Withdraw on their own release, and a Project Manager is offered neither action', () => {
    h.role = 'Admin'; h.rows = [row({ own: true })];
    const { unmount } = page();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
    unmount();
    h.role = 'Project Manager'; h.rows = [row({ decider_active: false })];
    page();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Move to current manager' })).toBeNull();
  });

  it('an Admin moves a release to the current manager only once the fixed decider has left (1934)', async () => {
    h.role = 'Admin'; h.rows = [row()];
    const { unmount } = page();
    expect(screen.queryByRole('button', { name: 'Move to current manager' })).toBeNull();
    unmount();
    h.rows = [row({ decider_active: false })];
    page();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Move to current manager' }));
    expect(h.reassign).toHaveBeenCalledWith('r1');
  });
});

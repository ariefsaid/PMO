import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetActiveLocale, setActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';
import { ToastProvider } from '@/src/components/ui';

/** fix/walk-people item 5: "request leave or report sick" never starts on someone; with a choice to make, the person is picked. */
const h = vi.hoisted(() => ({ people: [] as Array<{ id: string; name: string; is_self: boolean }>, submit: vi.fn(), pending: false }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1', id: 'u1', role: 'Project Manager' } }) }));
vi.mock('@/src/hooks/useLeave', () => ({
  useLeaveSettings: () => ({ data: { enabled: true, approver_role: null } }),
  useLeaveTypes: () => ({ data: [{ id: 't1', name: 'Type A', archived_at: null }] }),
  useLeaveMutations: () => ({ submit: { mutateAsync: h.submit, isPending: false } }),
}));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@tanstack/react-query', async (orig) => {
  const m = await orig<typeof import('@tanstack/react-query')>();
  return { ...m, useQuery: () => ({ data: h.people, isPending: h.pending }) };
});
import { LeaveRequestForm } from './LeaveRequestForm';

const mount = () => render(<ToastProvider><LeaveRequestForm onClose={() => {}} /></ToastProvider>);

describe('LeaveRequestForm person default', () => {
  it('explains the person-record manager route and promises the result', () => {
    h.people = [{ id: 'p9', name: 'Own', is_self: true }];
    mount();
    expect(screen.getByText(/Your person record manager decides/)).toBeInTheDocument();
    expect(screen.getByText(/The person who enters the request cannot decide it/)).toBeInTheDocument();
  });

  beforeEach(() => { h.submit.mockReset().mockResolvedValue('r1'); });

  it('starts with no person chosen when several can be requested for, and will not send until one is', async () => {
    h.people = [{ id: 'p1', name: 'Ayu', is_self: false }, { id: 'p2', name: 'Budi', is_self: true }];
    const user = userEvent.setup();
    mount();
    const person = screen.getByLabelText(/^Person/) as HTMLSelectElement;
    expect(person.value).toBe('');
    await user.selectOptions(screen.getByLabelText(/^Type/), 't1');
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
    await user.selectOptions(person, 'p1');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({ person_id: 'p1', leave_type_id: 't1' }));
  });

  it('a login that can file leave for no one says so, instead of a form that cannot be sent', () => {
    h.people = []; h.pending = false;
    mount();
    expect(screen.getByText(/You can file leave only for yourself and the people you manage/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Type/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Send request' })).toBeDisabled();
  });

  it('says nothing about who can be filed for while the list is still loading', () => {
    h.people = []; h.pending = true;
    mount();
    expect(screen.queryByText(/You can file leave only/)).toBeNull();
    h.pending = false;
  });

  it('#1126 the start date starts on the organisation\'s day, not the browser\'s', async () => {
    const user = userEvent.setup();
    h.people = [{ id: 'p9', name: 'Own', is_self: true }];
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-30T18:00:00Z'));
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    setActiveOrgTimezone('Asia/Jakarta');
    try {
      mount();
      await user.selectOptions(screen.getByLabelText(/^Type/), 't1');
      await user.click(screen.getByRole('button', { name: 'Send request' }));
      expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({ person_id: 'p9', start_date: '2026-12-01', end_date: '2026-12-01' }));
    } finally {
      resetActiveLocale();
      vi.useRealTimers();
    }
  });

  it('a person who can request only for themselves needs no pick', async () => {
    h.people = [{ id: 'p9', name: 'Own', is_self: true }];
    const user = userEvent.setup();
    mount();
    expect(screen.queryByLabelText(/^Person/)).toBeNull();
    await user.selectOptions(screen.getByLabelText(/^Type/), 't1');
    await user.click(screen.getByRole('button', { name: 'Send request' }));
    expect(h.submit).toHaveBeenCalledWith(expect.objectContaining({ person_id: 'p9' }));
  });
});

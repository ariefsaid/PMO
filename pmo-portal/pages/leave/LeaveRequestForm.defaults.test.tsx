import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

/** fix/walk-people item 5: "request leave or report sick" never starts on someone; with a choice to make, the person is picked. */
const h = vi.hoisted(() => ({ people: [] as Array<{ id: string; name: string; is_self: boolean }>, submit: vi.fn() }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1', id: 'u1', role: 'Project Manager' } }) }));
vi.mock('@/src/hooks/useLeave', () => ({
  useLeaveSettings: () => ({ data: { enabled: true, approver_role: null } }),
  useLeaveTypes: () => ({ data: [{ id: 't1', name: 'Type A', archived_at: null }] }),
  useLeaveMutations: () => ({ submit: { mutateAsync: h.submit, isPending: false } }),
}));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@tanstack/react-query', async (orig) => {
  const m = await orig<typeof import('@tanstack/react-query')>();
  return { ...m, useQuery: () => ({ data: h.people, isPending: false }) };
});
import { LeaveRequestForm } from './LeaveRequestForm';

const mount = () => render(<ToastProvider><LeaveRequestForm onClose={() => {}} /></ToastProvider>);

describe('LeaveRequestForm person default', () => {
  it('names who approves it and promises the result', () => {
    h.people = [{ id: 'p9', name: 'Own', is_self: true }];
    mount();
    expect(screen.getByText(/Your line manager or any Admin approves this/)).toBeInTheDocument();
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

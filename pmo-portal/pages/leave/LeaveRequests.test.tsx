import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The shared Bahasa helper does not carry the crews catalogue, so this builds a real `id` instance from the shipped file.
const idCrews = JSON.parse(readFileSync(join(process.cwd(), 'public/locales/id/crews.json'), 'utf8'));
const idI18n = i18next.createInstance();
void idI18n.init({ lng: 'id', fallbackLng: 'id', ns: ['crews'], defaultNS: 'crews', resources: { id: { crews: idCrews } }, interpolation: { escapeValue: false } });

const h = vi.hoisted(() => ({
  enabled: true,
  rows: [] as Array<Record<string, unknown>>,
  submit: vi.fn(),
  decide: vi.fn(),
  role: 'Engineer',
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { org_id: 'o1', id: 'u1', role: h.role } }) }));
vi.mock('@/src/hooks/useLeave', () => ({
  useLeaveSettings: () => ({ data: { enabled: h.enabled, approver_role: null }, isPending: false }),
  useLeaveEnabled: () => h.enabled,
  useLeaveRequests: () => ({ data: h.rows, isPending: false, isError: false, refetch: vi.fn() }),
  useLeaveTypes: () => ({ data: [{ id: 't1', name: 'Type A', archived_at: null }] }),
  useLeaveMutations: () => ({
    submit: { mutateAsync: h.submit, isPending: false },
    decide: { mutateAsync: h.decide, isPending: false },
    cancel: { mutateAsync: vi.fn(), isPending: false },
  }),
}));
vi.mock('@/src/lib/supabase/client', () => ({
  supabase: { rpc: vi.fn(async () => ({ data: [{ id: 'p1', name: 'Own Person', is_self: true }], error: null })) },
}));
vi.mock('@tanstack/react-query', async (orig) => {
  const m = await orig<typeof import('@tanstack/react-query')>();
  return { ...m, useQuery: () => ({ data: [{ id: 'p1', name: 'Own Person', is_self: true }], isPending: false }) };
});

import LeaveRequestsPage from './LeaveRequests';
import { LeaveApprovalSection } from '../approvals/LeaveApprovalSection';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'r1', person_id: 'p1', person_name: 'Own Person', leave_type_id: 't1', type_name: 'Type A', start_date: '2026-12-01',
  end_date: '2026-12-03', days: 3, reason: null, status: 'Pending', decided_at: null, decision_note: null, is_mine: true, can_decide: false, ...over,
});
const page = (bahasa = false) => {
  const ui = <MemoryRouter><ToastProvider><LeaveRequestsPage /></ToastProvider></MemoryRouter>;
  return render(bahasa ? <I18nextProvider i18n={idI18n}>{ui}</I18nextProvider> : ui);
};

describe('leave requests page (#2708)', () => {
  beforeEach(() => { h.enabled = true; h.rows = []; h.submit.mockReset(); h.decide.mockReset(); h.role = 'Engineer'; });

  it('OFF: says it is not switched on and offers no request button', () => {
    h.enabled = false;
    page();
    expect(screen.getByText(/not switched on/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request leave' })).toBeNull();
  });

  it('AC-LV-012 a person submits one request with a type and a range', async () => {
    h.submit.mockResolvedValue('new');
    page();
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }));
    await userEvent.selectOptions(screen.getByLabelText(/Type/), 't1');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit.mock.calls[0][0]).toMatchObject({ person_id: 'p1', leave_type_id: 't1' });
  });

  it('AC-LV-012 an overlap refusal is shown in words', async () => {
    h.submit.mockRejectedValue(Object.assign(new Error('LV_OVERLAP: x'), { code: '23514' }));
    page();
    await userEvent.click(screen.getByRole('button', { name: 'Request leave' }));
    await userEvent.selectOptions(screen.getByLabelText(/Type/), 't1');
    await userEvent.click(screen.getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText(/already has a pending or approved request/)).toBeInTheDocument();
  });

  it('AC-LV-012 strings render in Bahasa Indonesia', () => {
    page(true);
    expect(screen.getByRole('button', { name: 'Ajukan cuti' })).toBeInTheDocument();
  });

  it('AC-LV-013 a request the viewer may decide shows Approve and Reject; their own does not', async () => {
    h.rows = [row({ id: 'a', can_decide: true, is_mine: false, person_name: 'Other' }), row({ id: 'b' })];
    page();
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    h.decide.mockResolvedValue(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(h.decide).toHaveBeenCalledWith({ id: 'a', decision: 'Approved', note: null });
  });

  it('AC-LV-013 the approvals section lists only what the viewer may decide, and nothing when there is none', () => {
    h.rows = [row({ id: 'b' })];
    const { rerender } = render(<MemoryRouter><ToastProvider><LeaveApprovalSection /></ToastProvider></MemoryRouter>);
    expect(screen.queryByLabelText('Leave requests awaiting you')).toBeNull();
    h.rows = [row({ id: 'a', can_decide: true, is_mine: false })];
    rerender(<MemoryRouter><ToastProvider><LeaveApprovalSection /></ToastProvider></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Leave requests awaiting you' })).toBeInTheDocument();
  });

  it('OFF: the approvals section renders nothing while leave is off (no requests are returned)', () => {
    h.enabled = false; h.rows = [];
    render(<MemoryRouter><ToastProvider><LeaveApprovalSection /></ToastProvider></MemoryRouter>);
    expect(screen.queryByLabelText('Leave requests awaiting you')).toBeNull();
  });
});

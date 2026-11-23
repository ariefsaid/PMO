import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Role } from '@/src/auth/AuthContext';
import { ToastProvider } from '@/src/components/ui';
import { AppError } from '@/src/lib/appError';

/** AC-HC-011 the head-count section of a crew's attendance day (docs/specs/guard-headcount.spec.md FR-HC-001/002/004/008/010). */
const h = vi.hoisted(() => ({
  role: 'Engineer' as string, uid: 'fc1',
  day: { data: [] as unknown[], isPending: false, isError: false, refetch: vi.fn() },
  classes: { data: [{ id: 'k1', code: 'guard', name: 'Guard', archivedAt: null }, { id: 'k2', code: 'old', name: 'Old class', archivedAt: '2026-01-01' }] as unknown[] },
  record: vi.fn(), approve: vi.fn(), clear: vi.fn(),
}));
vi.mock('@/src/hooks/useHeadcount', () => ({
  useHeadcountDay: () => h.day,
  useHeadcountMutations: () => ({ record: { mutateAsync: h.record }, approve: { mutateAsync: h.approve }, clear: { mutateAsync: h.clear } }),
}));
vi.mock('@/src/hooks/useLabourCost', () => ({ useLabourClasses: () => h.classes }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.role as Role, effectiveRole: h.role as Role }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.uid, org_id: 'org1' } }) }));

import { HeadCountSection } from './HeadCountSection';

const renderIt = (namedPresent = 0) => render(
  <ToastProvider><HeadCountSection crewId="c1" fieldControllerId="fc1" workOrderId="wo1" date="2026-11-18" namedPresent={namedPresent} /></ToastProvider>);
const line = (over: Record<string, unknown> = {}) => ({ id: 'l1', crewId: 'c1', classId: 'k1', headCount: 3, workDate: '2026-11-18', approvedAt: null, recordedByIds: ['fc1'], ...over });

describe('HeadCountSection', () => {
  beforeEach(() => {
    h.role = 'Engineer'; h.uid = 'fc1';
    h.day = { data: [], isPending: false, isError: false, refetch: vi.fn() };
    h.record = vi.fn().mockResolvedValue('l1'); h.approve = vi.fn().mockResolvedValue(undefined); h.clear = vi.fn().mockResolvedValue(undefined);
  });

  it('AC-HC-011 an empty day says what is missing, who adds it, and not to count a named person twice', () => {
    renderIt();
    expect(screen.getByText(/No head count entered for this day\./)).toBeInTheDocument();
    expect(screen.getByText(/never both/)).toBeInTheDocument();
  });

  it('AC-HC-011 the named people ticked present on the crew are shown beside the field, so the keeper sees the overlap', () => {
    renderIt(4);
    expect(screen.getByText('4 named people are ticked present on this crew today. Count here only the people not named on the roster.')).toBeInTheDocument();
  });

  it("AC-HC-011 the crew's foreman enters a class and a number; archived classes are not offered", async () => {
    const user = userEvent.setup();
    renderIt();
    const select = screen.getByRole('combobox', { name: 'Labour class' });
    expect(within(select).queryByRole('option', { name: 'Old class' })).not.toBeInTheDocument();
    await user.selectOptions(select, 'k1');
    await user.type(screen.getByRole('textbox', { name: 'Number of people' }), '4');
    await user.click(screen.getByRole('button', { name: 'Save head count' }));
    await waitFor(() => expect(h.record).toHaveBeenCalledWith({ workOrderId: 'wo1', crewId: 'c1', workDate: '2026-11-18', classId: 'k1', count: 4 }));
  });

  it('AC-HC-011 a number outside 1 to 500 is stopped on the screen and nothing is sent', async () => {
    const user = userEvent.setup();
    renderIt();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Labour class' }), 'k1');
    await user.type(screen.getByRole('textbox', { name: 'Number of people' }), '0');
    await user.click(screen.getByRole('button', { name: 'Save head count' }));
    expect(await screen.findByText('Enter a whole number from 1 to 500.')).toBeInTheDocument();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('AC-HC-011 a refused save shows the catalogue sentence and keeps the form', async () => {
    h.record = vi.fn().mockRejectedValue(new AppError('HC_LOCKED: this head count is approved and final', '23514'));
    const user = userEvent.setup();
    renderIt();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Labour class' }), 'k1');
    await user.type(screen.getByRole('textbox', { name: 'Number of people' }), '2');
    await user.click(screen.getByRole('button', { name: 'Save head count' }));
    expect(await screen.findByText('This head count is approved and final. Ask an Admin or Finance if it must be corrected.')).toBeInTheDocument();
  });

  it('AC-HC-011 a person who is not the foreman or a crew manager sees no form, one sentence saying who enters, and still reads the lines', () => {
    h.uid = 'someone'; h.role = 'Finance';
    h.day = { ...h.day, data: [line()] };
    renderIt();
    expect(screen.getByText("Only this crew's Foreman or a crew manager enters a head count.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save head count' })).not.toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Guard/ })).toBeInTheDocument();
  });

  it('AC-HC-011 the entrant cannot approve: the button is disabled and says a different approver must', () => {
    h.uid = 'admin1'; h.role = 'Admin';
    h.day = { ...h.day, data: [line({ recordedByIds: ['admin1'] })] };
    renderIt();
    const row = screen.getByRole('row', { name: /Guard/ });
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(within(row).getByText('A different approver must approve this line.')).toBeInTheDocument();
  });

  it('AC-HC-011 a different Admin approves a waiting line', async () => {
    h.uid = 'admin2'; h.role = 'Admin';
    h.day = { ...h.day, data: [line()] };
    const user = userEvent.setup();
    renderIt();
    expect(screen.getByText('Waiting for approval')).toBeInTheDocument();
    await user.click(within(screen.getByRole('row', { name: /Guard/ })).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(h.approve).toHaveBeenCalledWith('l1'));
  });

  it('AC-HC-011 an approved line is final: no approve, no clear', () => {
    h.uid = 'admin2'; h.role = 'Admin';
    h.day = { ...h.day, data: [line({ approvedAt: '2026-11-18T10:00:00Z' })] };
    renderIt();
    const row = screen.getByRole('row', { name: /Guard/ });
    expect(within(row).getByText('Approved')).toBeInTheDocument();
    expect(within(row).queryByRole('button')).not.toBeInTheDocument();
  });

  it('AC-HC-011 clearing an unapproved line asks first, then clears it', async () => {
    h.day = { ...h.day, data: [line()] };
    const user = userEvent.setup();
    renderIt();
    await user.click(within(screen.getByRole('row', { name: /Guard/ })).getByRole('button', { name: 'Clear' }));
    await user.click(await screen.findByRole('button', { name: 'Clear head count' }));
    await waitFor(() => expect(h.clear).toHaveBeenCalledWith('l1'));
  });

  it('AC-HC-011 only this crew\'s lines are listed', () => {
    h.day = { ...h.day, data: [line(), line({ id: 'l2', crewId: 'other', headCount: 9 })] };
    renderIt();
    expect(screen.getAllByRole('row').filter((r) => r.getAttribute('aria-label'))).toHaveLength(1);
  });

  it('AC-HC-011 a failed read says so and offers retry', async () => {
    h.day = { data: [], isPending: false, isError: true, refetch: vi.fn() };
    const user = userEvent.setup();
    renderIt();
    expect(screen.getByText("Couldn't load the head count")).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.day.refetch).toHaveBeenCalled();
  });
});

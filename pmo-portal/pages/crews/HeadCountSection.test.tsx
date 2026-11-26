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
  evidence: {} as { data?: unknown[]; isPending?: boolean; isFetching?: boolean; isError?: boolean; refetch?: ReturnType<typeof vi.fn> }, attach: vi.fn(), detach: vi.fn(),
  categories: [{ id: 'cat1', name: 'Site photo' }] as unknown[],
}));
vi.mock('@/src/hooks/useHeadcount', () => ({
  useHeadcountDay: () => h.day,
  useHeadcountEvidence: () => h.evidence,
  useHeadcountEvidenceMutations: () => ({ attachFile: { mutateAsync: h.attach, isPending: false }, detach: { mutateAsync: h.detach, isPending: false } }),
  useHeadcountMutations: () => ({ record: { mutateAsync: h.record }, approve: { mutateAsync: h.approve }, clear: { mutateAsync: h.clear } }),
}));
vi.mock('@/src/hooks/useDocumentCategories', () => ({ useViewableCategories: () => h.categories }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { document: { getSignedUrl: vi.fn().mockResolvedValue('https://example.test/f') } } }));
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
    h.evidence = { data: [] }; h.attach = vi.fn().mockResolvedValue('x1'); h.detach = vi.fn().mockResolvedValue(undefined);
    h.record = vi.fn().mockResolvedValue('l1'); h.approve = vi.fn().mockResolvedValue(undefined); h.clear = vi.fn().mockResolvedValue(undefined);
  });

  it('AC-HC-011 an empty day says what is missing, who adds it, and not to count a named person twice', () => {
    renderIt();
    expect(screen.getByText('No head count for this day')).toBeInTheDocument();
    expect(screen.getByText('Count only people not named above')).toBeInTheDocument();
  });

  it('AC-HC-011 the named people ticked present on the crew are shown beside the field, so the keeper sees the overlap', () => {
    renderIt(4);
    expect(screen.getByTestId('headcount-named')).toHaveTextContent('4 named present above');
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
  it('AC-HCE-001 the recorder sees the attached files and may attach or remove one while the line is open', async () => {
    const user = userEvent.setup();
    h.day = { data: [line()], isPending: false, isError: false, refetch: vi.fn() };
    h.evidence = { data: [{ id: 'x1', headcountId: 'l1', documentId: 'd1', title: 'gate.jpg', filePath: 'o/p/d1/gate.jpg' }] };
    renderIt();
    const evidence = screen.getByTestId('headcount-evidence-l1');
    expect(within(evidence).getByRole('button', { name: 'gate.jpg' })).toBeInTheDocument();
    expect(within(evidence).getByRole('button', { name: 'Attach a photo or document' })).toBeInTheDocument();
    await user.click(within(evidence).getByRole('button', { name: 'Remove gate.jpg' }));
    await waitFor(() => expect(h.detach).toHaveBeenCalledWith('x1'));
  });

  it('AC-HCE-005 an approver who is not the recorder sees the evidence before approving, and cannot change it', () => {
    h.uid = 'adm1'; h.role = 'Admin';
    h.day = { data: [line()], isPending: false, isError: false, refetch: vi.fn() };
    h.evidence = { data: [{ id: 'x1', headcountId: 'l1', documentId: 'd1', title: 'gate.jpg', filePath: 'o/p/d1/gate.jpg' }] };
    renderIt();
    const evidence = screen.getByTestId('headcount-evidence-l1');
    expect(within(evidence).getByRole('button', { name: 'gate.jpg' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('AC-HCE-007 approval waits for the initial evidence read instead of claiming there are no files', () => {
    h.uid = 'adm1'; h.role = 'Admin';
    h.day = { data: [line()], isPending: false, isError: false, refetch: vi.fn() };
    h.evidence = { data: undefined, isPending: true, isError: false, isFetching: true, refetch: vi.fn() };
    renderIt();
    expect(screen.getByText('Loading head count evidence…')).toBeInTheDocument();
    expect(screen.queryByText('No photo or document attached.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('AC-HCE-007 a failed evidence read keeps known files visible, offers retry, and blocks approval', async () => {
    h.uid = 'adm1'; h.role = 'Admin';
    h.day = { data: [line()], isPending: false, isError: false, refetch: vi.fn() };
    h.evidence = {
      data: [{ id: 'x1', headcountId: 'l1', documentId: 'd1', title: 'gate.jpg', filePath: 'o/p/d1/gate.jpg' }],
      isPending: false, isError: true, isFetching: false, refetch: vi.fn(),
    };
    const user = userEvent.setup();
    renderIt();
    const evidence = screen.getByTestId('headcount-evidence-l1');
    expect(within(evidence).getByRole('button', { name: 'gate.jpg' })).toBeInTheDocument();
    expect(within(evidence).getByRole('alert')).toHaveTextContent("Couldn't load head count evidence.");
    expect(within(evidence).queryByText('No photo or document attached.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await user.click(within(evidence).getByRole('button', { name: 'Retry' }));
    expect(h.evidence.refetch).toHaveBeenCalled();
  });

  it('AC-HCE-007 a refresh shows the known files and blocks approval until the read finishes', () => {
    h.uid = 'adm1'; h.role = 'Admin';
    h.day = { data: [line()], isPending: false, isError: false, refetch: vi.fn() };
    h.evidence = {
      data: [{ id: 'x1', headcountId: 'l1', documentId: 'd1', title: 'gate.jpg', filePath: 'o/p/d1/gate.jpg' }],
      isPending: false, isError: false, isFetching: true, refetch: vi.fn(),
    };
    renderIt();
    const evidence = screen.getByTestId('headcount-evidence-l1');
    expect(within(evidence).getByRole('button', { name: 'gate.jpg' })).toBeInTheDocument();
    expect(within(evidence).getByText('Updating head count evidence…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('AC-HCE-007 a refresh does not claim there are no files while the evidence read is unresolved', () => {
    h.uid = 'adm1'; h.role = 'Admin';
    h.day = { data: [line()], isPending: false, isError: false, refetch: vi.fn() };
    h.evidence = { data: [], isPending: false, isError: false, isFetching: true, refetch: vi.fn() };
    renderIt();
    const evidence = screen.getByTestId('headcount-evidence-l1');
    expect(within(evidence).getByText('Updating head count evidence…')).toBeInTheDocument();
    expect(within(evidence).queryByText('No photo or document attached.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
  });

  it('AC-HCE-004 an approved line shows its files and offers no attach or remove', () => {
    h.day = { data: [line({ approvedAt: '2026-11-19T01:00:00Z' })], isPending: false, isError: false, refetch: vi.fn() };
    h.evidence = { data: [{ id: 'x1', headcountId: 'l1', documentId: 'd1', title: 'gate.jpg', filePath: 'o/p/d1/gate.jpg' }] };
    renderIt();
    const evidence = screen.getByTestId('headcount-evidence-l1');
    expect(within(evidence).getByRole('button', { name: 'gate.jpg' })).toBeInTheDocument();
    expect(within(evidence).queryByRole('button', { name: /Attach a photo|Remove/ })).toBeNull();
  });

  it('AC-HCE-001 a line with no file says so', () => {
    h.day = { data: [line()], isPending: false, isError: false, refetch: vi.fn() };
    renderIt();
    expect(within(screen.getByTestId('headcount-evidence-l1')).getByText('No photo or document attached.')).toBeInTheDocument();
  });
});

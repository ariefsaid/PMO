import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  report: vi.fn().mockResolvedValue('r1'), close: vi.fn().mockResolvedValue(undefined), correct: vi.fn().mockResolvedValue(undefined),
  allow: { report: true, manage: true, close: true, configure: false } as Record<string, boolean>,
  lines: [] as unknown[], reports: [] as unknown[],
  settings: {} as Record<string, unknown>, saveSettings: vi.fn(), retrySettings: vi.fn(),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string) => h.allow[action] === true }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'o1' } }) }));
vi.mock('@/src/hooks/useUsers', () => ({ useUsers: () => ({ data: [{ id: 'u1', full_name: 'Field user', email: null, status: 'active' }] }) }));
vi.mock('@/src/hooks/useCrews', () => ({
  useCrews: () => ({ data: [{ id: 'c1', code: 'C1', name: 'Crew one', field_controller_id: 'u1' }], isPending: false, isError: false }),
}));
vi.mock('@/src/hooks/useCrewTools', () => ({
  useToolLines: () => ({ data: h.lines, isPending: false, isError: false }),
  useOpenToolReports: () => ({ data: h.reports, isPending: false, isError: false }),
  useToolSettings: () => h.settings,
  useToolMayManage: () => false,
  useToolMutations: () => ({
    report: { mutateAsync: h.report, isPending: false }, close: { mutateAsync: h.close, isPending: false },
    correct: { mutateAsync: h.correct, isPending: false }, addLine: { mutateAsync: vi.fn(), isPending: false },
    updateLine: { mutateAsync: vi.fn(), isPending: false }, setSettings: { mutateAsync: h.saveSettings, isPending: false },
  }),
}));
import { CrewTools } from './CrewTools';

const hammer = { id: 'l1', crew_id: 'c1', name: 'Hammer', code: null, serial: null, held_qty: 6, note: null, archived_at: null,
  damaged_qty: 1, lost_qty: 2, usable_qty: 3 };

describe('crew tools screen', () => {
  it('cannot overwrite settings after a failed read and can save after retry succeeds', async () => {
    h.allow.configure = true;
    h.settings = { isError: true, isSuccess: false, refetch: h.retrySettings };
    const view = render(<ToastProvider><CrewTools /></ToastProvider>);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(h.retrySettings).toHaveBeenCalled();
    expect(h.saveSettings).not.toHaveBeenCalled();
    h.settings = { isError: false, isSuccess: true, data: { coordinator_id: 'u1', task_due_days: 7 } };
    view.rerender(<ToastProvider><CrewTools /></ToastProvider>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.saveSettings).toHaveBeenCalledWith({ coordinatorId: 'u1', dueDays: 7 }));
  });
  beforeEach(() => {
    h.report.mockClear(); h.close.mockClear(); h.correct.mockClear();
    h.allow = { report: true, manage: true, close: true, configure: false };
    h.lines = [hammer]; h.reports = [];
  });
  it('AC-CTR-004 shows held, damaged, lost and usable quantities of each line', () => {
    render(<ToastProvider><CrewTools /></ToastProvider>);
    const row = screen.getByRole('row', { name: /Hammer/ });
    expect(row).toHaveTextContent('Hammer');
    expect(row).toHaveTextContent(/6\s*1\s*2\s*3/);
  });
  it('AC-CTR-006 a damaged report cannot be sent without a photo, a lost one can', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><CrewTools /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
    await user.selectOptions(screen.getByLabelText('What happened'), 'lost');
    expect(screen.getByRole('button', { name: 'Send report' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ lineId: 'l1', kind: 'lost', qty: 1, photos: [] })));
  });
  it('AC-CTR-001 a quantity above the usable count disables the send and names the usable count', async () => {
    const user = userEvent.setup();
    render(<ToastProvider><CrewTools /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    await user.selectOptions(screen.getByLabelText('What happened'), 'lost');
    const qty = screen.getByRole('textbox', { name: /Quantity/ });
    await user.clear(qty);
    await user.type(qty, '4');
    expect(screen.getByText('Only 3 usable. Report that many or fewer.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send report' })).toBeDisabled();
  });
  it('FR-CTR-016 a user who may not report sees no report button', () => {
    h.allow.report = false;
    render(<ToastProvider><CrewTools /></ToastProvider>);
    expect(screen.queryByRole('button', { name: 'Report a problem' })).not.toBeInTheDocument();
  });
  it('FR-CTR-014 the assignee closes an open report with a resolution; a lost tool cannot be repaired', async () => {
    const user = userEvent.setup();
    h.reports = [{ id: 'r1', line_id: 'l1', line_name: 'Hammer', crew_id: 'c1', kind: 'lost', qty: 2, note: null, status: 'open', resolution: null,
      task_id: 't1', assignee_id: 'u1', reported_by: 'u1', reported_on: '2026-11-18', due_on: '2026-11-19' }];
    render(<ToastProvider><CrewTools /></ToastProvider>);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('option', { name: 'Repaired' })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('How was it resolved'), 'written_off');
    await user.click(screen.getByRole('button', { name: 'Close report' }));
    await waitFor(() => expect(h.close).toHaveBeenCalledWith({ reportId: 'r1', resolution: 'written_off' }));
  });
  it('FR-CTR-010 a correction needs a reason', async () => {
    const user = userEvent.setup();
    h.reports = [{ id: 'r1', line_id: 'l1', line_name: 'Hammer', crew_id: 'c1', kind: 'damaged', qty: 2, note: null, status: 'open', resolution: null,
      task_id: 't1', assignee_id: 'u9', reported_by: 'u1', reported_on: '2026-11-18', due_on: '2099-01-01' }];
    h.allow.close = false;
    render(<ToastProvider><CrewTools /></ToastProvider>);
    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Correct' }));
    expect(screen.getByRole('button', { name: 'Save correction' })).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: /Reason/ }), 'miscounted');
    await user.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() => expect(h.correct).toHaveBeenCalledWith({ reportId: 'r1', kind: 'damaged', qty: 2, reason: 'miscounted' }));
  });
  it('reopening the report sheet for the same tool reuses the report ID until sent', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(crypto, 'randomUUID');
    render(<ToastProvider><CrewTools /></ToastProvider>);
    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    const uuidCountAfterFirstOpen = spy.mock.calls.length;
    expect(uuidCountAfterFirstOpen).toBeGreaterThan(0);
    const firstUuid = spy.mock.results[uuidCountAfterFirstOpen - 1].value;

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    expect(spy.mock.calls.length).toBe(uuidCountAfterFirstOpen);

    await user.selectOptions(screen.getByLabelText('What happened'), 'lost');
    await user.click(screen.getByRole('button', { name: 'Send report' }));
    await waitFor(() => expect(h.report).toHaveBeenCalledWith(expect.objectContaining({ reportId: firstUuid })));

    await user.click(screen.getByRole('button', { name: 'Report a problem' }));
    expect(spy.mock.calls.length).toBe(uuidCountAfterFirstOpen + 1);
    spy.mockRestore();
  });
});

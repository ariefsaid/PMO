import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrencyAuto } from '@/src/lib/format';
const h = vi.hoisted(() => ({ create: vi.fn(), addLine: vi.fn(), capture: vi.fn(), cleanup: vi.fn(), may: vi.fn(() => true), navigate: vi.fn(), claims: [] as unknown[], readiness: 'ready' as string, choices: [] as unknown[], choicesArgs: [] as unknown[][], limit: null as number | null, setFloat: vi.fn() }));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => h.may }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'user-1' } }) }));
vi.mock('./expenses/useOwnAdvanceOptions', () => ({ useOwnAdvanceOptions: () => [{ value: 'adv-1', label: 'EXP-1 · Rp 1' }] }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'p1', name: 'Contractual Project one', short_name: 'North Terminal' }, { id: 'p2', name: 'Project two', short_name: null }] }) }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaims: () => ({ data: { rows: h.claims } }), useExpenseClaimMutations: () => ({ create: { mutateAsync: h.create }, addLine: { mutateAsync: h.addLine } }) }));
vi.mock('@/src/hooks/useImprest', () => ({
  useImprestFloatChoices: (...a: unknown[]) => { h.choicesArgs.push(a); return { data: h.choices }; },
  useImprestProcurementLimit: () => ({ data: h.limit }),
  useSetClaimFloat: () => ({ mutateAsync: h.setFloat }),
}));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/hooks/useExpensePostingReadiness', () => ({ useExpensePostingReadiness: () => ({ state: h.readiness, retry: vi.fn() }) }));
vi.mock('@/src/hooks/useExpenseCapture', () => ({ useExpenseCapture: () => ({ capture: h.capture, cleanupUnlinkedAttachment: h.cleanup, recovery: null }) }));
vi.mock('react-router', async (importOriginal) => { const actual = await importOriginal<typeof import('react-router')>(); return { ...actual, useNavigate: () => h.navigate }; });
import ExpenseClaimNew from './ExpenseClaimNew';
const renderPage = () => render(<MemoryRouter initialEntries={['/expenses/new']}><ToastProvider><Routes><Route path="/expenses/new" element={<ExpenseClaimNew />} /></Routes></ToastProvider></MemoryRouter>);
describe('Expense claim one-page capture (AC-EXP1-001..005)', () => {
 beforeEach(() => { vi.clearAllMocks(); h.cleanup.mockResolvedValue(undefined); h.may.mockReturnValue(true); h.claims = []; h.readiness = 'ready'; h.choices = []; h.choicesArgs = []; h.limit = null; h.setFloat.mockResolvedValue(undefined); h.create.mockResolvedValue({ id: 'claim-1' }); h.addLine.mockResolvedValue({}); h.capture.mockResolvedValue('claim-1'); });
 it('AC-002 #1325: new expense project options show the short name only', () => { renderPage(); expect(screen.getByRole('option', { name: 'North Terminal' })).toHaveValue('p1'); });
 it('AC-EXP1-001 renders editable header, lines and receipts without a separate claim amount', () => { renderPage(); expect(screen.getByLabelText(/Title/)).toBeInTheDocument(); expect(screen.getByLabelText('Project')).toBeInTheDocument(); expect(screen.getByLabelText('Budget category')).toBeInTheDocument(); expect(screen.getByLabelText('Purpose')).toBeInTheDocument(); expect(screen.getByText('Lines')).toBeInTheDocument(); expect(screen.getByLabelText('Receipt (optional)')).toBeInTheDocument(); expect(screen.getAllByLabelText(/^Amount/)).toHaveLength(1); });
 it('allows saving the claim header as a Draft before adding an expense line or receipt', async () => { renderPage(); fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Late receipt' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(h.capture).toHaveBeenCalled()); expect(h.capture.mock.calls[0][0]).toMatchObject({ header: { title: 'Late receipt' }, firstLine: null, additionalLines: [], receiptFile: null }); expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true }); });
 it('AC-EXP1-002 creates a Draft with every captured line, then replaces to detail', async () => { renderPage(); fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Travel expenses' } }); fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-20' } }); fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'Travel' } }); fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Train fare' } }); fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '42.50' } }); fireEvent.click(screen.getByRole('button', { name: 'Add line' })); const dates = screen.getAllByLabelText(/^Date/); fireEvent.change(dates[1], { target: { value: '2026-10-21' } }); fireEvent.change(screen.getAllByLabelText(/^Type/)[1], { target: { value: 'Meals' } }); fireEvent.change(screen.getAllByLabelText(/^Description/)[1], { target: { value: 'Lunch' } }); fireEvent.change(screen.getAllByLabelText(/^Amount/)[1], { target: { value: '18.25' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(h.capture).toHaveBeenCalled()); expect(h.capture.mock.calls[0][0].header).toMatchObject({ kind: 'claim', title: 'Travel expenses' }); expect(h.capture.mock.calls[0][0].firstLine).toMatchObject({ description: 'Train fare', amount: 42.5 }); expect(h.capture.mock.calls[0][0].additionalLines).toEqual([expect.objectContaining({ description: 'Lunch', amount: 18.25 })]); expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true }); });
 it('AC-EXP1-005 keeps the create permission gate unchanged', () => { h.may.mockReturnValue(false); renderPage(); expect(screen.getByText(/do not have permission/i)).toBeInTheDocument(); expect(h.create).not.toHaveBeenCalled(); expect(h.capture).not.toHaveBeenCalled(); });
 it('AC-EXP1-003 leaving an untouched page creates no claim or lines', () => { renderPage(); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(h.navigate).toHaveBeenCalledWith('/expenses'); expect(h.create).not.toHaveBeenCalled(); expect(h.capture).not.toHaveBeenCalled(); expect(h.addLine).not.toHaveBeenCalled(); });
 it('holds navigation after entry until the user confirms discarding unsaved values', () => { renderPage(); fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Unsaved trip' } }); fireEvent.click(screen.getByRole('button', { name: 'Cancel' })); expect(screen.getByRole('dialog', { name: 'Discard unsaved claim?' })).toBeInTheDocument(); expect(h.navigate).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button', { name: 'Stay' })); expect(h.navigate).not.toHaveBeenCalled(); expect(screen.getByLabelText(/Title/)).toHaveValue('Unsaved trip'); expect(h.create).not.toHaveBeenCalled(); expect(h.capture).not.toHaveBeenCalled(); });
 it('suggests a title from the selected receipt until the claimant edits it', () => { renderPage(); fireEvent.change(screen.getByLabelText('Receipt (optional)'), { target: { files: [new File(['receipt'], 'site-visit.pdf', { type: 'application/pdf' })] } }); expect(screen.getByLabelText(/Title/)).toHaveValue('site-visit'); fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Reviewed visit' } }); fireEvent.change(screen.getByLabelText('Receipt (optional)'), { target: { files: [new File(['receipt'], 'another.pdf', { type: 'application/pdf' })] } }); expect(screen.getByLabelText(/Title/)).toHaveValue('Reviewed visit'); });
 it('AC-EXP1-004 lands on the saved draft and cleans up an unconfirmed receipt when capture fails', async () => { h.capture.mockRejectedValueOnce(Object.assign(new Error('receipt upload failed'), { claimId: 'claim-1', draftSaved: true })); renderPage(); fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Travel expenses' } }); fireEvent.change(screen.getByLabelText('Receipt (optional)'), { target: { files: [new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })] } }); fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true })); expect(h.cleanup).toHaveBeenCalledTimes(1); expect(h.cleanup).toHaveBeenCalledWith({ beforeConfirmationOnly: true }); await waitFor(() => expect(document.querySelector('[data-toast="visible"]')).toHaveTextContent(/receipt upload failed/i)); });
 it('AC-EXP1-004 prevents overlapping submissions until the capture request settles', async () => { let resolveCapture!: (claimId: string) => void; h.capture.mockImplementationOnce(() => new Promise((resolve) => { resolveCapture = resolve; })); renderPage(); fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Trip' } }); const saveButton = screen.getByRole('button', { name: 'Save' }); fireEvent.click(saveButton); fireEvent.click(saveButton); expect(h.capture).toHaveBeenCalledTimes(1); expect(saveButton).toBeDisabled(); resolveCapture('claim-1'); await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true })); });
 it.each(['success', 'partial'] as const)('AC-EXP1-004 locks capture after %s navigation starts, even before unmount', async (outcome) => {
  if (outcome === 'partial') h.capture.mockRejectedValueOnce(Object.assign(new Error('line save failed'), { claimId: 'claim-1', draftSaved: true }));
  renderPage();
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Travel expenses' } });
  fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-20' } });
  fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'Travel' } });
  fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Train' } });
  fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '42.50' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add line' }));
  fireEvent.change(screen.getAllByLabelText(/^Date/)[1], { target: { value: '2026-10-21' } });
  fireEvent.change(screen.getAllByLabelText(/^Type/)[1], { target: { value: 'Meals' } });
  fireEvent.change(screen.getAllByLabelText(/^Description/)[1], { target: { value: 'Lunch' } });
  fireEvent.change(screen.getAllByLabelText(/^Amount/)[1], { target: { value: '18.25' } });
  const saveButton = screen.getByRole('button', { name: 'Save' });
  fireEvent.click(saveButton);
  await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true }));
  expect(saveButton).toBeDisabled();
  fireEvent.submit(saveButton.closest('form')!);
  expect(h.capture).toHaveBeenCalledTimes(1);
 });

 it('AC-EXP1-004 allows retry when no saved draft or navigation exists', async () => {
  h.capture.mockRejectedValueOnce(new Error('draft save failed'));
  renderPage();
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Travel expenses' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
  expect(h.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true }));
  expect(h.capture).toHaveBeenCalledTimes(2);
 });

 it('AC-EXP1-004 keeps the saved draft accessible if best-effort cleanup is refused', async () => {
  h.capture.mockRejectedValueOnce(Object.assign(new Error('receipt upload failed'), { claimId: 'claim-1', draftSaved: true }));
  h.cleanup.mockRejectedValueOnce(new Error('cleanup refused'));
  renderPage();
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Travel expenses' } });
  fireEvent.change(screen.getByLabelText('Receipt (optional)'), { target: { files: [new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true }));
  expect(h.cleanup).toHaveBeenCalledWith({ beforeConfirmationOnly: true });
 });

 it('AC-EXP1-004 opens the saved draft while best-effort receipt cleanup is still pending', async () => {
  h.capture.mockRejectedValueOnce(Object.assign(new Error('receipt upload failed'), { claimId: 'claim-1', draftSaved: true }));
  h.cleanup.mockReturnValueOnce(new Promise(() => {}));
  renderPage();
  fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Travel expenses' } });
  fireEvent.change(screen.getByLabelText('Receipt (optional)'), { target: { files: [new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })] } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true }));
  expect(h.cleanup).toHaveBeenCalledTimes(1);
 });

 it('lands on the saved claim and reports a later line failure instead of abandoning the draft', async () => { h.capture.mockRejectedValueOnce(Object.assign(new Error('line save failed'), { claimId: 'claim-1', draftSaved: true })); renderPage(); fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Travel expenses' } }); fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-20' } }); fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'Travel' } }); fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Train fare' } }); fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '42.50' } }); fireEvent.click(screen.getByRole('button', { name: 'Add line' })); fireEvent.change(screen.getAllByLabelText(/^Date/)[1], { target: { value: '2026-10-21' } }); fireEvent.change(screen.getAllByLabelText(/^Type/)[1], { target: { value: 'Meals' } }); fireEvent.change(screen.getAllByLabelText(/^Description/)[1], { target: { value: 'Lunch' } }); fireEvent.change(screen.getAllByLabelText(/^Amount/)[1], { target: { value: '18.25' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true })); expect(h.cleanup).not.toHaveBeenCalled(); await waitFor(() => expect(document.querySelector('[data-toast="visible"]')).toHaveTextContent(/line save failed/i)); });
 it('suggests only the current claimant’s newest saved category for the selected project', () => { h.claims = [{ id: 'own-old', kind: 'claim', claimant_id: 'user-1', project_id: 'p1', budget_category: 'Labor', title: 'Latest same-project claim', created_at: '2026-10-12T00:00:00Z' }, { id: 'other-user', kind: 'claim', claimant_id: 'user-2', project_id: 'p1', budget_category: 'Materials', title: 'Another claimant visit', created_at: '2026-10-13T00:00:00Z' }, { id: 'own-new', kind: 'claim', claimant_id: 'user-1', project_id: 'p1', budget_category: 'Special expenses', title: 'Newest same-project claim', created_at: '2026-10-14T00:00:00Z' }]; renderPage(); fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } }); expect(screen.getByLabelText('Budget category')).toHaveValue('Special expenses'); expect(screen.getByText(/Newest same-project claim/)).toBeInTheDocument(); expect(screen.queryByText(/Another claimant visit/)).toBeNull(); });
 it.each([
  ['inactive', /ERPNext is connected, but expense posting isn't switched on/],
  ['notConnected', /Expense posting to accounting isn't active/],
  ['unavailable', /Couldn't check whether expense posting is active/],
 ] as const)('keeps the %s posting-readiness caveat visible without blocking PMO-only draft capture', async (state, message) => { h.readiness = state; renderPage(); expect(screen.getByText(message)).toBeInTheDocument(); fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Trip' } }); fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-20' } }); fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'Travel' } }); fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Fare' } }); fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '5' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(h.capture).toHaveBeenCalled()); });
 it('sends the chosen advance with the header', async () => { renderPage(); fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Trip' } }); fireEvent.change(screen.getByLabelText('Settle against advance'), { target: { value: 'adv-1' } }); fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-10-20' } }); fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'Travel' } }); fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Fare' } }); fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '5' } }); fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(h.capture).toHaveBeenCalled()); expect(h.capture.mock.calls[0][0].header).toMatchObject({ advanceId: 'adv-1' }); });
});

describe('Charge to site float (AC-IMP-084, FR-IMP-072)', () => {
  const FLOATS = [{ float_id: 'f1', custodian_name: 'Cass Custodian', remaining: 500000 }];
  const fill = (amount: string) => {
    fireEvent.change(screen.getByLabelText(/Title/), { target: { value: 'Diesel' } });
    fireEvent.change(screen.getByLabelText(/^Date/), { target: { value: '2026-11-03' } });
    fireEvent.change(screen.getByLabelText(/^Type/), { target: { value: 'Travel' } });
    fireEvent.change(screen.getByLabelText(/^Description/), { target: { value: 'Diesel' } });
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: amount } });
  };
  beforeEach(() => { vi.clearAllMocks(); h.may.mockReturnValue(true); h.claims = []; h.readiness = 'ready'; h.choices = FLOATS; h.choicesArgs = []; h.limit = null; h.setFloat.mockResolvedValue(undefined); h.capture.mockResolvedValue('claim-1'); h.cleanup.mockResolvedValue(undefined); });

  it('AC-IMP-084 Charge to site float lists only floats on the chosen project', () => {
    renderPage();
    expect(h.choicesArgs.at(-1)?.[0]).toBeUndefined();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    expect(h.choicesArgs.at(-1)?.[0]).toBe('p1');
    const field = screen.getByLabelText('Charge to site float');
    expect(within(field).getByRole('option', { name: /Cass Custodian/ })).toHaveValue('f1');
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p2' } });
    expect(h.choicesArgs.at(-1)?.[0]).toBe('p2');
  });

  it('AC-IMP-084 settle against advance lists only advances on the chosen float, and only off-float ones when none is chosen', () => {
    h.claims = [{ id: 'adv-1', kind: 'advance', imprest_float_id: 'f1' }];
    renderPage();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    expect(screen.queryByLabelText('Settle against advance')).toBeNull(); // adv-1 is on f1, nothing is charged to f1 yet
    fireEvent.change(screen.getByLabelText('Charge to site float'), { target: { value: 'f1' } });
    expect(within(screen.getByLabelText('Settle against advance')).getByRole('option', { name: /EXP-1/ })).toHaveValue('adv-1');
  });

  it('AC-IMP-084 the field is absent when the project has no float for the viewer', () => {
    h.choices = [];
    renderPage();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    expect(screen.queryByLabelText('Charge to site float')).toBeNull();
  });

  it('AC-IMP-084 the field shows the month\'s remaining and the exception hint', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Budget category'), { target: { value: 'Vehicle' } });
    fireEvent.change(screen.getByLabelText('Charge to site float'), { target: { value: 'f1' } });
    fill('700000');
    expect(screen.getByText(/500,000/)).toBeInTheDocument();
    expect(screen.getByText(/above this month's plan/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '400000' } });
    expect(screen.queryByText(/above this month's plan/i)).toBeNull();
  });

  it('#1635 the remaining-this-month hint is in the float currency, not the organisation currency', () => {
    h.choices = [{ ...FLOATS[0], currency: 'USD', project_name: 'North Terminal' }];
    renderPage();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Budget category'), { target: { value: 'Vehicle' } });
    fireEvent.change(screen.getByLabelText('Charge to site float'), { target: { value: 'f1' } });
    fill('100');
    const note = screen.getByRole('note');
    expect(note).toHaveTextContent(formatCurrencyAuto(500000, 'USD'));
    expect(note).not.toHaveTextContent(formatCurrencyAuto(500000, 'IDR'));
  });

  it('#1635 two floats of one custodian are told apart by project and custodian', () => {
    h.choices = [{ ...FLOATS[0], project_name: 'North Terminal' }, { ...FLOATS[0], float_id: 'f2', project_name: 'Depot', remaining: 1 }];
    renderPage();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    const field = screen.getByLabelText('Charge to site float');
    expect(within(field).getByRole('option', { name: 'North Terminal · Cass Custodian' })).toHaveValue('f1');
    expect(within(field).getByRole('option', { name: 'Depot · Cass Custodian' })).toHaveValue('f2');
  });

  it('AC-IMP-084 an amount above the org limit shows the limit hint', () => {
    h.limit = 2000000;
    renderPage();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Charge to site float'), { target: { value: 'f1' } });
    fill('2500000');
    expect(screen.getByText(/procurement limit/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Amount/), { target: { value: '1500000' } });
    expect(screen.queryByText(/procurement limit/i)).toBeNull();
  });

  it('AC-IMP-084 a chosen float is charged to the saved claim', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Charge to site float'), { target: { value: 'f1' } });
    fill('100000');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.setFloat).toHaveBeenCalledWith({ claimId: 'claim-1', floatId: 'f1' }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true }));
  });

  it('AC-IMP-084 no float link is written when none is chosen', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fill('100000');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
    expect(h.setFloat).not.toHaveBeenCalled();
  });

  it('AC-IMP-084 changing the project drops the chosen float', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Charge to site float'), { target: { value: 'f1' } });
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p2' } });
    expect(screen.getByLabelText('Charge to site float')).toHaveValue('');
    fill('100000');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalled());
    expect(h.setFloat).not.toHaveBeenCalled();
  });

  it('AC-IMP-084 a refused float link lands on the saved draft and says so', async () => {
    h.setFloat.mockRejectedValueOnce(Object.assign(new Error('float is not on this project'), { code: 'P0001' }));
    renderPage();
    fireEvent.change(screen.getByLabelText('Project'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Charge to site float'), { target: { value: 'f1' } });
    fill('100000');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(h.navigate).toHaveBeenCalledWith('/expenses/claim-1', { replace: true }));
    await waitFor(() => expect(document.querySelector('[data-toast="visible"]')).toHaveTextContent(/float/i));
  });
});

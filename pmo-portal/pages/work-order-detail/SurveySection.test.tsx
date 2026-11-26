import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthContext, type AuthContextValue } from '@/src/auth/AuthContext';
import { AppError } from '@/src/lib/appError';
import { resetActiveLocale, setActiveLocale, setActiveOrgTimezone } from '@/src/lib/locale/activeLocale';
import { attachSurveyDocuments, recordSurvey, type SurveyRecord } from '@/src/lib/db/surveyRecords';

const h = vi.hoisted(() => ({
  role: 'Finance' as string,
  userId: 'u-fin',
  records: [] as unknown[],
  state: { isError: false, refetch: vi.fn() },
  rpc: vi.fn(), attachDocuments: vi.fn(), record: vi.fn(), confirm: vi.fn(), discard: vi.fn(),
}));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { rpc: h.rpc } }));
vi.mock('@/src/auth/usePermission', async () => {
  const { can } = await vi.importActual<typeof import('@/src/auth/policy')>('@/src/auth/policy');
  return { usePermission: () => (action: never, entity: never, ctx: Record<string, unknown> = {}) => can(action, entity, { realRole: h.role, ...ctx } as never) };
});
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId } }) }));
vi.mock('@/src/hooks/useSurveyRecords', () => ({
  useSurveyRecords: () => ({ data: h.records, ...h.state }),
  useSurveyMutations: () => ({
    attachDocuments: { mutateAsync: h.attachDocuments }, record: { mutateAsync: h.record, isPending: false }, confirm: { mutateAsync: h.confirm, isPending: false }, discard: { mutateAsync: h.discard, isPending: false },
  }),
}));
vi.mock('@/src/hooks/useDocuments', () => ({ useDocuments: () => ({ data: [{ id: 'd1', title: 'Quality certificate', status: 'Issued', file_path: 'o/p/d1.pdf' }, { id: 'd3', title: 'Survey sheet', status: 'Issued', file_path: 'o/p/d3.pdf' }, { id: 'd2', title: 'Draft note', status: 'Draft', file_path: 'o/p/d2.pdf' }], isPending: false, isError: false }) }));
import { SurveySection } from './SurveySection';

const LINES = [{ id: 'b1', label: 'CODE1 · Route survey', unit: 'km' }];
const rec = (p: Partial<SurveyRecord> & Pick<SurveyRecord, 'id'>): SurveyRecord => ({
  boqItemId: 'b1', surveyDate: '2026-11-10', surveyedQuantity: 4, qualityReadyQuantity: 2, note: null, status: 'draft', recordedBy: 'u-pm', recordedByName: 'Dewi Recorder',
  confirmedByName: null, confirmBasis: null, supersedesId: null, supersededAt: null, participants: [{ id: 'p1', name: 'Site Supervisor', company: 'Customer side', role: 'Supervisor' }], documentIds: ['d1'], ...p,
});

function renderIt(props: Partial<React.ComponentProps<typeof SurveySection>> = {}) {
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={{} as AuthContextValue}><MemoryRouter>
    <SurveySection workOrderId="w1" projectId="p1" status="Issued" projectManagerId="u-pm" lines={LINES} today="2026-11-20" {...props} />
  </MemoryRouter></AuthContext.Provider></QueryClientProvider>);
  return userEvent.setup();
}

beforeEach(() => {
  h.role = 'Finance'; h.userId = 'u-fin'; h.records = [];
  h.state = { isError: false, refetch: vi.fn() };
  h.rpc.mockReset(); h.attachDocuments.mockReset();
  h.record.mockReset().mockResolvedValue({ id: 'new', failures: [] }); h.confirm.mockReset().mockResolvedValue(undefined); h.discard.mockReset().mockResolvedValue(undefined);
});

describe('AC-SCR-013 SurveySection', () => {
  it('#1126 the survey date defaults to the organisation\'s day, not the browser\'s', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-25T18:00:00Z'));
    setActiveLocale({ locale: 'id', numberLocale: 'id-ID', timezone: 'Asia/Jakarta' });
    setActiveOrgTimezone('Asia/Jakarta');
    try {
      const user = renderIt({ today: undefined });
      await user.click(screen.getByRole('button', { name: 'Record a survey' }));
      expect(screen.getByLabelText(/Survey date/)).toHaveValue('26 Nov 2026');
    } finally { resetActiveLocale(); vi.useRealTimers(); }
  });

  it('the empty state says who records and who confirms', () => {
    renderIt();
    expect(screen.getByTestId('survey-empty')).toHaveTextContent('The project manager, Finance or an Admin records a survey here');
    expect(screen.getByRole('button', { name: 'Record a survey' })).toBeInTheDocument();
  });

  it('AC-SCR-018 says plainly that each confirmed survey adds and a mistake is changed with Correct', () => {
    renderIt();
    expect(screen.getByText(/Each confirmed survey ADDS to the line's certified quantity/)).toHaveTextContent('not a running total; to change a mistaken survey use Correct');
  });

  it('lists the surveys with participants, documents and status, and sums the certified quantity of confirmed ones only', () => {
    h.records = [
      rec({ id: 'r1', status: 'confirmed', confirmedByName: 'Budi Finance', surveyedQuantity: 4, qualityReadyQuantity: 2 }),
      rec({ id: 'r2', status: 'confirmed', surveyedQuantity: 3, qualityReadyQuantity: 1 }),
      rec({ id: 'r3', status: 'confirmed', surveyedQuantity: 9, qualityReadyQuantity: 9, supersededAt: '2026-11-12T00:00:00Z' }),
      rec({ id: 'r4', status: 'draft', surveyedQuantity: 50, qualityReadyQuantity: 0 }),
    ];
    renderIt();
    expect(screen.getByTestId('survey-certified')).toHaveTextContent('certified 7 km, quality-ready 3 km');
    const row = screen.getByTestId('survey-r1');
    expect(within(row).getByText(/Site Supervisor \(Customer side, Supervisor\)/)).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Quality certificate' })).toBeInTheDocument();
    expect(within(screen.getByTestId('survey-r3')).getByText('Corrected')).toBeInTheDocument();
    expect(within(screen.getByTestId('survey-r4')).getByText('Draft')).toBeInTheDocument();
  });

  it('Finance confirms a draft after a confirm dialog; the refusal is shown in words', async () => {
    h.records = [rec({ id: 'r4', recordedBy: 'u-pm' })];
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: /Confirm CODE1/ }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Confirm survey' }));
    expect(h.confirm).toHaveBeenCalledWith('r4');
  });

  it('a refused confirmation says why and what to do', async () => {
    h.records = [rec({ id: 'r4', recordedBy: 'u-fin' })];
    h.confirm.mockRejectedValue(new AppError('SVY_RECORDER_CONFIRMS: x'));
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: /Confirm CODE1/ }));
    await user.click(screen.getByRole('button', { name: 'Confirm survey' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ask Finance or an Admin other than the recorder to confirm it');
  });

  it('a project manager of this project can record but not confirm; an engineer sees why there is no button', () => {
    h.role = 'Project Manager'; h.userId = 'u-pm'; h.records = [rec({ id: 'r4', recordedBy: 'u-pm' })];
    const { unmount } = { unmount: () => undefined };
    renderIt();
    expect(screen.getByRole('button', { name: 'Record a survey' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Confirm CODE1/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Discard draft CODE1/ })).toBeInTheDocument();
    unmount();
  });

  it('an engineer cannot record and is told who can', () => {
    h.role = 'Engineer'; h.userId = 'u-eng';
    renderIt();
    expect(screen.queryByRole('button', { name: 'Record a survey' })).toBeNull();
    expect(screen.getByTestId('survey-hint')).toHaveTextContent('Only the project manager, Finance or an Admin can record a survey.');
  });

  it('a closed work order says surveys are recorded while it is issued', () => {
    renderIt({ status: 'Closed' });
    expect(screen.getByTestId('survey-hint')).toHaveTextContent('Surveys are recorded while the work order is issued.');
  });

  it('records a survey with a typed participant and an attached document, and refuses quality-ready above surveyed before sending', async () => {
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: 'Record a survey' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Contract line/), 'b1');
    await user.type(within(dialog).getByLabelText(/Surveyed quantity/), '4');
    await user.type(within(dialog).getByLabelText('Quality-ready quantity'), '5');
    await user.type(within(dialog).getByLabelText('Name'), 'Typed Person');
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await within(dialog).findByText('The quality-ready quantity cannot be more than the surveyed quantity')).toBeInTheDocument();
    expect(h.record).not.toHaveBeenCalled();
    const quality = within(dialog).getByLabelText('Quality-ready quantity');
    await user.clear(quality);
    await user.type(quality, '2');
    await user.click(within(dialog).getByLabelText('Quality certificate'));
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({
      workOrderId: 'w1', boqItemId: 'b1', surveyedQuantity: 4, qualityReadyQuantity: 2, participants: [{ name: 'Typed Person', company: undefined, role: undefined }], documentIds: ['d1'],
    }));
  });

  it('#2817 retries a failed second attachment on the same saved survey', async () => {
    h.record.mockImplementation(recordSurvey);
    h.attachDocuments.mockImplementation(({ id, documentIds }: { id: string; documentIds: string[] }) => attachSurveyDocuments(id, documentIds));
    h.rpc.mockResolvedValueOnce({ data: 'saved-draft', error: null })
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({ error: { message: 'Failed to fetch' } })
      .mockResolvedValueOnce({ error: null });
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: 'Record a survey' }));
    const dialog = within(screen.getByRole('dialog'));
    await user.selectOptions(dialog.getByLabelText(/Contract line/), 'b1');
    await user.type(dialog.getByLabelText(/Surveyed quantity/), '4');
    await user.type(dialog.getByLabelText('Name'), 'Survey participant');
    await user.click(dialog.getByLabelText('Quality certificate'));
    await user.click(dialog.getByLabelText('Survey sheet'));
    await user.click(dialog.getByRole('button', { name: 'Save draft' }));
    expect(await dialog.findByText('Survey saved, but some documents could not be attached.')).toBeVisible();
    await user.click(dialog.getByRole('button', { name: 'Retry attachments' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(h.rpc.mock.calls.map(([fn]) => fn)).toEqual([
      'record_survey', 'attach_survey_document', 'attach_survey_document', 'attach_survey_document',
    ]);
    expect(h.rpc).toHaveBeenLastCalledWith('attach_survey_document', { p_id: 'saved-draft', p_document: 'd3' });
  });

  it('a person is required', async () => {
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: 'Record a survey' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/Contract line/), 'b1');
    await user.type(within(dialog).getByLabelText(/Surveyed quantity/), '4');
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await within(dialog).findByText('Add at least one person, each with a name')).toBeInTheDocument();
    expect(h.record).not.toHaveBeenCalled();
  });

  it('a confirmed survey offers a correction that names the superseded record and fixes the line', async () => {
    h.records = [rec({ id: 'r1', status: 'confirmed', confirmedByName: 'Budi Finance' })];
    const user = renderIt();
    await user.click(screen.getByRole('button', { name: /Correct CODE1/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText(/Contract line/)).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/Surveyed quantity/), '3');
    await user.type(within(dialog).getByLabelText('Name'), 'Someone');
    await user.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(h.record).toHaveBeenCalledWith(expect.objectContaining({ supersedesId: 'r1', boqItemId: 'b1', surveyedQuantity: 3 }));
  });
});

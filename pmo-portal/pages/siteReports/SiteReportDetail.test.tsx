import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ToastProvider } from '@/src/components/ui';
import type { DsrReportDetail } from '@/src/lib/db/dailySiteReports';

const load = (lng: 'en' | 'id', ns: string) => JSON.parse(readFileSync(join(process.cwd(), `public/locales/${lng}/${ns}.json`), 'utf8'));
function makeI18n(lng: 'en' | 'id') {
  const i18n = i18next.createInstance();
  const bundle = (l: 'en' | 'id') => ({
    common: load(l, 'common'),
    siteReport: load(l, 'siteReport'),
    status: load(l, 'status'),
    waitingList: load(l, 'waitingList'),
  });
  void i18n.init({
    lng,
    fallbackLng: 'en',
    fallbackNS: 'common',
    ns: ['common', 'siteReport', 'status', 'waitingList'],
    defaultNS: 'siteReport',
    resources: { en: bundle('en'), id: bundle('id') },
    initImmediate: false,
    interpolation: { escapeValue: false },
  });
  return i18n;
}

/** #1522 site report record page: what each role is offered, and what the day shows (AC-DSR-004/005/008/011/013). */
const h = vi.hoisted(() => ({
  detail: null as unknown,
  revenue: [] as unknown[],
  equipment: [] as unknown[],
  peopleHours: '8',
  userId: 'eng',
  builtInRoleKey: null as string | null,
  qsRevenue: true,
  realRole: 'Engineer',
  pm: 'pm' as string | null,
  pmName: 'Rina Wati' as string | null,
  noItems: false,
  route: null as unknown,
  routeError: false,
  routeIdCalls: [] as (string | null | undefined)[],
  m: {
    save: { mutateAsync: vi.fn(), isPending: false }, submit: { mutateAsync: vi.fn(), isPending: false },
    validate: { mutateAsync: vi.fn(), isPending: false }, returnReport: { mutateAsync: vi.fn(), isPending: false },
    withdraw: { mutateAsync: vi.fn(), isPending: false },
    correct: { mutateAsync: vi.fn(), isPending: false }, uploadPhoto: { mutateAsync: vi.fn(), isPending: false },
  },
}));
vi.mock('@/src/hooks/useWorkOrderSections', () => ({
  useWorkOrderSectionRollup: () => ({ data: [{ sectionId: 'section-a', code: 'A', name: 'Front A', archivedAt: null }] }),
}));
vi.mock('@/src/hooks/useDailySiteReports', () => ({
  useDailySiteReport: () => ({ data: h.detail, isPending: false, isError: false, refetch: vi.fn() }),
  useDailySiteReportRevenue: (_id: string, enabled: boolean) => ({ data: enabled ? h.revenue : undefined }),
  useWorkOrderValidatedRevenue: (_id: string, enabled: boolean) => ({ data: enabled ? 140 : undefined }),
  useDsrLookups: () => ({
    idle: { data: [{ id: 'ir1', label: 'Weather' }] }, weather: { data: [{ id: 'wx1', label: 'Rain' }] },
    items: { data: h.noItems ? [] : [{ id: 'l1', boq_item_id: 'b1', item_code: 'W-1', description: 'Weld', unit: 'm', catalogue_item_id: 'cat1' }, { id: 'l2', boq_item_id: 'b2', item_code: 'X-9', description: 'Unpriced', unit: 'ea', catalogue_item_id: null }] },
    hours: { data: { peopleHours: h.peopleHours, equipment: h.equipment } },
  }),
  useDailySiteReportMutations: () => h.m,
}));
vi.mock('@/src/hooks/useAttendanceSecondRecords', () => ({
  useReportDayHours: () => ({ data: { detail: false, mayEnter: false, mayDecide: false, workers: [] }, isPending: false, isError: false, refetch: vi.fn() }),
  useSecondRecordMutations: () => ({ enter: { mutate: vi.fn(), isPending: false }, decide: { mutate: vi.fn(), isPending: false } }),
}));
vi.mock('@/src/hooks/useProjects', () => ({
  useProject: () => ({
    data: h.pm !== undefined ? { id: 'p1', name: 'Pipeline', project_manager_id: h.pm, pm: h.pmName ? { full_name: h.pmName } : null } : null,
  }),
}));
vi.mock('@/src/hooks/useDsrValidationRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/src/hooks/useDsrValidationRoute')>();
  return {
    ...actual,
    useDsrValidationRoute: (reportId: string | null | undefined) => {
      h.routeIdCalls.push(reportId);
      return { data: h.route, isPending: false, isError: h.routeError, refetch: vi.fn() };
    },
  };
});
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master: { listItems: async () => [] } }, dailySiteReport: { photoUrl: vi.fn() } } }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'o1', built_in_role: h.builtInRoleKey } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));

vi.mock('@/src/hooks/useOrgSwitch', () => ({ useOrgSwitch: () => ({ data: h.qsRevenue }) }));

import SiteReportDetail from './SiteReportDetail';

const make = (status: string, extra: Partial<DsrReportDetail['report']> = {}): DsrReportDetail => ({
  report: {
    id: 'r1', org_id: 'o1', project_id: 'p1', work_order_id: 'w1', work_date: '2026-03-10', status: status as DsrReportDetail['report']['status'],
    version: 1, supersedes_id: null, superseded_at: null, correction_reason: null, author_id: 'eng', submitted_at: null, validated_by: null,
    validated_at: null, returned_reason: null, variant_id: null, start_time: '07:00:00', end_time: '17:30:00', total_minutes: 630,
    weather_id: null, weather_note: null, note: null, crew_id: null, person_id: null, area_id: null, ...extra,
  },
  workOrder: { label: 'WO-1 · Pipe run', currency: 'USD', orderValue: 1000 },
  progress: [
    { id: 'pl1', position: 1, work_order_line_id: 'l1', sub_stage: null, quantity: 10, unit: 'm' },
    { id: 'pl2', position: 2, work_order_line_id: 'l2', sub_stage: null, quantity: 2, unit: 'ea' },
  ],
  idle: [], consumables: [],
  photos: [{ id: 'ph1', kind: 'paper_form', file_path: 'o1/r1/x/form.jpg', created_at: '2026-03-10T10:00:00Z' }],
  events: [
    { id: 'e1', action: 'created', actor_id: 'eng', reason: null, at: '2026-03-10T08:00:00Z' },
    { id: 'e2', action: 'returned', actor_id: 'fin', reason: 'Quantity looks too high', at: '2026-03-11T08:00:00Z' },
  ],
});

const renderPage = (lng: 'en' | 'id' = 'en') => render(
  <I18nextProvider i18n={makeI18n(lng)}>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/site-reports/r1']}>
        <ToastProvider><Routes><Route path="/site-reports/:reportId" element={<SiteReportDetail />} /></Routes></ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>
  </I18nextProvider>,
);

beforeEach(() => {
  h.builtInRoleKey = null; h.qsRevenue = true;
  h.userId = 'eng'; h.realRole = 'Engineer'; h.pm = 'pm'; h.pmName = 'Rina Wati'; h.noItems = false; h.equipment = []; h.peopleHours = '8';
  h.route = { routeKind: 'finance_admin', approvers: [] };
  h.routeError = false;
  h.routeIdCalls = [];
  h.revenue = [{ line_id: 'pl1', rate: 5, rate_source: 'catalogue', amount: 50, frozen: false }, { line_id: 'pl2', rate: null, rate_source: null, amount: null, frozen: false }];
  Object.values(h.m).forEach((x) => x.mutateAsync.mockReset());
});

describe('site report record — walk fixes', () => {
  it('JOB-DSR-EMPTY: sending an empty report says what is missing, in words, and no database text', async () => {
    h.detail = make('draft');
    h.m.save.mutateAsync.mockResolvedValue('r1');
    h.m.submit.mutateAsync.mockRejectedValue(Object.assign(new Error('dsr_empty: progress,hours,photo'), { code: 'DS001' }));
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect((await screen.findAllByText(/Add at least one of: progress, start and end time, a photo\./)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/dsr_empty/)).toBeNull();
  });

  it('JOB-DSR-WITHDRAW: the author can take a sent report back; nobody else is offered it', async () => {
    h.detail = make('submitted');
    h.m.withdraw.mutateAsync.mockResolvedValue(undefined);
    const first = renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Withdraw' }));
    expect(h.m.withdraw.mutateAsync).toHaveBeenCalledWith('r1');
    first.unmount();
    h.userId = 'fin'; h.realRole = 'Finance';
    renderPage();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('JOB-DSR-WITHDRAW: a validated report cannot be withdrawn', () => {
    h.detail = make('validated');
    renderPage();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  });

  it('JOB-DSR-SCOPE: a work order with no items says so and names the project manager', () => {
    h.detail = make('draft'); h.noItems = true;
    renderPage();
    expect(screen.getByTestId('dsr-no-items')).toHaveTextContent('This work order has no items yet. Ask Rina Wati.');
  });
});

describe('site report record', () => {
  it('AC-DSR-013 the field author can save and submit a draft, sees no Validate and no money', () => {
    h.detail = make('draft');
    renderPage();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validate' })).toBeNull();
    expect(screen.queryByTestId('dsr-total')).toBeNull();
    expect(screen.queryAllByTestId('dsr-line-amount')).toHaveLength(0);
  });

  it('AC-SD-009 the author is told at send that the validator needs a photo of the paper form, and not once it is there', () => {
    h.detail = { ...make('draft'), photos: [] };
    const { unmount } = renderPage();
    expect(screen.getByTestId('dsr-author-needs-photo')).toHaveTextContent('Add a photo of the paper form before you send');
    unmount();
    h.detail = make('draft');
    renderPage();
    expect(screen.queryByTestId('dsr-author-needs-photo')).toBeNull();
  });

  it('F1-2 sending without the paper-form photo is stopped: a sent report cannot take a photo, so nothing is sent and the author is told to add it', async () => {
    h.detail = { ...make('draft'), photos: [] };
    h.m.save.mutateAsync.mockResolvedValue('r1'); h.m.submit.mutateAsync.mockResolvedValue(undefined);
    h.m.submit.mutateAsync.mockClear();
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(h.m.submit.mutateAsync).not.toHaveBeenCalled();
    expect(await screen.findByText('Not sent: add a photo of the paper form first')).toBeInTheDocument();
  });

  it('F1-3 a sub-stage is asked only for an item priced from the catalogue: on a hand-priced line it can only remove the rate', () => {
    h.detail = make('draft');
    renderPage();
    // two progress lines: W-1 (catalogue item) offers the field, X-9 (priced by hand) does not
    expect(screen.getAllByLabelText('Sub-stage')).toHaveLength(1);
  });

  it('AC-DSR-005 the author is never offered Validate, even as Admin', () => {
    h.detail = make('submitted'); h.realRole = 'Admin';
    renderPage();
    expect(screen.queryByRole('button', { name: 'Validate' })).toBeNull();
  });

  it('AC-DSR-004 a validator sees the exact day total and "No rate" on the unpriced line', () => {
    h.detail = make('submitted'); h.userId = 'fin'; h.realRole = 'Finance';
    renderPage();
    expect(screen.getByRole('button', { name: 'Validate' })).toBeEnabled();
    expect(screen.getByTestId('dsr-total')).toHaveTextContent('50.00');
    const amounts = screen.getAllByTestId('dsr-line-amount');
    expect(amounts[0]).toHaveTextContent('50.00');
    expect(within(amounts[1]).getByText('No rate')).toBeInTheDocument();
  });

  it('AC-DSR-005 a validator validates through the RPC', async () => {
    h.detail = make('submitted'); h.userId = 'fin'; h.realRole = 'Finance';
    h.m.validate.mutateAsync.mockResolvedValue(undefined);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Validate' }));
    expect(h.m.validate.mutateAsync).toHaveBeenCalledWith('r1');
  });

  it('AC-DSR-008 a returned report shows its reason and lets the author edit and resubmit', async () => {
    h.detail = make('returned', { returned_reason: 'Quantity looks too high' });
    h.m.save.mutateAsync.mockResolvedValue('r1'); h.m.submit.mutateAsync.mockResolvedValue(undefined);
    renderPage();
    expect(screen.getByTestId('dsr-returned')).toHaveTextContent('Quantity looks too high');
    await userEvent.click(screen.getByRole('button', { name: 'Submit' }));
    expect(h.m.save.mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', workOrderId: 'w1' }));
    expect(h.m.submit.mutateAsync).toHaveBeenCalledWith('r1');
  });

  it('a draft with an invalid quantity is not saved', async () => {
    h.detail = make('draft');
    renderPage();
    const qty = screen.getAllByLabelText(/Quantity/)[0];
    await userEvent.clear(qty);
    await userEvent.type(qty, '0');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(h.m.save.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText('More than 0, up to 3 decimals')).toBeInTheDocument();
  });

  it('AC-DSR-011 equipment hours on the work order and date are shown from usage entries', () => {
    h.detail = make('validated', { validated_by: 'fin', validated_at: '2026-03-11T09:00:00Z' });
    h.equipment = [{ id: 'eq1', asset_name: 'Excavator 2', quantity: 6.5, unit: 'hours', kind: 'work', status: 'Approved' }];
    renderPage();
    const block = screen.getByTestId('dsr-equipment');
    expect(within(block).getByText('Excavator 2')).toBeInTheDocument();
    expect(within(block).getByText(/6.5/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit' })).toBeNull();
  });

  it('#2619 people hours show the figure the hours read returns for the whole crew', () => {
    h.detail = make('validated', { validated_by: 'fin', validated_at: '2026-03-11T09:00:00Z' });
    h.peopleHours = '42.5';
    renderPage();
    expect(within(screen.getByTestId('dsr-equipment')).getByText('42.5')).toBeInTheDocument();
  });

  it('a validated report offers Correct to a validator, not to its field author', () => {
    h.detail = make('validated', { validated_by: 'fin', validated_at: '2026-03-11T09:00:00Z' });
    renderPage();
    expect(screen.queryByRole('button', { name: 'Correct' })).toBeNull();
  });

  describe('who-next waiting line (FR-WAIT-006; server route over dsr_may_validate)', () => {
    it('a named eligible PM is spoken with their own database role and Finance/Admin as true alternatives, EN and ID', () => {
      h.detail = make('submitted');
      h.route = { routeKind: 'project_manager', approvers: [{ id: 'pm', name: 'Rina Wati', role: 'Project Manager' }] };
      const first = renderPage('en');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Waiting for Rina Wati, Project Manager or Finance or Admin');
      expect(h.routeIdCalls).toContain('r1');
      first.unmount();

      renderPage('id');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Menunggu Rina Wati, Manajer proyek atau Keuangan atau Admin');
    });

    it('the server role fallback (no eligible PM: unassigned, inactive, light, or wrong-role) names no person, EN and ID', () => {
      h.detail = make('submitted');
      h.route = { routeKind: 'finance_admin', approvers: [] };
      const first = renderPage('en');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Waiting for Finance or Admin');
      expect(screen.getByTestId('dsr-waiting-for')).not.toHaveTextContent('Rina Wati');
      expect(screen.getByTestId('dsr-waiting-for')).not.toHaveTextContent('Project Manager');
      first.unmount();

      renderPage('id');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Menunggu Keuangan atau Admin');
    });

    it('a PM who authored the report is never named: the server says finance_admin and the page does not guess', () => {
      h.detail = make('submitted', { author_id: 'pm' });
      h.userId = 'pm';
      h.pm = 'pm';
      h.pmName = 'Rina Wati';
      h.route = { routeKind: 'finance_admin', approvers: [] };
      renderPage('en');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Waiting for Finance or Admin');
      expect(screen.getByTestId('dsr-waiting-for')).not.toHaveTextContent('Rina Wati');
    });

    it('a proven empty route says nobody active can validate, instead of inventing a project approver, EN and ID', () => {
      h.detail = make('submitted');
      h.route = { routeKind: 'nobody', approvers: [] };
      const first = renderPage('en');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Nobody active can validate this report right now.');
      expect(screen.getByTestId('dsr-waiting-for')).not.toHaveTextContent('Project Manager');
      first.unmount();

      renderPage('id');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Saat ini tidak ada anggota aktif yang dapat memvalidasi laporan ini.');
    });

    it('AC-DRVR-008 sole-Admin author with no PM and an assigned validator job role shows that job role instead of nobody, EN and ID', () => {
      h.detail = make('submitted', { author_id: 'adm' });
      h.userId = 'adm';
      h.realRole = 'Admin';
      h.pm = null;
      h.pmName = null;
      h.route = { routeKind: 'job_roles', approvers: [], validateRoles: ['site_supervisor'] };
      const first = renderPage('en');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Waiting for Site Supervisor');
      expect(screen.getByTestId('dsr-waiting-for')).not.toHaveTextContent('Nobody active can validate');
      first.unmount();

      renderPage('id');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Menunggu Pengawas Lapangan');
    });

    it('the non-leaking unavailable shape, and a still-loading read, show no waiting claim at all', () => {
      h.detail = make('submitted');
      h.route = { routeKind: 'unavailable', approvers: [] };
      const first = renderPage();
      expect(screen.queryByTestId('dsr-waiting-for')).toBeNull();
      first.unmount();

      h.route = null;
      renderPage();
      expect(screen.queryByTestId('dsr-waiting-for')).toBeNull();
    });

    it('a failed route read says it could not verify and offers a retry', () => {
      h.detail = make('submitted');
      h.route = null;
      h.routeError = true;
      renderPage('en');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent("Couldn't verify who can approve right now.");
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('keeps a known positive route through a failed background refresh, and never presents a stale nobody as fresh (fa943)', () => {
      h.detail = make('submitted');
      h.route = { routeKind: 'project_manager', approvers: [{ id: 'pm', name: 'Rina Wati', role: 'Project Manager' }] };
      h.routeError = true;
      const first = renderPage('en');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Waiting for Rina Wati, Project Manager or Finance or Admin');
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
      first.unmount();

      h.route = { routeKind: 'nobody', approvers: [] };
      renderPage('en');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent("Couldn't verify who can approve right now.");
      expect(screen.getByTestId('dsr-waiting-for')).not.toHaveTextContent('Nobody active can validate');
    });

    it('keeps a known Finance/Admin route through a failed background refresh too, with the retry and no stale claim', () => {
      h.detail = make('submitted');
      h.route = { routeKind: 'finance_admin', approvers: [] };
      h.routeError = true;
      renderPage('en');
      expect(screen.getByTestId('dsr-waiting-for')).toHaveTextContent('Waiting for Finance or Admin');
      expect(screen.getByTestId('dsr-waiting-for')).not.toHaveTextContent('Nobody active can validate');
      expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    });

    it('non-waiting states show no line and ask for no route (the read is bound to Submitted)', () => {
      for (const st of ['draft', 'validated', 'returned'] as const) {
        h.detail = make(st);
        h.routeIdCalls = [];
        const { unmount } = renderPage();
        expect(screen.queryByTestId('dsr-waiting-for')).toBeNull();
        expect(h.routeIdCalls.length).toBeGreaterThan(0);
        expect(h.routeIdCalls.every((id) => id === null)).toBe(true);
        unmount();
      }
    });
  });
});

it('JOB-PC6 the field recorder selects the section when recording progress', async () => {
  h.detail = make('draft');
  const user = userEvent.setup();
  renderPage();
  const sections = screen.getAllByLabelText('Section');
  await user.selectOptions(sections[0], 'section-a');
  expect(sections[0]).toHaveValue('section-a');
});


describe('QS report revenue scope', () => {
  it('AC-QSR-001 shows the validated day amount without the work-order total', () => {
    h.builtInRoleKey = 'quantity_surveyor';
    h.detail = make('validated');
    renderPage();
    expect(screen.getByTestId('dsr-total')).toHaveTextContent('50');
    expect(screen.queryByText('Validated to date')).toBeNull();
  });
  it('AC-QSR-001 hides the amount while the organisation setting is off', () => {
    h.builtInRoleKey = 'quantity_surveyor'; h.qsRevenue = false;
    h.detail = make('validated');
    renderPage();
    expect(screen.queryByTestId('dsr-total')).toBeNull();
  });
});

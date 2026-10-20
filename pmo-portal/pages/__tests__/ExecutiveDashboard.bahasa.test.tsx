import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import ExecutiveDashboard from '../ExecutiveDashboard';
import { ToastProvider } from '@/src/components/ui/Toast';
import { BahasaProvider } from '@/test/bahasa';
import { setActiveLocale } from '@/src/lib/locale/activeLocale';

const desktop = vi.hoisted(() => ({ value: true }));
const state = vi.hoisted(() => ({
  pending: false, error: false, empty: false,
  pipelinePending: false, pipelineError: false, pipelineEmpty: false,
  winError: false, winEmpty: false,
}));
const billing = vi.hoisted(() => ({
  pending: true, error: false,
  data: null as null | { totals: never[]; incompleteCount: number; incomplete: never[]; rows: never[] },
}));
vi.mock('@/src/components/ui/useIsDesktop', () => ({ useIsDesktop: () => desktop.value }));
vi.mock('@/src/hooks/useWorkOrderBilling', () => ({
  useUnbilledWorkOrders: () => ({ data: billing.data ?? undefined, isPending: billing.pending, isError: billing.error, refetch: vi.fn() }),
}));
const dashboard = {
  active_projects: 2, total_contract_value: 8_000_000, on_hand_margin: 0.949375, on_hand_value: 8_000_000,
  on_hand_contract_remaining: 7_595_000, on_hand_realized_margin: 1_200_000, on_hand_actual_known: 405_000,
  on_hand_actual_project_count: 1, on_hand_actual_project_total: 1,
  on_hand_actual_coverage_count: 1, on_hand_actual_coverage_total: 1,
  pipeline_weighted_value: 800_000, pipeline_projected_margin: 0.2, pipeline_total_value: 2_000_000, projects_at_risk: 1,
  projects_by_status: [],
  procurements_by_status: [
    { status: 'Draft', count: 1 }, { status: 'Requested', count: 2 }, { status: 'Approved', count: 1 },
    { status: 'Vendor Quoted', count: 1 }, { status: 'Ordered', count: 1 }, { status: 'Received', count: 1 },
    { status: 'Vendor Invoiced', count: 1 }, { status: 'Paid', count: 1 },
  ],
  top_projects: [{ id: 'p1', name: 'Project North', client_name: 'Client North', contract_value: 5_000_000, currency: 'USD', budget: 4_700_000, spent: 2_100_000, actual_coverage_count: 1, actual_coverage_total: 1, status: 'Ongoing Project' }],
};
vi.mock('@/src/hooks/useDashboard', () => ({
  useDashboard: () => ({
    data: state.pending || state.error ? null : state.empty ? { ...dashboard, top_projects: [], procurements_by_status: [] } : dashboard,
    isPending: state.pending, isError: state.error, refetch: vi.fn(),
  }),
  useWinRate: () => ({
    data: state.winEmpty
      ? { wins_count: 0, losses_count: 0, wins_value: 0, losses_value: 0, win_rate_count: null, win_rate_value: null }
      : { wins_count: 2, losses_count: 1, wins_value: 8_000_000, losses_value: 650_000, win_rate_count: 2 / 3, win_rate_value: 0.92 },
    isError: state.winError,
  }),
  useSalesPipeline: () => ({
    data: state.pipelinePending || state.pipelineError ? undefined : { stages: state.pipelineEmpty ? [] : [{ status: 'Tender Submitted', weighted_value: 300_000 }, { status: 'Negotiation', weighted_value: 500_000 }] },
    isPending: state.pipelinePending, isError: state.pipelineError, refetch: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useOrgFeatures', () => ({ useOrgFeatures: () => ({ data: {} }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Executive', realRole: 'Executive' }) }));
vi.mock('@/src/hooks/useProcurements', () => ({ useProcurements: () => ({ data: [], isPending: false, isError: false }) }));
vi.mock('@/src/hooks/useTimesheetApproval', () => ({ useTimesheetsAwaitingApproval: () => ({ data: [{ id: 't1' }], isError: false }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'exec-1', org_id: 'org-1' }, role: 'Executive' }) }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));

function renderDashboard(locale: 'en' | 'id' = 'id') {
  setActiveLocale({ locale, numberLocale: locale === 'id' ? 'id-ID' : 'en-US', timezone: 'UTC' });
  return render(<BahasaProvider locale={locale}><MemoryRouter><ToastProvider><ExecutiveDashboard /></ToastProvider></MemoryRouter></BahasaProvider>);
}

beforeEach(() => {
  desktop.value = true;
  Object.assign(state, { pending: false, error: false, empty: false, pipelinePending: false, pipelineError: false, pipelineEmpty: false, winError: false, winEmpty: false });
  billing.pending = true; billing.error = false; billing.data = null;
});

describe('Executive dashboard Bahasa', () => {
  it('AC-UXA-003: localizes desktop and mobile dashboard widgets while preserving displayed values and raw destinations', () => {
    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Dashboard Eksekutif' })).toBeInTheDocument();
    expect(screen.getByText('Kesehatan portofolio di seluruh kontrak berjalan — margin saat ini, proyeksi pipeline, dan eksposur pelaksanaan.')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-total-contract-value')).toHaveTextContent('2 proyek aktif');
    // OD-MONEY-FMT: short figure visible; the exact amount stays in the Bahasa format (title + sr text).
    expect(screen.getByTestId('kpi-on-hand-margin')).toHaveTextContent('US$8 jt');
    expect(screen.getByTestId('kpi-on-hand-margin').querySelector('[title="US$8.000.000"]')).not.toBeNull();
    expect(screen.getByTestId('kpi-on-hand-margin')).toHaveTextContent('Nilai kontrak dalam portofolio saat ini');
    expect(screen.getByRole('link', { name: 'Tinjau 1 proyek berisiko' })).toHaveAttribute('href', '/projects?filter=at-risk');
    expect(screen.getByText('Menunggu persetujuan Anda')).toBeInTheDocument();
    expect(screen.getByText('Tingkat kemenangan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Menurut jumlah' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '12 bulan terakhir' })).toBeInTheDocument();
    expect(screen.getByText('2 menang dari 3 proyek selesai')).toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Tingkat kemenangan 66.7%' })).toBeInTheDocument();
    expect(screen.getByText('Menang')).toBeInTheDocument();
    expect(screen.getByText('Kalah')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Pengeluaran dibanding kontrak' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Project North' })).toHaveAttribute('href', '/projects/p1');
    expect(screen.getByRole('progressbar', { name: 'Project North: 42% dari kontrak' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Margin proyeksi pipeline' })).toBeInTheDocument();
    expect(screen.getByText('Tender diajukan')).toBeInTheDocument();
    expect(screen.getByText('Negosiasi')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Pengadaan menurut status, 9 permintaan, terbanyak pada Permintaan Pembelian/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Disetujui/ })).toHaveAttribute('href', '/procurement?status=Approved');
    expect(screen.getByRole('link', { name: /Penerimaan Barang/ })).toHaveAttribute('href', '/procurement?status=Received');
    expect(screen.getByRole('link', { name: /Invoice Vendor/ })).toHaveAttribute('href', '/procurement?status=Vendor%20Invoiced');
    expect(screen.getByRole('link', { name: /Penawaran Vendor/ })).toHaveAttribute('href', '/procurement?status=Vendor%20Quoted');
    expect(screen.getByTestId('still-to-invoice-loading')).toBeInTheDocument();

    cleanup();
    desktop.value = false;
    renderDashboard();
    expect(screen.getByRole('heading', { name: 'Dashboard Eksekutif' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Tinjau 1 proyek berisiko' })).toHaveAttribute('href', '/projects?filter=at-risk');

    cleanup();
    desktop.value = true; state.pending = true;
    renderDashboard();
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();

    cleanup();
    state.pending = false; state.error = true;
    renderDashboard();
    expect(screen.getByText('Gagal memuat dashboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();

    cleanup();
    state.error = false; state.empty = true;
    renderDashboard();
    expect(screen.getByText('Belum ada data')).toBeInTheDocument();

    cleanup();
    state.empty = false; state.winEmpty = true;
    renderDashboard();
    expect(screen.getByText('Tidak ada proyek selesai dalam periode ini')).toBeInTheDocument();

    cleanup();
    state.winEmpty = false; state.winError = true;
    renderDashboard();
    expect(screen.getByText('Gagal memuat tingkat kemenangan')).toBeInTheDocument();

    cleanup();
    state.winError = false; state.pipelinePending = true;
    renderDashboard();
    expect(within(screen.getByTestId('dashboard-pipeline-margin')).getByTestId('liststate-loading')).toBeInTheDocument();

    cleanup();
    state.pipelinePending = false; state.pipelineError = true;
    renderDashboard();
    expect(screen.getByText('Gagal memuat pipeline')).toBeInTheDocument();

    cleanup();
    state.pipelineError = false; state.pipelineEmpty = true;
    renderDashboard();
    expect(screen.getByText('Tidak ada pipeline aktif')).toBeInTheDocument();

    cleanup();
    state.pipelineEmpty = false; billing.pending = false; billing.data = { totals: [], incompleteCount: 0, incomplete: [], rows: [] };
    renderDashboard();
    expect(screen.getByText('Tidak ada lagi yang perlu ditagih pada Work Order yang diterbitkan')).toBeInTheDocument();

    cleanup();
    billing.data = null; billing.error = true;
    renderDashboard();
    expect(screen.getByText('Gagal memuat yang belum ditagih')).toBeInTheDocument();
  });
});

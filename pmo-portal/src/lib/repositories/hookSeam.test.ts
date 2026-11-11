import { describe, it, expect, vi, beforeEach } from 'vitest';

// Delegation contract for the repository methods the hooks consume (#1632, ADR-0017): each method
// calls the matching DAL function with the same args, returns its result, and normalizes a thrown
// error to an AppError with the code preserved.
vi.mock('@/src/lib/db/dashboard', () => ({
  getExecutiveDashboard: vi.fn(),
  getPMDashboardProjects: vi.fn(),
  getWinRate: vi.fn(),
  getSalesPipeline: vi.fn(),
  getFinanceBudgetReview: vi.fn(),
}));
vi.mock('@/src/lib/db/orgs', () => ({
  getOrgDefaultCurrency: vi.fn(),
  getOrgLocaleDefaults: vi.fn(),
  getOrgLifecycleState: vi.fn(),
}));
vi.mock('@/src/lib/db/agentEvents', () => ({ listRunEvents: vi.fn(), rateAgentEvent: vi.fn() }));
vi.mock('@/src/lib/db/agentThreads', () => ({ listAgentThreads: vi.fn() }));
vi.mock('@/src/lib/db/agentRuns', () => ({ getRunHeartbeat: vi.fn() }));
vi.mock('@/src/lib/db/projectMoney', () => ({ getProjectsMoneyCollection: vi.fn() }));
vi.mock('@/src/lib/db/procurements', () => ({
  listProcurements: vi.fn(),
  listProcurementsByProject: vi.fn(),
  getProjectCommittedSpend: vi.fn(),
  getProjectReservedSpend: vi.fn(),
}));
vi.mock('@/src/lib/db/procurementLifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/src/lib/db/procurementLifecycle')>()),
  captureVendorInvoice: vi.fn(),
}));

import { repositories } from './index';
import { AppError } from '@/src/lib/appError';
import * as dashboardDal from '@/src/lib/db/dashboard';
import * as orgsDal from '@/src/lib/db/orgs';
import * as agentEventsDal from '@/src/lib/db/agentEvents';
import * as agentRunsDal from '@/src/lib/db/agentRuns';
import * as agentThreadsDal from '@/src/lib/db/agentThreads';
import * as projectMoneyDal from '@/src/lib/db/projectMoney';
import * as procurementsDal from '@/src/lib/db/procurements';
import * as lifecycleDal from '@/src/lib/db/procurementLifecycle';

beforeEach(() => vi.clearAllMocks());

const coded = Object.assign(new Error('boom'), { code: '42501' });

describe('dashboard repository', () => {
  it('delegates each read and passes the win-rate range through', async () => {
    const from = new Date('2026-01-01');
    const to = new Date('2026-06-30');
    vi.mocked(dashboardDal.getWinRate).mockResolvedValue({ won: 1 } as never);
    await expect(repositories.dashboard.winRate(from, to)).resolves.toEqual({ won: 1 });
    expect(dashboardDal.getWinRate).toHaveBeenCalledWith(from, to);

    vi.mocked(dashboardDal.getExecutiveDashboard).mockResolvedValue({ e: 1 } as never);
    vi.mocked(dashboardDal.getPMDashboardProjects).mockResolvedValue([{ id: 'p' }] as never);
    vi.mocked(dashboardDal.getSalesPipeline).mockResolvedValue({ s: 1 } as never);
    vi.mocked(dashboardDal.getFinanceBudgetReview).mockResolvedValue([{ id: 'b' }] as never);
    await expect(repositories.dashboard.executive()).resolves.toEqual({ e: 1 });
    await expect(repositories.dashboard.pmProjects()).resolves.toEqual([{ id: 'p' }]);
    await expect(repositories.dashboard.salesPipeline()).resolves.toEqual({ s: 1 });
    await expect(repositories.dashboard.financeBudgetReview()).resolves.toEqual([{ id: 'b' }]);
  });

  it('normalizes a thrown error to AppError with the code preserved', async () => {
    vi.mocked(dashboardDal.getExecutiveDashboard).mockRejectedValue(coded);
    await expect(repositories.dashboard.executive()).rejects.toMatchObject({ code: '42501' });
    await expect(repositories.dashboard.executive()).rejects.toBeInstanceOf(AppError);
  });
});

describe('orgSettings org reads for hooks', () => {
  it('delegates currency, locale defaults and lifecycle state', async () => {
    vi.mocked(orgsDal.getOrgDefaultCurrency).mockResolvedValue('IDR');
    vi.mocked(orgsDal.getOrgLocaleDefaults).mockResolvedValue({ locale: 'id' } as never);
    vi.mocked(orgsDal.getOrgLifecycleState).mockResolvedValue('active' as never);
    await expect(repositories.orgSettings.getDefaultCurrency()).resolves.toBe('IDR');
    await expect(repositories.orgSettings.getLocaleDefaults()).resolves.toEqual({ locale: 'id' });
    await expect(repositories.orgSettings.getLifecycleState()).resolves.toBe('active');
  });

  it('normalizes errors', async () => {
    vi.mocked(orgsDal.getOrgLifecycleState).mockRejectedValue(coded);
    await expect(repositories.orgSettings.getLifecycleState()).rejects.toBeInstanceOf(AppError);
  });
});

describe('agentRun repository', () => {
  it('delegates event and heartbeat reads by run id', async () => {
    vi.mocked(agentEventsDal.listRunEvents).mockResolvedValue([{ id: 'e1' }] as never);
    vi.mocked(agentRunsDal.getRunHeartbeat).mockResolvedValue({ status: 'running', last_progress_at: null });
    await expect(repositories.agentRun.listEvents('r1')).resolves.toEqual([{ id: 'e1' }]);
    expect(agentEventsDal.listRunEvents).toHaveBeenCalledWith('r1');
    await expect(repositories.agentRun.getHeartbeat('r1')).resolves.toEqual({ status: 'running', last_progress_at: null });
    expect(agentRunsDal.getRunHeartbeat).toHaveBeenCalledWith('r1');
  });

  it('delegates thread listing and event rating', async () => {
    vi.mocked(agentThreadsDal.listAgentThreads).mockResolvedValue([{ id: 't1' }] as never);
    vi.mocked(agentEventsDal.rateAgentEvent).mockResolvedValue(undefined);
    await expect(repositories.agentRun.listThreads()).resolves.toEqual([{ id: 't1' }]);
    await repositories.agentRun.rateEvent('e1', 'down', 'wrong');
    expect(agentEventsDal.rateAgentEvent).toHaveBeenCalledWith('e1', 'down', 'wrong');
  });

  it('normalizes errors', async () => {
    vi.mocked(agentRunsDal.getRunHeartbeat).mockRejectedValue(coded);
    await expect(repositories.agentRun.getHeartbeat('r1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('projectMoney repository (composed)', () => {
  it('is on the seam and delegates the collection read', async () => {
    vi.mocked(projectMoneyDal.getProjectsMoneyCollection).mockResolvedValue({ a: {} } as never);
    await expect(repositories.projectMoney.collection(['a'])).resolves.toEqual({ a: {} });
    expect(projectMoneyDal.getProjectsMoneyCollection).toHaveBeenCalledWith(['a']);
  });
});

describe('procurement repository hook reads/writes', () => {
  it('list forwards options only when given', async () => {
    vi.mocked(procurementsDal.listProcurements).mockResolvedValue([] as never);
    await repositories.procurement.list({ withRefs: true });
    expect(procurementsDal.listProcurements).toHaveBeenLastCalledWith({ withRefs: true });
    await repositories.procurement.list();
    expect(procurementsDal.listProcurements).toHaveBeenLastCalledWith();
  });

  it('delegates by-project, committed and reserved spend', async () => {
    vi.mocked(procurementsDal.listProcurementsByProject).mockResolvedValue([{ id: 'x' }] as never);
    vi.mocked(procurementsDal.getProjectCommittedSpend).mockResolvedValue({ amount: 1 } as never);
    vi.mocked(procurementsDal.getProjectReservedSpend).mockResolvedValue({ amount: 2 } as never);
    await expect(repositories.procurement.listByProject('p1')).resolves.toEqual([{ id: 'x' }]);
    expect(procurementsDal.listProcurementsByProject).toHaveBeenCalledWith('p1');
    await expect(repositories.procurement.getProjectCommittedSpend('p1')).resolves.toEqual({ amount: 1 });
    await expect(repositories.procurement.getProjectReservedSpend('p1')).resolves.toEqual({ amount: 2 });
  });

  it('captureVendorInvoice stays on the direct PMO path and preserves code and details', async () => {
    const input = { procurementId: 'p1', status: 'Received', invoiceDate: '2026-01-01', taxTreatment: 'inclusive', taxAmount: 0 } as never;
    vi.mocked(lifecycleDal.captureVendorInvoice).mockResolvedValue({ id: 'inv' } as never);
    await expect(repositories.procurement.captureVendorInvoice(input)).resolves.toEqual({ id: 'inv' });
    expect(lifecycleDal.captureVendorInvoice).toHaveBeenCalledWith(input);

    vi.mocked(lifecycleDal.captureVendorInvoice).mockRejectedValue(Object.assign(new Error('x'), { code: 'P0001', details: 'efaktur-cancelled' }));
    await expect(repositories.procurement.captureVendorInvoice(input)).rejects.toMatchObject({ code: 'P0001', details: 'efaktur-cancelled' });
  });
});

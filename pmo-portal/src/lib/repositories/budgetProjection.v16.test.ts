import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock, rpcMock, chains } = vi.hoisted(() => ({
  fromMock: vi.fn(), rpcMock: vi.fn(), chains: [] as Array<{ table: string; methods: Array<[string, ...unknown[]]> }>,
}));
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: fromMock, rpc: rpcMock } }));
vi.mock('@/src/lib/db/budgets', () => ({ retryBudgetPush: vi.fn() }));
import { releaseActiveBudgetPushHold } from './budgetProjection';
import { budgetAccountIdentity } from '@/src/lib/adapterSeam/erpnext/budgetAccountIdentity';
import { encodeFiscalYear } from '@/src/lib/adapterSeam/erpnext/fiscalYearEncoding';

const versionId = '0bda2222-0000-0000-0000-000000000002';
const activeVersion = { data: { id: versionId }, error: null };
let accountReadError: { message: string; code: string } | null = null;
const mirrorRows = [
  { fiscal_year: 'FY-2026', erp_account: 'Salary' },
  { fiscal_year: 'FY-2026', erp_account: 'COGS' },
];
function builder(table: string) {
  const state = { table, methods: [] as Array<[string, ...unknown[]]> };
  chains.push(state);
  const row = table === 'budget_versions' ? activeVersion
    : table === 'budget_version_account_erp_mirror' ? { data: accountReadError ? null : mirrorRows, error: accountReadError }
      : { data: { id: 'held-command' }, error: null };
  const b: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) {
    b[method] = (...args: unknown[]) => { state.methods.push([method, ...args]); return b; };
  }
  b.maybeSingle = () => { state.methods.push(['maybeSingle']); return Promise.resolve(row); };
  b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(row).then(resolve, reject);
  return b;
}

describe('AC-BV16-006 account-specific release selection', () => {
  beforeEach(() => {
    chains.splice(0);
    accountReadError = null;
    fromMock.mockImplementation((table: string) => builder(table));
    rpcMock.mockResolvedValue({ error: null });
  });

  it('selects only exact account identities from this active version-year plus its legacy identity', async () => {
    await releaseActiveBudgetPushHold('project-1', 'FY-2026');
    const mirror = chains.find((c) => c.table === 'budget_version_account_erp_mirror');
    expect(mirror?.methods).toContainEqual(['eq', 'budget_version_id', versionId]);
    expect(mirror?.methods).toContainEqual(['eq', 'fiscal_year', 'FY-2026']);
    const outbox = chains.find((c) => c.table === 'external_command_outbox');
    expect(outbox?.methods).toContainEqual(['eq', 'domain', 'budget']);
    expect(outbox?.methods).toContainEqual(['in', 'pmo_record_id', [
      budgetAccountIdentity(versionId, 'FY-2026', 'Salary'), budgetAccountIdentity(versionId, 'FY-2026', 'COGS'), `${versionId}:${encodeFiscalYear('FY-2026')}`, versionId,
    ]]);
  });

  it('fails closed if companion account identities cannot be read', async () => {
    accountReadError = { message: 'read denied', code: '42501' };
    await expect(releaseActiveBudgetPushHold('project-1', 'FY-2026')).rejects.toMatchObject({ code: '42501' });
    expect(rpcMock).not.toHaveBeenCalled();
    expect(chains.some((c) => c.table === 'external_command_outbox')).toBe(false);
  });
});

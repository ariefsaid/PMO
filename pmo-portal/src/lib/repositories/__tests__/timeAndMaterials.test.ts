import { beforeEach, expect, it, vi } from 'vitest';
import { itDelegates } from './delegation';

/**
 * #1514 T7.1 (seam half) — the time-and-materials repository (ADR-0017).
 *
 * A thin delegation: every method hands its arguments to the matching DAL function and returns its result, and a DAL
 * failure surfaces as an `AppError` with its code preserved. The RPCs — not this seam — hold every rule, so the seam
 * adds no gate of its own (nothing here filters a row or re-derives an amount).
 */
const m = vi.hoisted(() => ({
  listRateLines: vi.fn(), listRateAssignees: vi.fn(), saveContractRateLine: vi.fn(), endContractRateLine: vi.fn(),
  setContractRateAssignee: vi.fn(), endContractRateAssignee: vi.fn(), assembleTmClaim: vi.fn(), deselectTmSource: vi.fn(),
  prepareTmSignoff: vi.fn(), withdrawTmSignoff: vi.fn(), confirmTmSignoff: vi.fn(), invoiceTmClaimNative: vi.fn(), listTmClaims: vi.fn(),
  previewTmClaim: vi.fn(), listTmClaimSources: vi.fn(),
}));
vi.mock('@/src/lib/db/timeAndMaterials', () => m);

import { timeAndMaterialsRepository as repo } from '../timeAndMaterials';

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
});

const line = { project_id: 'p1', label: 'Site engineer', unit: 'hour' as const, rate: 50000, effective_from: '2026-09-01' };

itDelegates(repo as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>, m, [
  ['listRateLines', 'listRateLines', ['p1', { includeHistory: true }]],
  ['listRateAssignees', 'listRateAssignees', ['p1']],
  ['saveContractRateLine', 'saveContractRateLine', [line]],
  ['endContractRateLine', 'endContractRateLine', [{ projectId: 'p1', lineKey: 'k1', effectiveTo: '2026-12-31', expectedVersion: 2 }]],
  ['setContractRateAssignee', 'setContractRateAssignee', [{ projectId: 'p1', lineKey: 'k1', userId: 'u1', from: '2026-09-01', to: null }]],
  ['endContractRateAssignee', 'endContractRateAssignee', [{ projectId: 'p1', assigneeId: 'a1', effectiveTo: '2026-12-31' }]],
  ['assembleTmClaim', 'assembleTmClaim', [{ projectId: 'p1', from: '2026-09-01', to: '2026-09-30' }]],
  ['deselectTmSource', 'deselectTmSource', ['c1', 's1']],
  ['prepareTmSignoff', 'prepareTmSignoff', [{ claimId: 'c1', documentId: 'd1', note: null }]],
  ['withdrawTmSignoff', 'withdrawTmSignoff', ['c1']],
  ['confirmTmSignoff', 'confirmTmSignoff', ['c1']],
  ['invoiceNativeTmClaim', 'invoiceTmClaimNative', ['c1']],
  ['listTmClaims', 'listTmClaims', ['p1']],
  ['previewTmClaim', 'previewTmClaim', [{ projectId: 'p1', from: '2026-09-01', to: '2026-09-30' }]],
  ['listTmClaimSources', 'listTmClaimSources', ['c1']],
]);

it('T7.1 the seam adds no rule of its own: a claim list is returned exactly as the RPC bounded it', async () => {
  const page = { rows: [{ id: 'c1' }], truncated: true };
  m.listTmClaims.mockResolvedValueOnce(page);
  await expect(repo.listTmClaims('p1')).resolves.toBe(page);
  expect(m.listTmClaims).toHaveBeenCalledExactlyOnceWith('p1');
});

it('AC-TM-020 repo: invoiceNativeTmClaim never dispatches to an ERP', async () => {
  m.invoiceTmClaimNative.mockResolvedValueOnce('c1');
  await expect(repo.invoiceNativeTmClaim('c1')).resolves.toBe('c1');
  expect(m.invoiceTmClaimNative).toHaveBeenCalledExactlyOnceWith('c1');
});

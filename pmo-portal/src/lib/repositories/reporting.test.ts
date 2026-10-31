import { describe, vi } from 'vitest';
import * as snapshots from '@/src/lib/db/erpSnapshots';
import * as pack from '@/src/lib/db/managementPack';
import { erpSnapshotsRepository, reportsRepository } from './reporting';
import { itDelegates } from './__tests__/delegation';

vi.mock('@/src/lib/db/erpSnapshots');
vi.mock('@/src/lib/db/managementPack');

describe('erpSnapshotsRepository', () => {
  itDelegates(erpSnapshotsRepository as never, snapshots, [
    ['actuals', 'listActualsSnapshot', []],
    ['apAging', 'listApAgingSnapshot', []],
    ['arAging', 'listArAgingSnapshot', []],
  ]);
});

describe('reportsRepository', () => {
  itDelegates(reportsRepository as never, pack, [
    ['managementPack', 'getManagementPackFacts', [{ from: '2026-01-01', to: '2026-01-31' }]],
    ['recordProgress', 'recordProjectProgress', [{ projectId: 'p1', percent: 40 }]],
  ]);
});

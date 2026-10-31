/** Reporting implementations: ERP snapshots (ADR-0048) and the management pack (ADR-0076). */
import { listActualsSnapshot, listApAgingSnapshot, listArAgingSnapshot } from '@/src/lib/db/erpSnapshots';
import { getManagementPackFacts, recordProjectProgress } from '@/src/lib/db/managementPack';
import { wrap } from './repositoryErrors';
import type { ErpSnapshotsRepository, ReportsRepository } from './contracts/reporting';

export const erpSnapshotsRepository: ErpSnapshotsRepository = {
  actuals: () => wrap(() => listActualsSnapshot()),
  apAging: () => wrap(() => listApAgingSnapshot()),
  arAging: () => wrap(() => listArAgingSnapshot()),
};

export const reportsRepository: ReportsRepository = {
  managementPack: (range) => wrap(() => getManagementPackFacts(range)),
  recordProgress: (input) => wrap(() => recordProjectProgress(input)),
};

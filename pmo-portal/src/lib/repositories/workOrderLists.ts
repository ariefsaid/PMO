/** repositories/workOrderLists.ts (#2668) — the seam over the organisation's work-order area and group lists. */
import {
  listWorkOrderListEntries, createWorkOrderListEntry, updateWorkOrderListEntry, archiveWorkOrderListEntry,
  listBoqItemAreaRates, setBoqItemAreaRate, type BoqAreaRate,
  type WorkOrderListKind, type WorkOrderListInput, type WorkOrderListEntry,
} from '@/src/lib/db/workOrderLists';
import { wrap } from './repositoryErrors';

export type { WorkOrderListKind, WorkOrderListInput, WorkOrderListEntry, BoqAreaRate };
export { LIST_CODE_MAX, LIST_NAME_MAX, LIST_DESCRIPTION_MAX } from '@/src/lib/db/workOrderLists';

export const workOrderListRepository = {
  list: (kind: WorkOrderListKind) => wrap(() => listWorkOrderListEntries(kind)),
  create: (kind: WorkOrderListKind, input: WorkOrderListInput) => wrap(() => createWorkOrderListEntry(kind, input)),
  update: (kind: WorkOrderListKind, id: string, input: WorkOrderListInput) => wrap(() => updateWorkOrderListEntry(kind, id, input)),
  archive: (kind: WorkOrderListKind, id: string) => wrap(() => archiveWorkOrderListEntry(kind, id)),
  areaRates: (boqItemId: string) => wrap(() => listBoqItemAreaRates(boqItemId)),
  setAreaRate: (boqItemId: string, areaId: string, rate: string | null) => wrap(() => setBoqItemAreaRate(boqItemId, areaId, rate)),
};

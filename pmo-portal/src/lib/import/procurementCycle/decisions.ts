import type { ImportSkipLookup, ImportRecordMatch, RecordTableName } from '@/src/lib/db/procurementImportSkip';
import type { CycleRow, CycleType } from './types';
import { computeRecordImportKey } from './importKey';

export const TYPE_TO_TABLE: Record<CycleType, RecordTableName> = {
  PR: 'purchase_requests', RFQ: 'rfqs', Quotation: 'procurement_quotations',
  PO: 'purchase_orders', GR: 'procurement_receipts', VI: 'procurement_invoices', Payment: 'payments',
};

export type ImportDecision =
  | { kind: 'new' }
  | { kind: 'same'; id: string }
  | { kind: 'other'; id: string; batch: string };

export async function decideCase(lookup: ImportSkipLookup, key: string, batch: string): Promise<ImportDecision> {
  const same = await lookup.findExistingCase(key, batch);
  if (same) return { kind: 'same', id: same.id };
  const other = await lookup.findCrossBatchCollision('procurements', key, batch);
  return other ? { kind: 'other', id: other.id, batch: other.import_batch_id } : { kind: 'new' };
}

function matchDecision(matches: ImportRecordMatch[], batch: string): ImportDecision {
  const same = matches.filter(row => row.import_batch_id === batch);
  if (same.length > 1) throw new Error('Unexpected duplicate import records');
  if (same[0]) return { kind: 'same', id: same[0].id };
  const other = matches.find(row => row.import_batch_id !== batch);
  return other ? { kind: 'other', id: other.id, batch: other.import_batch_id } : { kind: 'new' };
}

export function caseDecider(lookup: ImportSkipLookup, keys: string[], batch: string) {
  let snapshot: Promise<Map<string, ImportRecordMatch[]>> | undefined;
  return async (key: string, fresh = false): Promise<ImportDecision> => {
    if (!lookup.listCases) return decideCase(lookup, key, batch);
    if (fresh) return matchDecision(await lookup.listCases([key]), batch);
    snapshot ??= lookup.listCases(keys).then(rows => {
      const index = new Map<string, ImportRecordMatch[]>();
      for (const row of rows) {
        const matches = index.get(row.import_key) ?? [];
        matches.push(row);
        index.set(row.import_key, matches);
      }
      return index;
    });
    return matchDecision((await snapshot).get(key) ?? [], batch);
  };
}

export function recordDecider(lookup: ImportSkipLookup, caseId: string, batch: string, rows: CycleRow[]) {
  const keys = new Map<RecordTableName, string[]>();
  for (const row of rows) {
    const table = TYPE_TO_TABLE[row.type as CycleType];
    if (table) {
      const tableKeys = keys.get(table) ?? [];
      tableKeys.push(computeRecordImportKey(row));
      keys.set(table, tableKeys);
    }
  }
  const indexes = new Map<RecordTableName, Promise<Map<string, ImportRecordMatch[]>>>();
  return async (table: RecordTableName, key: string, fresh = false): Promise<ImportDecision> => {
    if (lookup.listCaseRecords) {
      let index = indexes.get(table);
      if (!index) {
        index = lookup.listCaseRecords(table, caseId, keys.get(table) ?? []).then(rows => {
          const grouped = new Map<string, ImportRecordMatch[]>();
          for (const row of rows) {
            const matches = grouped.get(row.import_key);
            if (matches) matches.push(row);
            else grouped.set(row.import_key, [row]);
          }
          return grouped;
        });
        indexes.set(table, index);
      }
      const matches = fresh ? await lookup.listCaseRecords(table, caseId, [key]) : (await index).get(key) ?? [];
      return matchDecision(matches, batch);
    }
    const same = await lookup.findExistingRecord(table, caseId, key, batch);
    if (same) return { kind: 'same', id: same.id };
    const other = await lookup.findCrossBatchCollision(table, key, batch, caseId);
    return other ? { kind: 'other', id: other.id, batch: other.import_batch_id } : { kind: 'new' };
  };
}

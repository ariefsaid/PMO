import type { ImportSkipLookup, ImportRecordMatch, RecordTableName } from '@/src/lib/db/procurementImportSkip';
import type { CycleRow, CycleType, ValidatedGroup } from './types';
import type { RefLookup } from '@/src/lib/import/refLookup';
import { refId } from '@/src/lib/import/refLookup';
import { computeRecordImportKey, computeLegacyRecordImportKey, projectRecordFacts } from './importKey';

export const TYPE_TO_TABLE: Record<CycleType, RecordTableName> = {
  PR: 'purchase_requests', RFQ: 'rfqs', Quotation: 'procurement_quotations',
  PO: 'purchase_orders', GR: 'procurement_receipts', VI: 'procurement_invoices', Payment: 'payments',
};

export type ImportDecision =
  | { kind: 'new' }
  | { kind: 'ambiguous'; ids: string[] }
  | { kind: 'same'; id: string }
  | { kind: 'other'; id: string; batch: string | null };

export function caseDecider(lookup: ImportSkipLookup, keys: string[], _batch: string) {
  type Snapshot = { normalized: Map<string, string>; index: Map<string, ImportRecordMatch[]> };
  let snapshot: Promise<Snapshot> | undefined;
  const load = async (refs: string[]): Promise<Snapshot> => {
    const normalized = lookup.normalizeCases ? await lookup.normalizeCases(refs) : new Map(refs.map(key => [key, key]));
    const index = new Map<string, ImportRecordMatch[]>();
    for (const row of await lookup.listCases!(refs)) {
      const key = row.normalized_ref ?? row.import_key;
      const matches = index.get(key) ?? [];
      matches.push(row);
      index.set(key, matches);
    }
    return { normalized, index };
  };
  return async (key: string, fresh = false): Promise<ImportDecision> => {
    if (!lookup.listCases) throw new Error('Normalized case lookup is unavailable.');
    snapshot ??= load(keys);
    const { normalized, index } = fresh ? await load([key]) : await snapshot;
    const matches = index.get(normalized.get(key) ?? key) ?? [];
    if (matches.length > 1) return { kind: 'ambiguous', ids: matches.map(row => row.id) };
    if (matches.length === 1) return { kind: 'same', id: matches[0].id };
    return { kind: 'new' };
  };
}

export function recordDecider(lookup: ImportSkipLookup, caseId: string, _batch: string, rows: CycleRow[], vendorLookup?: RefLookup) {
  const keys = new Map<RecordTableName, string[]>();
  for (const row of rows) {
    const table = TYPE_TO_TABLE[row.type as CycleType];
    if (table) {
      const tableKeys = keys.get(table) ?? [];
      tableKeys.push(computeLegacyRecordImportKey(row));
      tableKeys.push(computeRecordImportKey(row, projectRecordFacts(row, vendorLookup && row.vendor ? refId(vendorLookup, row.vendor) : null, null)));
      keys.set(table, tableKeys);
    }
  }
  const indexes = new Map<RecordTableName, Promise<Map<string, ImportRecordMatch[]>>>();
  return async (table: RecordTableName, row: CycleRow, fresh = false, invoiceId: string | null = null, symbolicInvoice = false): Promise<Exclude<ImportDecision, { kind: 'ambiguous' }>> => {
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
      const key = computeLegacyRecordImportKey(row);
      const facts = projectRecordFacts(row, vendorLookup && row.vendor ? refId(vendorLookup, row.vendor) : null, invoiceId);
      const v2Key = computeRecordImportKey(row, facts);
      const snapshot = await index;
      const dynamicPayment = row.type === 'Payment' && invoiceId !== null && !row.externalRef?.trim();
      const matches = fresh || dynamicPayment ? await lookup.listCaseRecords(table, caseId, [key, v2Key]) : [...(snapshot.get(key) ?? []), ...(snapshot.get(v2Key) ?? [])];
      const relevant = symbolicInvoice && !row.externalRef?.trim() ? matches.filter(match => match.import_key === key) : matches;
      const unknown = relevant.find(match => match.import_identity_version !== 2 || !Array.isArray(match.import_identity_facts));
      if (unknown) return { kind: 'other', id: unknown.id, batch: unknown.import_batch_id };
      const marked = relevant.find(match => match.import_key === v2Key);
      if (!marked) return { kind: 'new' };
      if (symbolicInvoice) return { kind: 'other', id: marked.id, batch: marked.import_batch_id };
      return JSON.stringify(marked.import_identity_facts) === JSON.stringify(facts)
        ? { kind: 'same', id: marked.id }
        : { kind: 'other', id: marked.id, batch: marked.import_batch_id };

    }
    throw new Error('Record identity lookup is unavailable.');
  };
}

export async function ambiguousIncomingCases(groups: ValidatedGroup[], lookup: ImportSkipLookup): Promise<Set<ValidatedGroup>> {
  const conflicts = new Set<ValidatedGroup>();
  if (!lookup.normalizeCases) return conflicts;
  const refs = [...new Set(groups.flatMap(({ group }) => [group.caseRef, ...group.rows.map(row => row.caseRef ?? group.caseRef)]))];
  const normalized = await lookup.normalizeCases(refs);
  const owners = new Map<string, ValidatedGroup[]>();
  for (const item of groups) {
    const key = normalized.get(item.group.caseRef);
    if (key === undefined) throw new Error('Incomplete case normalization');
    if (item.group.rows.some(row => normalized.get(row.caseRef ?? item.group.caseRef) !== key)) conflicts.add(item);
    owners.set(key, [...(owners.get(key) ?? []), item]);
  }
  for (const matches of owners.values()) if (matches.length > 1) for (const item of matches) conflicts.add(item);
  return conflicts;
}

export function duplicateRecordRows(rows: CycleRow[], vendorLookup?: RefLookup): Set<number> {
  const seen = new Map<string, number[]>();
  for (const row of rows) {
    const vendor = vendorLookup && row.vendor ? refId(vendorLookup, row.vendor) : null;
    const invoice = row.type === 'Payment' && rows.some(item => item.type === 'VI') ? 'pending-invoice' : null;
    const key = `${row.type}:${computeRecordImportKey(row, projectRecordFacts(row, vendor, invoice))}`;
    seen.set(key, [...(seen.get(key) ?? []), row.rowNumber]);
  }
  return new Set([...seen.values()].filter(numbers => numbers.length > 1).flat());
}

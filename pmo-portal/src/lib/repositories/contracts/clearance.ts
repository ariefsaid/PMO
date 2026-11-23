import type {
  ClearanceItemInput, ClearanceItemRow, ClearanceStateInput, ClearanceSummaryRow, PersonChecklistRow, PersonClearanceDueRow,
} from '@/src/lib/db/clearance';

/** Cleared-for-site checklist contract (#2707, ADR-0017). */
export interface ClearanceRepository {
  items(): Promise<ClearanceItemRow[]>;
  createItem(input: ClearanceItemInput): Promise<void>;
  updateItem(id: string, patch: Partial<ClearanceItemInput> & { archived_at?: string | null }): Promise<void>;
  summary(): Promise<ClearanceSummaryRow[]>;
  /** Per-(person, item) due day and the database's overdue answer — one batch read (#2800). */
  due(): Promise<PersonClearanceDueRow[]>;
  checklist(personId: string): Promise<PersonChecklistRow[]>;
  saveState(personId: string, itemId: string, input: ClearanceStateInput): Promise<void>;
  clearState(personId: string, itemId: string): Promise<void>;
}

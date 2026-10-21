import type { QueryClient } from '@tanstack/react-query';
import type { RecordFolderTarget } from '@/src/lib/m365/recordFolders';
import type { RecordFolderCopy } from '@/src/lib/m365/recordFolderCopy';

/**
 * Per-record folder status lives in the query cache (not component state) so the register still
 * shows "Record saved. Folder not linked." after the create modal unmounted or the user navigated.
 * The key carries org + caller: one member's outcome must never surface for another identity.
 * Only the safe copy descriptor is stored — never a raw error, name, path or id.
 */
export type RecordFolderState =
  | { status: 'pending' }
  | { status: 'settled'; copy: RecordFolderCopy };

export const recordFolderKey = (
  orgId: string | null | undefined,
  userId: string | null | undefined,
  target: RecordFolderTarget,
) => ['m365-record-folder', orgId ?? null, userId ?? null, target.kind, target.id] as const;

/** Refresh the register that shows this record's folder reference. */
export function invalidateRecordFolderRegister(
  qc: QueryClient,
  orgId: string | null | undefined,
  target: RecordFolderTarget,
): void {
  if (target.kind === 'project') {
    void qc.invalidateQueries({ queryKey: ['project-documents', orgId, target.id] });
  } else {
    void qc.invalidateQueries({ queryKey: ['procurement-docs', orgId, target.id] });
    void qc.invalidateQueries({ queryKey: ['procurement', orgId, target.id] });
  }
}

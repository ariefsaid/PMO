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

/** The case References register (the list that decides `hasFolder`). The one key shared with its reader. */
export const procurementDocumentsKey = (orgId: string | null | undefined, id?: string) =>
  (id === undefined ? ['procurement-documents', orgId] : ['procurement-documents', orgId, id]) as readonly unknown[];

/** Refresh the register that shows this record's folder reference. */
export function invalidateRecordFolderRegister(
  qc: QueryClient,
  orgId: string | null | undefined,
  target: RecordFolderTarget,
): void {
  if (target.kind === 'project') {
    void qc.invalidateQueries({ queryKey: ['project-documents', orgId, target.id] });
  } else {
    void qc.invalidateQueries({ queryKey: procurementDocumentsKey(orgId, target.id) });
    void qc.invalidateQueries({ queryKey: ['procurement', orgId, target.id] });
  }
}

/** Write the per-record state. (A function updater keeps tanstack's untagged-key inference happy.) */
export function writeRecordFolderState(
  qc: QueryClient,
  key: ReturnType<typeof recordFolderKey>,
  state: RecordFolderState,
): void {
  qc.setQueryData<RecordFolderState>(key, () => state);
}

/** Causes already warned about in this browser session (module scope = one per page load). */
const warnedCauses = new Set<string>();
/** True the first time a cause is seen; false afterwards. */
export const claimRecordFolderWarning = (cause: string): boolean => {
  if (warnedCauses.has(cause)) return false;
  warnedCauses.add(cause);
  return true;
};
/** Test seam only. */
export const resetRecordFolderToastSession = (): void => warnedCauses.clear();

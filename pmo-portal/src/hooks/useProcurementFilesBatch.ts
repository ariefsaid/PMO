import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { repositories } from '@/src/lib/repositories';
import { procurementFileParentKey, type ProcurementFileParent, type ProcurementFileRow } from '@/src/lib/db/procurementFiles';

/** The files of every given record in ONE read (the timeline's entries), keyed by `procurementFileParentKey`. */
export function useProcurementFilesBatch(procurementId: string, parents: readonly ProcurementFileParent[]) {
  const keys = parents.map((p) => procurementFileParentKey(p.phase, p.parentId)).sort();
  return useQuery<Record<string, ProcurementFileRow[] | null>>({
    queryKey: ['procurement-files-batch', procurementId, keys],
    queryFn: () => repositories.procurementFiles.listForParents(parents),
    enabled: parents.length > 0,
    // A new record changes the key; keep the answered records showing while the next read lands.
    placeholderData: keepPreviousData,
  });
}

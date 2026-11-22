/** repositories/stockOpening.ts — the seam over the opening-stock history load (ADR-0017). */
import * as db from '@/src/lib/db/stockOpening';
import type { StockMovementRow } from '@/src/lib/import/stockMovementHistoryDescriptor';
import { wrap } from './repositoryErrors';

export type { OpeningPreviewRow } from '@/src/lib/db/stockOpening';

export const stockOpeningRepository = {
  preview: (asOf: string, rows: readonly StockMovementRow[]) => wrap(() => db.previewOpeningHistory(asOf, rows)),
  load: (asOf: string, rows: readonly StockMovementRow[], requestId: string, note?: string) => wrap(() => db.loadOpeningHistory(asOf, rows, requestId, note)),
};

/**
 * useExport — builds rows into a typed `.xlsx` (lazy exceljs) or a CSV, and triggers a browser download
 * named `<Entity>_<YYYY-MM-DD>.<ext>`.
 *
 * Read-only re-serialization of in-memory rows (NFR-2): no endpoint, query, or `org_id` handling — the
 * export can only contain rows RLS already returned.
 *
 * Resilience (AC-G3D-RESILIENCE): lazy-import/serialization failures are caught and toasted as
 * "Export failed" so the button doesn't appear dead on failure.
 */

import { useCallback, useState } from 'react';
import type { Column } from '@/src/components/ui';
import { useToast } from '@/src/components/ui';
import { buildExportRows, exportFilename, toCsv, toWorkbookBuffer, type ExportTable } from '@/src/lib/export';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CSV_MIME = 'text/csv;charset=utf-8';

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function useExport() {
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();

  const reportFailure = useCallback(
    (err: unknown) => {
      const { headline, detail } = classifyMutationError(err);
      // Re-classify the generic headline for exports so the user understands
      // it is specifically the export that failed (not a data mutation).
      const exportHeadline = headline === 'Update failed' ? 'Export failed' : headline;
      toast(exportHeadline, detail, 'warning');
    },
    [toast],
  );

  const exportXlsx = useCallback(
    async <Row,>(rows: Row[], columns: Column<Row>[], entity: string) => {
      setBusy(true);
      try {
        const { header, body } = buildExportRows(rows, columns);
        const buf = await toWorkbookBuffer({ sheetName: entity, header, body });
        triggerDownload(new Blob([buf], { type: XLSX_MIME }), exportFilename(entity));
      } catch (err) {
        reportFailure(err);
      } finally {
        setBusy(false);
      }
    },
    [reportFailure],
  );

  /** #765: export a table the caller already built (e.g. the management pack's long format). */
  const exportTable = useCallback(
    async (table: ExportTable, entity: string, format: 'xlsx' | 'csv') => {
      setBusy(true);
      try {
        const blob =
          format === 'csv'
            ? new Blob([toCsv(table)], { type: CSV_MIME })
            : new Blob([await toWorkbookBuffer({ sheetName: entity, ...table })], { type: XLSX_MIME });
        triggerDownload(blob, exportFilename(entity, new Date(), format));
      } catch (err) {
        reportFailure(err);
      } finally {
        setBusy(false);
      }
    },
    [reportFailure],
  );

  return { exportXlsx, exportTable, busy };
}

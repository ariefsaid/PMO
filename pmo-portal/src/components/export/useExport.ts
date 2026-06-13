/**
 * useExport — builds the visible rows into a typed `.xlsx` buffer (lazy exceljs)
 * and triggers a browser download named `<Entity>_<YYYY-MM-DD>.xlsx`.
 *
 * Read-only re-serialization of in-memory rows (NFR-2): no endpoint, query, or
 * `org_id` handling — the export can only contain rows RLS already returned.
 */

import { useCallback, useState } from 'react';
import type { Column } from '@/src/components/ui';
import { buildExportRows, exportFilename, toWorkbookBuffer } from '@/src/lib/export';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export function useExport() {
  const [busy, setBusy] = useState(false);

  const exportXlsx = useCallback(
    async <Row,>(rows: Row[], columns: Column<Row>[], entity: string) => {
      setBusy(true);
      try {
        const { header, body } = buildExportRows(rows, columns);
        const buf = await toWorkbookBuffer({ sheetName: entity, header, body });
        const blob = new Blob([buf], { type: XLSX_MIME });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = exportFilename(entity);
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  return { exportXlsx, busy };
}

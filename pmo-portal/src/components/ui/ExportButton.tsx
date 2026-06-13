/**
 * ExportButton — reusable toolbar button that triggers an xlsx download of the
 * current DataTable view. Lazy-loads exceljs via useExport so it never touches
 * the initial route chunk.
 *
 * Usage (1-3 lines per page):
 *   <ExportButton rows={filtered} columns={columns} filename="companies-export" />
 */

import React, { useCallback, useState } from 'react';
import { Button } from './Button';
import { Icon } from './icons';
import type { Column } from './DataTable';

export interface ExportButtonProps<Row> {
  /** The currently-displayed (filtered) rows. */
  rows: Row[];
  /** The DataTable column definitions (may include `exportValue`). */
  columns: Column<Row>[];
  /** Base filename without extension (e.g. `"companies-2026-06-13"`). */
  filename: string;
  /** Optional additional class names forwarded to the Button. */
  className?: string;
}

/**
 * Toolbar-ready Export button. Disabled when `rows` is empty (nothing to export).
 * Shows a loading/busy state while the xlsx is being serialized.
 */
export function ExportButton<Row>({
  rows,
  columns,
  filename,
  className,
}: ExportButtonProps<Row>) {
  const [loading, setLoading] = useState(false);

  const handleExport = useCallback(async () => {
    if (loading || rows.length === 0) return;
    setLoading(true);
    try {
      // Lazy import keeps exceljs out of the initial chunk
      const { exportToXlsx } = await import('@/src/lib/export/exportToXlsx');
      await exportToXlsx(rows, columns, filename);
    } finally {
      setLoading(false);
    }
  }, [rows, columns, filename, loading]);

  return (
    <Button
      variant="outline"
      disabled={rows.length === 0 || loading}
      loading={loading}
      aria-label="Export to Excel"
      onClick={() => void handleExport()}
      className={className}
    >
      <Icon name="download" />
      Export
    </Button>
  );
}

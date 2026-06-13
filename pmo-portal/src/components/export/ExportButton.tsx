/**
 * ExportButton — shared opt-in export affordance. Drop into a page `<Toolbar>`:
 *   <ExportButton rows={filtered} columns={columns} entity="Companies" />
 *
 * Disabled when the visible list is empty (FR-5) or while serializing (busy).
 * A real `<button>` with an accessible "Export" name (NFR-1) — no tooltip
 * wrapper (that pattern was only for the disabled "coming soon" stub).
 */

import React from 'react';
import { Button, Icon, type Column } from '@/src/components/ui';
import { useExport } from './useExport';

export interface ExportButtonProps<Row> {
  /** The currently-visible (filtered + sorted) rows. */
  rows: Row[];
  /** The DataTable column definitions (may include `exportValue`). */
  columns: Column<Row>[];
  /** Entity label used for the sheet name + filename (<Entity>_<date>.xlsx). */
  entity: string;
  /** Optional extra disabling (e.g. permission). */
  disabled?: boolean;
  /** Optional extra class forwarded to the Button. */
  className?: string;
}

export function ExportButton<Row>({
  rows,
  columns,
  entity,
  disabled,
  className,
}: ExportButtonProps<Row>) {
  const { exportXlsx, busy } = useExport();
  return (
    <Button
      variant="outline"
      disabled={disabled || busy || rows.length === 0}
      loading={busy}
      onClick={() => void exportXlsx(rows, columns, entity)}
      className={className}
    >
      <Icon name="export" />
      Export
    </Button>
  );
}

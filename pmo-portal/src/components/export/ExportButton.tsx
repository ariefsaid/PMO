/**
 * ExportButton — shared opt-in export affordance. Drop into a page `<Toolbar>`:
 *   <ExportButton rows={filtered} columns={columns} entity="Companies" />
 *
 * Disabled when the visible list is empty (FR-5) or while serializing (busy).
 * A real `<button>` with an accessible "Export" name (NFR-1) — no tooltip
 * wrapper (that pattern was only for the disabled "coming soon" stub).
 */

import React from 'react';
import { useTranslation } from 'react-i18next';
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
  /** Button text. Defaults to the catalogue's Export word (`projects.export`: "Export" / "Ekspor",
      #2345 row 11) — set it when a localized/custom label is needed. */
  label?: string;
  /** Optional callback fired when Export dispatches (e.g. to close a mobile disclosure). */
  onExport?: () => void;
  /** `sm` beside a panel header's other small actions, so the row's buttons share one height. */
  size?: 'sm';
}

export function ExportButton<Row>({
  rows,
  columns,
  entity,
  disabled,
  className,
  label,
  onExport,
  size,
}: ExportButtonProps<Row>) {
  const { t } = useTranslation();
  const { exportXlsx, busy } = useExport();
  return (
    <Button
      variant="outline"
      size={size}
      disabled={disabled || busy || rows.length === 0}
      loading={busy}
      onClick={() => {
        void exportXlsx(rows, columns, entity);
        onExport?.();
      }}
      className={className}
    >
      <Icon name="export" />
      {label ?? t('projects.export', 'Export')}
    </Button>
  );
}

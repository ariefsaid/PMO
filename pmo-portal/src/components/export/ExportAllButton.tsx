/**
 * ExportAllButton — the Export affordance for SERVER-PAGED directories (#1989). The page holds
 * ONE server page of rows, but Export must keep delivering EVERY row matching the current
 * filter/search (the pre-paging ExportButton contract: `rows` was the full filtered set). So the
 * page hands this button a FETCHER; the full matching set is read at click time and handed to
 * the same XLSX writer the plain ExportButton uses. Never writes a partial set: a failed fetch
 * exports nothing.
 */

import React from 'react';
import { Button, Icon, type Column } from '@/src/components/ui';
import { useExport } from './useExport';

export interface ExportAllButtonProps<Row> {
  /** Reads EVERY row matching the page's current filter/search (the repository full-set read). */
  fetchRows: () => Promise<Row[]>;
  /** The DataTable column definitions (may include `exportValue`). */
  columns: Column<Row>[];
  /** Whether the matching set is non-empty (the page's server total > 0). */
  hasRows: boolean;
  /** Entity label used for the sheet name + filename (<Entity>_<date>.xlsx). */
  entity: string;
  /** Optional extra disabling (e.g. permission). */
  disabled?: boolean;
  /** Optional extra class forwarded to the Button. */
  className?: string;
}

export function ExportAllButton<Row>({
  fetchRows,
  columns,
  hasRows,
  entity,
  disabled,
  className,
}: ExportAllButtonProps<Row>) {
  const { exportXlsx, busy } = useExport();
  const [fetching, setFetching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const handleExport = async () => {
    setError(null);
    setFetching(true);
    try {
      const rows = await fetchRows();
      // An empty full read (rows deleted since the page loaded) still writes a header-only
      // sheet — the same outcome the plain ExportButton had for a filtered-to-zero list.
      await exportXlsx(rows, columns, entity);
    } catch {
      setError('Could not complete the export. Try again.');
    } finally {
      setFetching(false);
    }
  };
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <Button
        variant="outline"
        disabled={disabled || busy || fetching || !hasRows}
        loading={busy || fetching}
        onClick={() => void handleExport()}
        className={className}
      >
        <Icon name="export" />
        Export
      </Button>
      {error && <p role="alert" className="text-control text-destructive-text">{error}</p>}
    </div>
  );
}

/**
 * DataTableWidget — item 5 (F1, Discover finding): wraps DataTable with a
 * caption header (the ChartFrame idiom — a small semibold label above the
 * primitive, matching StatusBarChart's `label`/HydratedPrimitive Card's
 * `title`) and a right-edge scroll-mask affordance (DESIGN.md's Kanban
 * mask-fade pattern) that appears ONLY when the table's content actually
 * overflows its container (scrollWidth>clientWidth) — never a fixed
 * always-on fade.
 *
 * Extracted to its own file (not colocated in registry.tsx) so the module
 * only exports a component — registry.tsx exports the non-component
 * `renderWidget` function too, which trips react-refresh/only-export-components.
 */
import React, { useEffect, useRef, useState } from 'react';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import type { DataTableWidget as DataTableWidgetPayload } from '@/src/lib/agent/widgets/schema';

function tableIdForWidget(widget: DataTableWidgetPayload): string {
  const identity = `${widget.caption ?? ''}:${widget.columns.map((column) => column.key).join(',')}`;
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  const slug = (widget.caption ?? 'table').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'table';
  return `agent-widget-${slug}-${(hash >>> 0).toString(36)}-table`;
}

export function DataTableWidget({ widget }: { widget: DataTableWidgetPayload }): React.ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const check = () => setIsOverflowing(el.scrollWidth > el.clientWidth);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, [widget]);

  const columns: Column<Record<string, unknown>>[] = widget.columns.map((c) => ({
    key: c.key,
    header: c.label,
    cell: (row) => {
      const v = row[c.key];
      return v == null ? '' : String(v);
    },
  }));

  return (
    <div>
      {widget.caption && (
        <p
          data-testid="data-table-widget-caption"
          className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
        >
          {widget.caption}
        </p>
      )}
      <div ref={scrollRef} className="relative">
        <DataTable
          rows={widget.rows}
          columns={columns}
          rowKey={(row) => String(row.id ?? JSON.stringify(row))}
        tableId={tableIdForWidget(widget)} />
        {isOverflowing && (
          <div
            data-testid="data-table-widget-scroll-mask"
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-7 bg-gradient-to-r from-transparent to-card"
          />
        )}
      </div>
    </div>
  );
}

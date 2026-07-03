/**
 * Widget renderer registry — kind → existing PMO primitive (FR-ATC-005).
 *
 * Mirrors HydratedPrimitive.tsx's switch-over-registry shape: hydrates the
 * SAME shipped components (DataTable / StatusBarChart+ChartFrame / KPITile)
 * with an already-validated WidgetPayload. This function is only ever
 * called on a payload that has already passed WIDGET_PAYLOAD_SCHEMA
 * (WidgetSlot validates first) — it never renders raw/untrusted content
 * (NFR-ATC-SEC-002).
 */
import React from 'react';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { KPITile } from '@/src/components/ui/KPITile';
import { StatusBarChart } from '@/src/components/dashboard/StatusBarChart';
import { ChartFrame } from '@/src/components/dashboard/ChartFrame';
import { chartTheme } from '@/src/components/ui/chartTheme';
import type { WidgetPayload } from '@/src/lib/agent/widgets/schema';

const TEXT_FALLBACK = (
  <div
    role="note"
    className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground"
  >
    This result couldn&apos;t be displayed.
  </div>
);

/**
 * Renders a WidgetPayload as the mapped PMO primitive. `data_chart`'s
 * `chartType` is schema-valid for `bar|line|donut` but v1 maps all three to
 * the shipped bar primitive (ChartFrame + StatusBarChart) — PMO has no
 * shipped line/donut chart in the panel's import surface yet (ADR-0045 §1;
 * per-type rendering is a future registry entry, not an architecture change).
 */
export function renderWidget(widget: WidgetPayload): React.ReactElement {
  switch (widget.kind) {
    case 'data_table': {
      const columns: Column<Record<string, unknown>>[] = widget.columns.map((c) => ({
        key: c.key,
        header: c.label,
        cell: (row) => {
          const v = row[c.key];
          return v == null ? '' : String(v);
        },
      }));
      return (
        <DataTable
          rows={widget.rows}
          columns={columns}
          rowKey={(row) => String(row.id ?? JSON.stringify(row))}
        />
      );
    }
    case 'data_chart': {
      const chartData = widget.series.map((s) => ({ status: s.label, count: s.value }));
      const seriesTokens = Object.values(chartTheme.series);
      const labels = chartData.map((d) => d.status);
      const toneFor = (status: string) =>
        seriesTokens[Math.max(0, labels.indexOf(status)) % seriesTokens.length];
      return (
        <ChartFrame state="ready">
          {/* Item 4 (F2, review-remediation): the panel is a fixed ~365px-content-width
              container — far narrower than StatusBarChart's own useIsNarrow() viewport-
              width branch would ever detect on a desktop screen. compactYAxis (container-
              appropriate, opt-in) hides the Y-axis ticks + pins an explicit domain so the
              chart can never render a non-monotonic/garbled axis at this width; the
              existing figcaption legend already carries every count. */}
          <StatusBarChart
            data={chartData}
            toneFor={toneFor}
            label={widget.caption ?? 'Results'}
            noun="items"
            compactYAxis
          />
        </ChartFrame>
      );
    }
    case 'data_insight': {
      return (
        <KPITile
          icon="doc"
          tone={widget.tone ?? 'blue'}
          label={widget.label}
          value={widget.value}
          delta={widget.delta}
        />
      );
    }
    default: {
      // Exhaustiveness guard — WidgetPayload is a closed zod discriminated
      // union, so every real member is handled above. This branch only
      // fires if a future kind is added to the schema without a registry
      // case; it fails safe to the text fallback, never raw payload
      // (NFR-ATC-SEC-002).
      const _exhaustive: never = widget;
      void _exhaustive;
      return TEXT_FALLBACK;
    }
  }
}

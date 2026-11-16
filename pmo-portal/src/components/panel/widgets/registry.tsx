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
import { KPITile } from '@/src/components/ui/KPITile';
import type { WidgetPayload } from '@/src/lib/agent/widgets/schema';
import { DataTableWidget } from './DataTableWidget';
import { WidgetFallback } from './WidgetFallback';
import { ChartWidget } from './ChartWidget';

const TEXT_FALLBACK = <WidgetFallback />;

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
      return <DataTableWidget widget={widget} />;
    }
    case 'data_chart': {
      return <ChartWidget widget={widget} />;
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

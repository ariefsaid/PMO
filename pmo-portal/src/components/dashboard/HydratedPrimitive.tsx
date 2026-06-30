/**
 * HydratedPrimitive — extracted from UserViewRenderer (D5, CV-OD-003).
 *
 * Resolves the kit primitive component and hydrates it with data + static props.
 * Defensive: unknown props are silently ignored; missing required props use defaults.
 *
 * Shared between:
 *   - UserViewRenderer (I3 route page)
 *   - ArtifactSlot (A4 panel artifact — FR-CV-013)
 *
 * Behavior-preserving extraction — no logic changes from UserViewRenderer.
 * NFR-CV-LAYER: imports only from src/lib/viewspec/ and src/components/ui/.
 */
import React from 'react';
import { KPITile } from '@/src/components/ui/KPITile';
import { DataTable, type Column } from '@/src/components/ui/DataTable';
import { StatTiles } from '@/src/components/ui/StatTiles';
import { Funnel } from '@/src/components/ui/Funnel';
import { ProgressBar, type ProgressTone } from '@/src/components/ui/ProgressBar';
import { Card } from '@/src/components/ui/Card';
import { StatusBarChart } from '@/src/components/dashboard/StatusBarChart';
import { chartTheme } from '@/src/components/ui/chartTheme';
import { registry } from '@/src/lib/viewspec/registry';
import type { CompiledPanel } from '@/src/lib/viewspec/types';
import type { IconName } from '@/src/components/ui/icons';

/**
 * Derives the category (label) and metric (value) columns from the compiled query.
 * The group-by is the category; the aggregate alias (or the first non-category select)
 * is the metric. Scalar primitives (ProgressBar) read the metric column from the first row.
 */
function categoryMetricCols(panel: CompiledPanel): { labelCol: string; valueCol: string } {
  const q = panel.compiledQuery;
  const labelCol = q.resolvedGroupBy ?? q.resolvedSelect[0];
  const valueCol =
    q.resolvedAggregate?.alias ??
    q.resolvedSelect.find((c) => c !== labelCol) ??
    q.resolvedSelect[0];
  return { labelCol, valueCol };
}

/**
 * Renders a CompiledPanel with its hydrated data as the appropriate kit primitive.
 * Should only be called after compileCompositionSpec has validated the spec.
 */
export function HydratedPrimitive({
  panel,
  data,
}: {
  panel: CompiledPanel;
  data: unknown[];
}): React.ReactElement | null {
  const descriptor = registry.get(panel.primitive);
  if (!descriptor) {
    // Should never happen: compileCompositionSpec already validated the primitive.
    return null;
  }

  const props = panel.props ?? {};

  switch (panel.primitive) {
    case 'KPITile': {
      const row = data[0] as Record<string, unknown> | undefined;
      const alias = panel.compiledQuery.resolvedAggregate?.alias;
      const value = alias != null ? row?.[alias] : row?.[panel.compiledQuery.resolvedSelect[0]];
      return (
        <KPITile
          icon={((props.icon as IconName | undefined) ?? 'doc') as IconName}
          tone={(props.tone as 'blue' | 'violet' | 'amber' | 'red' | 'green' | undefined) ?? 'blue'}
          label={(props.label as string | undefined) ?? panel.id}
          value={value as React.ReactNode}
          negative={props.negative as boolean | undefined}
          help={props.help as string | undefined}
          vs={props.vs as string | undefined}
        />
      );
    }
    case 'DataTable': {
      const rows = data as Record<string, unknown>[];
      const columns: Column<Record<string, unknown>>[] =
        panel.compiledQuery.resolvedSelect.map((col) => ({
          key: col,
          header: col,
          cell: (row) => {
            const v = row[col];
            return v == null ? '' : String(v);
          },
        }));
      return (
        <DataTable
          rows={rows}
          columns={columns}
          rowKey={(row) => String(row.id ?? JSON.stringify(row))}
        />
      );
    }
    case 'StatTiles': {
      const { labelCol, valueCol } = categoryMetricCols(panel);
      const tiles = (data as Record<string, unknown>[]).map((row) => ({
        label: String(row[labelCol] ?? ''),
        value: String(row[valueCol] ?? ''),
      }));
      return <StatTiles tiles={tiles} columns={props.columns as number | undefined} />;
    }
    case 'Funnel': {
      const { labelCol, valueCol } = categoryMetricCols(panel);
      const rows = data as Record<string, unknown>[];
      const nums = rows.map((r) => Number(r[valueCol])).filter((n) => Number.isFinite(n));
      const max = nums.length ? Math.max(...nums) : 0;
      const stages = rows.map((row) => {
        const n = Number(row[valueCol]);
        return {
          name: String(row[labelCol] ?? ''),
          value: String(row[valueCol] ?? ''),
          barPct: max > 0 && Number.isFinite(n) ? Math.round((n / max) * 100) : undefined,
        };
      });
      return <Funnel stages={stages} selectedIndex={props.selectedIndex as number | undefined} />;
    }
    case 'StatusBarChart': {
      const { labelCol, valueCol } = categoryMetricCols(panel);
      const chartData = (data as Record<string, unknown>[]).map((row) => ({
        status: String(row[labelCol] ?? ''),
        count: Number(row[valueCol]) || 0,
      }));
      // Deterministic status→series-token tone — cycles the DESIGN.md chart palette
      // (never a raw hex); the same status maps to the same tone across renders.
      const seriesTokens = Object.values(chartTheme.series);
      const statuses = Array.from(new Set(chartData.map((d) => d.status)));
      const toneFor = (status: string) =>
        seriesTokens[Math.max(0, statuses.indexOf(status)) % seriesTokens.length];
      return (
        <StatusBarChart
          data={chartData}
          toneFor={toneFor}
          label={(props.label as string | undefined) ?? panel.compiledQuery.entity}
          noun={(props.noun as string | undefined) ?? 'records'}
          height={props.height as number | undefined}
        />
      );
    }
    case 'ProgressBar': {
      const { valueCol } = categoryMetricCols(panel);
      const first = (data as Record<string, unknown>[])[0];
      const value = first ? Number(first[valueCol]) || 0 : 0;
      return (
        <ProgressBar
          value={value}
          tone={props.tone as ProgressTone | undefined}
          showValue={(props.showValue as boolean | undefined) ?? true}
          aria-label={(props['aria-label'] as string | undefined) ?? panel.id}
        />
      );
    }
    case 'Card': {
      const first = (data as Record<string, unknown>[])[0] ?? {};
      const title = props.title as string | undefined;
      return (
        <Card>
          {title && <div className="mb-2 text-[13px] font-semibold text-foreground">{title}</div>}
          <dl className="flex flex-col gap-1 text-[13px]">
            {panel.compiledQuery.resolvedSelect.map((col) => (
              <div key={col} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{col}</dt>
                <dd className="font-medium text-foreground">{String(first[col] ?? '')}</dd>
              </div>
            ))}
          </dl>
        </Card>
      );
    }
    default:
      // Interim JSON fallback for any primitive not yet given a hydration case.
      // (All registry primitives are now wired; this guards future additions.)
      return (
        <pre className="overflow-auto rounded p-3 text-[12px]">
          {JSON.stringify(data, null, 2)}
        </pre>
      );
  }
}

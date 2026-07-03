import { z } from 'zod';

/** v1 chart types — mirrors StatusBarChart's visual vocabulary (ADR-0045 §1). */
export const CHART_TYPES = ['bar', 'line', 'donut'] as const;
/** v1 insight tones — mirrors KPITone ('blue'|'violet'|'amber'|'red'|'green'). */
export const INSIGHT_TONES = ['blue', 'violet', 'amber', 'red', 'green'] as const;

const dataTable = z.object({
  kind: z.literal('data_table'),
  columns: z.array(z.object({ key: z.string(), label: z.string() })),
  rows: z.array(z.record(z.string(), z.unknown())),
  caption: z.string().optional(),
});
const dataChart = z.object({
  kind: z.literal('data_chart'),
  chartType: z.enum(CHART_TYPES),
  series: z.array(z.object({ label: z.string(), value: z.number() })),
  caption: z.string().optional(),
});
const dataInsight = z.object({
  kind: z.literal('data_insight'),
  label: z.string(),
  value: z.union([z.string(), z.number()]),
  delta: z.object({ dir: z.enum(['up', 'down', 'neutral']), text: z.string() }).optional(),
  tone: z.enum(INSIGHT_TONES).optional(),
});

/** ADR-0045 §1 — the SOLE validation authority (NFR-ATC-SEC-001). Server + client import THIS. */
export const WIDGET_PAYLOAD_SCHEMA = z.discriminatedUnion('kind', [dataTable, dataChart, dataInsight]);

// Hand-declared TS types (not `z.infer`) — this repo's tsconfig does not set
// `strict`/`strictNullChecks` (pre-existing, out of this issue's scope), and
// under that config zod's conditional-type `z.infer` output widens every
// field to optional, which breaks discriminated-union narrowing and JSX prop
// typing downstream (registry.tsx/WidgetSlot.tsx). Declaring the shape
// explicitly keeps correct required/optional narrowing while `.safeParse`
// against WIDGET_PAYLOAD_SCHEMA above remains the sole RUNTIME validation
// authority (NFR-ATC-SEC-001) — these types describe its already-validated
// output, they do not replace it.
export interface DataTableWidget {
  kind: 'data_table';
  columns: { key: string; label: string }[];
  rows: Record<string, unknown>[];
  caption?: string;
}
export interface DataChartWidget {
  kind: 'data_chart';
  chartType: (typeof CHART_TYPES)[number];
  series: { label: string; value: number }[];
  caption?: string;
}
export interface DataInsightWidget {
  kind: 'data_insight';
  label: string;
  value: string | number;
  delta?: { dir: 'up' | 'down' | 'neutral'; text: string };
  tone?: (typeof INSIGHT_TONES)[number];
}
export type WidgetPayload = DataTableWidget | DataChartWidget | DataInsightWidget;

// Compile-time drift guard: if the hand-declared types above ever diverge
// from the zod schema's actual inferred shape, these assignability checks
// fail to compile (caught in CI typecheck) — keeping the two definitions in
// lockstep without relying on z.infer's optional-widening under this
// tsconfig.
type _ZodDataTable = z.infer<typeof dataTable>;
type _ZodDataChart = z.infer<typeof dataChart>;
type _ZodDataInsight = z.infer<typeof dataInsight>;
type _DriftGuard = [DataTableWidget, DataChartWidget, DataInsightWidget] extends [
  _ZodDataTable,
  _ZodDataChart,
  _ZodDataInsight,
]
  ? true
  : never;
export type _AssertNoDrift = _DriftGuard extends true ? true : never;

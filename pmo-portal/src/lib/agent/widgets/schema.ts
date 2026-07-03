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
export type WidgetPayload = z.infer<typeof WIDGET_PAYLOAD_SCHEMA>;
export type DataTableWidget = z.infer<typeof dataTable>;
export type DataChartWidget = z.infer<typeof dataChart>;
export type DataInsightWidget = z.infer<typeof dataInsight>;

import { describe, expect, it } from 'vitest';
import { WIDGET_PAYLOAD_SCHEMA, CHART_TYPES, INSIGHT_TONES } from './schema';

describe('WIDGET_PAYLOAD_SCHEMA (FR-ATC-001)', () => {
  it('AC-ATC-001-support accepts a well-formed DataTableWidget', () => {
    const result = WIDGET_PAYLOAD_SCHEMA.safeParse({
      kind: 'data_table',
      columns: [{ key: 'name', label: 'Project' }],
      rows: [{ name: 'Alpha' }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts a well-formed DataChartWidget and rejects an out-of-enum chartType', () => {
    const ok = WIDGET_PAYLOAD_SCHEMA.safeParse({
      kind: 'data_chart',
      chartType: 'bar',
      series: [{ label: 'A', value: 3 }],
    });
    expect(ok.success).toBe(true);

    const bad = WIDGET_PAYLOAD_SCHEMA.safeParse({
      kind: 'data_chart',
      chartType: 'pie',
      series: [{ label: 'A', value: 3 }],
    });
    expect(bad.success).toBe(false);
  });

  it('accepts a well-formed DataInsightWidget with delta/tone and rejects an off-palette tone', () => {
    const minimal = WIDGET_PAYLOAD_SCHEMA.safeParse({
      kind: 'data_insight',
      label: 'Over-budget projects',
      value: 3,
    });
    expect(minimal.success).toBe(true);

    const withDelta = WIDGET_PAYLOAD_SCHEMA.safeParse({
      kind: 'data_insight',
      label: 'Over-budget projects',
      value: 3,
      delta: { dir: 'up', text: '+2' },
      tone: 'red',
    });
    expect(withDelta.success).toBe(true);

    const offPalette = WIDGET_PAYLOAD_SCHEMA.safeParse({
      kind: 'data_insight',
      label: 'Over-budget projects',
      value: 3,
      tone: 'cyan',
    });
    expect(offPalette.success).toBe(false);
  });

  it('AC-ATC-002-support rejects a malformed data_table (rows not an array)', () => {
    const result = WIDGET_PAYLOAD_SCHEMA.safeParse({
      kind: 'data_table',
      columns: [{ key: 'name', label: 'P' }],
      rows: 'not-an-array',
    });
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing the kind discriminant', () => {
    const result = WIDGET_PAYLOAD_SCHEMA.safeParse({ columns: [], rows: [] });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown kind', () => {
    const result = WIDGET_PAYLOAD_SCHEMA.safeParse({ kind: 'iframe_app' });
    expect(result.success).toBe(false);
  });

  it('CHART_TYPES and INSIGHT_TONES mirror the shipped StatusBarChart/KPITile prop unions', () => {
    expect(CHART_TYPES).toEqual(['bar', 'line', 'donut']);
    expect(INSIGHT_TONES).toEqual(['blue', 'violet', 'amber', 'red', 'green']);
  });
});

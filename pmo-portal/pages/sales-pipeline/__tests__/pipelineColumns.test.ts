import type React from 'react';
import type { PipelineProject } from '@/src/lib/db/dashboard';
import { describe, it, expect, vi } from 'vitest';
import { buildPipelineColumns } from '../pipelineColumns';

describe('pipelineColumns — table and export column builder (THEME-CROSS-76)', () => {
  const t = vi.fn((_key: string, fallback?: string) => fallback ?? _key);

  it('builds table columns with all standard deal metrics', () => {
    const { tableColumns } = buildPipelineColumns({ t });
    const keys = tableColumns.map((c) => c.key);
    expect(keys).toEqual([
      'opp',
      'customer',
      'stage',
      'value',
      'weighted',
      'go',
      'get',
      'owner',
      'last_touch',
    ]);
  });

  it('inserts an export-only Currency column immediately after Value in exportColumns', () => {
    const { exportColumns } = buildPipelineColumns({ t });
    const keys = exportColumns.map((c) => c.key);
    expect(keys).toContain('currency');

    const valueIdx = keys.indexOf('value');
    const currencyIdx = keys.indexOf('currency');
    const weightedIdx = keys.indexOf('weighted');

    expect(currencyIdx).toBe(valueIdx + 1);
    expect(weightedIdx).toBe(currencyIdx + 1);
  });

  it('inserts an export-only End customer column immediately after Customer in exportColumns (#758)', () => {
    const { exportColumns } = buildPipelineColumns({ t });
    const keys = exportColumns.map((c) => c.key);
    expect(keys).toContain('end-customer');

    const customerIdx = keys.indexOf('customer');
    const endCustomerIdx = keys.indexOf('end-customer');
    expect(endCustomerIdx).toBe(customerIdx + 1);
  });
});

it("uses a recent stage change as the last touch", () => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-27T12:00:00Z")); try { const {tableColumns} = buildPipelineColumns({t: (_key: string, fallback?: string) => fallback ?? _key}); const col = tableColumns.find(c => c.key === "last_touch")!; const cell = col.cell!({last_update: "2026-10-13T12:00:00Z", stage_started_at: "2026-11-24T12:00:00Z"} as PipelineProject) as React.ReactElement<{title?: string; children: string}>; expect(cell.props.title).toBeUndefined(); expect(cell.props.children).toBe("3 days ago"); } finally { vi.useRealTimers(); } });

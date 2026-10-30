import { describe, it, expect, vi } from 'vitest';
import { buildPipelineColumns } from '../pipelineColumns';

describe('pipelineColumns — table and export column builder (THEME-CROSS-76)', () => {
  const t = vi.fn((_key: string, fallback?: string) => fallback ?? _key);
  const stageName = vi.fn((status: string) => `Stage: ${status}`);

  it('builds table columns with all standard deal metrics', () => {
    const { tableColumns } = buildPipelineColumns({ t, stageName });
    const keys = tableColumns.map((c) => c.key);
    expect(keys).toEqual([
      'opp',
      'customer',
      'stage',
      'value',
      'weighted',
      'win',
      'owner',
      'last_touch',
    ]);
  });

  it('inserts an export-only Currency column immediately after Value in exportColumns', () => {
    const { exportColumns } = buildPipelineColumns({ t, stageName });
    const keys = exportColumns.map((c) => c.key);
    expect(keys).toContain('currency');

    const valueIdx = keys.indexOf('value');
    const currencyIdx = keys.indexOf('currency');
    const weightedIdx = keys.indexOf('weighted');

    expect(currencyIdx).toBe(valueIdx + 1);
    expect(weightedIdx).toBe(currencyIdx + 1);
  });

  it('inserts an export-only End customer column immediately after Customer in exportColumns (#758)', () => {
    const { exportColumns } = buildPipelineColumns({ t, stageName });
    const keys = exportColumns.map((c) => c.key);
    expect(keys).toContain('end-customer');

    const customerIdx = keys.indexOf('customer');
    const endCustomerIdx = keys.indexOf('end-customer');
    expect(endCustomerIdx).toBe(customerIdx + 1);
  });
});

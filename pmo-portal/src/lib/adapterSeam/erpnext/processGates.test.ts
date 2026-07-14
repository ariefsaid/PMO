/**
 * processGates.ts unit tests (Slice 2 task 2.9, OWNS no AC — just defaults proof for Slice 3).
 */
import { describe, expect, it } from 'vitest';
import { readProcessGates, enforceGates, DEFAULT_GATES } from './processGates.ts';

describe('processGates — readProcessGates (Slice 2.9 defaults)', () => {
  it('returns defaults when config is undefined', () => {
    const gates = readProcessGates(undefined);
    expect(gates).toEqual(DEFAULT_GATES);
  });

  it('returns defaults when config has no process_gates key', () => {
    const gates = readProcessGates({ company: 'Test Co' });
    expect(gates).toEqual(DEFAULT_GATES);
  });

  it('reads explicit process_gates from binding config', () => {
    const gates = readProcessGates({
      process_gates: { require_so_before_si: true, require_bast_before_si: false, require_project_on_si: false },
    });
    expect(gates).toEqual({
      require_so_before_si: true,
      require_bast_before_si: false,
      require_project_on_si: false,
    });
  });

  it('defaults missing boolean keys to their DEFAULT values (false/false/true)', () => {
    const gates = readProcessGates({ process_gates: { require_so_before_si: true } });
    expect(gates).toEqual({
      require_so_before_si: true,
      require_bast_before_si: false,
      require_project_on_si: true,
    });
  });

  it('coerces non-boolean truthy values to true, falsy to false', () => {
    const gates = readProcessGates({ process_gates: { require_so_before_si: 'yes', require_bast_before_si: 0, require_project_on_si: '' } });
    expect(gates).toEqual({
      require_so_before_si: false, // 'yes' !== true
      require_bast_before_si: false,
      require_project_on_si: true, // '' is not explicitly false, so default true
    });
  });
});

describe('processGates — enforceGates stub (Slice 2.9 no-op)', () => {
  it('returns null (no enforcement in Slice 2)', () => {
    const result = enforceGates(DEFAULT_GATES, { erp_doc_kind: 'sales-invoice', projectId: null });
    expect(result).toBeNull();
  });

  it('returns null regardless of gate values (Slice 3 enforces)', () => {
    const result = enforceGates({ ...DEFAULT_GATES, require_project_on_si: true }, { erp_doc_kind: 'sales-invoice', projectId: null });
    expect(result).toBeNull();
  });
});
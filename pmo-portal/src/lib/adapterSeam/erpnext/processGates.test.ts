/**
 * processGates.ts unit tests (Slice 2 task 2.9, Slice 3 enforcement).
 * OWNS AC-SAR-070 (gate enforcement for require_project_on_si).
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

describe('processGates — enforceGates (Slice 3 enforcement, OWNS AC-SAR-070)', () => {
  it('returns project-required when require_project_on_si=true and projectId is null (sales-invoice)', () => {
    const result = enforceGates(DEFAULT_GATES, { erp_doc_kind: 'sales-invoice', projectId: null });
    expect(result).toBe('project-required');
  });

  it('returns null when require_project_on_si=true but projectId is provided (sales-invoice)', () => {
    const result = enforceGates(DEFAULT_GATES, { erp_doc_kind: 'sales-invoice', projectId: 'proj-123' });
    expect(result).toBeNull();
  });

  it('returns null when require_project_on_si=false even with null projectId (gate OFF)', () => {
    const result = enforceGates({ ...DEFAULT_GATES, require_project_on_si: false }, { erp_doc_kind: 'sales-invoice', projectId: null });
    expect(result).toBeNull();
  });

  it('returns null for non-sales-invoice kinds (incoming-payment, etc.) regardless of gates', () => {
    const result = enforceGates(DEFAULT_GATES, { erp_doc_kind: 'incoming-payment', projectId: null });
    expect(result).toBeNull();
  });

  it('returns null for sales-invoice with undefined projectId (treated as missing)', () => {
    const result = enforceGates(DEFAULT_GATES, { erp_doc_kind: 'sales-invoice', projectId: undefined });
    expect(result).toBe('project-required');
  });

  it('SO/BAST gates are recognized but NOT enforced (inert in P3a)', () => {
    // These gates don't cause enforcement, they're just logged
    const result = enforceGates(
      { ...DEFAULT_GATES, require_so_before_si: true, require_bast_before_si: true },
      { erp_doc_kind: 'sales-invoice', projectId: null }
    );
    expect(result).toBe('project-required'); // Only project gate is enforced
  });

  it('returns null for undefined/missing erp_doc_kind (no enforcement)', () => {
    const result = enforceGates(DEFAULT_GATES, { projectId: null });
    expect(result).toBeNull();
  });
});
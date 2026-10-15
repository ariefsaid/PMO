import { describe, expect, it } from 'vitest';
import { invertProjectMap } from './projectMap.ts';
import { SI_FROM_DOC_FIELDS, siFromDoc } from './bodies/salesInvoice.ts';

describe('invertProjectMap', () => {
  it('AC-PFIN-001/002 resolves only unique non-empty ERP names', () => {
    const inverse = invertProjectMap({
      p1: 'ERP-A',
      p2: 'ERP-B',
      p3: 'ERP-B',
      p4: 7,
      p5: '',
    });

    expect(inverse.get('ERP-A')).toBe('p1');
    expect(inverse.get('ERP-B')).toBeNull();
    expect(inverse.has('7')).toBe(false);
    expect(inverse.has('')).toBe(false);
  });

  it('returns an empty map when no project map is configured', () => {
    expect(invertProjectMap(undefined).size).toBe(0);
  });

  it('preserves ERP names without trimming', () => {
    const inverse = invertProjectMap({ p1: ' ERP-A ' });
    expect(inverse.get(' ERP-A ')).toBe('p1');
    expect(inverse.has('ERP-A')).toBe(false);
  });

  it('AC-PFIN-001/003 maps carried ERP project provenance without inventing omitted keys', () => {
    expect(siFromDoc({ name: 'SI-A', project: 'ERP-A' }).erp_project).toBe('ERP-A');
    expect(siFromDoc({ name: 'SI-A', project: null })).toHaveProperty('erp_project', null);
    expect(siFromDoc({ name: 'SI-A' })).not.toHaveProperty('erp_project');
    expect(SI_FROM_DOC_FIELDS).toContain('project');
  });
});

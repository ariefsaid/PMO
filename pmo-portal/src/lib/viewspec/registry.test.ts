/**
 * Vitest gate-tests for the primitive registry.
 * All tests are offline (no Supabase, no network).
 * AC-VC-### tags in each it() title are the traceability anchors (ADR-0010).
 */
import { describe, it, expect } from 'vitest';
import { registry, validatePrimitive } from './registry';

describe('PrimitiveRegistry — lookup (FR-VC-001 / FR-VC-004)', () => {
  it('AC-VC-008: registry.get("KPITile") returns descriptor with tone and label in propSchema', () => {
    const entry = registry.get('KPITile');
    expect(entry).toBeDefined();
    expect(entry!.name).toBe('KPITile');
    expect(entry!.description).toBeTruthy();

    // propSchema includes tone and label (FR-VC-002 KPITile spec)
    const schema = entry!.propSchema as Record<string, unknown>;
    expect(schema).toHaveProperty('tone');
    expect(schema).toHaveProperty('label');

    // dataShape is defined
    expect(entry!.dataShape).toBeDefined();
  });

  it('AC-VC-008: registry.get("NonExistentWidget") returns undefined without throwing', () => {
    expect(() => registry.get('NonExistentWidget')).not.toThrow();
    expect(registry.get('NonExistentWidget')).toBeUndefined();
  });
});

describe('validatePrimitive (FR-VC-050)', () => {
  it('AC-VC-013: validatePrimitive("DataTable") returns true', () => {
    expect(validatePrimitive('DataTable')).toBe(true);
  });

  it('AC-VC-013: validatePrimitive("PieChart") returns false', () => {
    expect(validatePrimitive('PieChart')).toBe(false);
  });

  it('AC-VC-013: validatePrimitive("") returns false', () => {
    expect(validatePrimitive('')).toBe(false);
  });
});

describe('PrimitiveRegistry — all 7 primitives are registered', () => {
  const expectedPrimitives = [
    'DataTable', 'KPITile', 'StatTiles', 'Funnel', 'StatusBarChart', 'ProgressBar', 'Card',
  ];

  for (const name of expectedPrimitives) {
    it(`registry contains '${name}'`, () => {
      expect(registry.get(name)).toBeDefined();
    });
  }
});

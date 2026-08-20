import { describe, it, expect } from 'vitest';
import { validateRows } from '../validateRows';
import { companyImportDescriptor } from '../companyDescriptor';
import type { Mapping } from '../types';

const fields = companyImportDescriptor.fields;
// name → col 0, type → col 1
const mapping: Mapping = { name: 0, type: 1 };

describe('validateRows', () => {
  it('AC-IMP-004a: a row with name + a valid Type enum is valid (no errors)', () => {
    const result = validateRows([['Acme Corp', 'Client']], fields, mapping);
    expect(result).toHaveLength(1);
    expect(result[0].valid).toBe(true);
    expect(result[0].errors).toEqual({});
  });

  it('AC-IMP-004b: blank name → "required"; Type "Partner" not in enum → enum error; flags row invalid', () => {
    const result = validateRows([['   ', 'Partner']], fields, mapping);
    expect(result[0].valid).toBe(false);
    expect(result[0].errors.name).toMatch(/required/i);
    expect(result[0].errors.type).toMatch(/one of/i);
  });

  it('AC-IMP-004b: an unmapped field reads "" and fails its required validator', () => {
    const result = validateRows([['Acme', 'Client']], fields, { name: 0, type: null });
    expect(result[0].valid).toBe(false);
    expect(result[0].errors.type).toBeTruthy();
  });

  // ── #513: cross-field rules, run at PREVIEW with zero writes ──
  describe('#513 validateRow (cross-field rules)', () => {
    const crossField = (cells: Record<string, string>) =>
      cells.name === 'Acme Corp' ? { type: 'Acme may not be a Client.' } : {};

    it('#513: a descriptor validateRow error invalidates the row and lands on its field', () => {
      const result = validateRows([['Acme Corp', 'Client']], fields, mapping, crossField);
      expect(result[0].valid).toBe(false);
      expect(result[0].errors.type).toBe('Acme may not be a Client.');
    });

    it('#513: rows the cross-field rule clears stay valid', () => {
      const result = validateRows([['Other Corp', 'Client']], fields, mapping, crossField);
      expect(result[0].valid).toBe(true);
    });

    it("#513: a cell's OWN error wins over a cross-field message about the same cell", () => {
      // "Partner" is not in the Type enum. The user needs to hear that, not a sentence about how
      // this cell relates to another one.
      const result = validateRows([['Acme Corp', 'Partner']], fields, mapping, crossField);
      expect(result[0].errors.type).toMatch(/one of/i);
    });

    it('#513: omitting validateRow leaves behaviour exactly as before', () => {
      expect(validateRows([['Acme Corp', 'Client']], fields, mapping)[0].valid).toBe(true);
    });
  });
});

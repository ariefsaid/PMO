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
});

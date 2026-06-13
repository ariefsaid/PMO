import { describe, it, expect } from 'vitest';
import { autoMap } from '../autoMap';
import { companyImportDescriptor } from '../companyDescriptor';

describe('autoMap', () => {
  it('AC-IMP-003: maps "company name"/"TYPE" headers to name/type fields case+space-insensitively; unknown header → null', () => {
    const headers = ['  company   NAME ', 'tYpE', 'Notes'];
    const mapping = autoMap(headers, companyImportDescriptor.fields);
    // name field (label "Company name") matches header index 0 despite case + extra spaces
    expect(mapping.name).toBe(0);
    // type field (label "Type") matches header index 1
    expect(mapping.type).toBe(1);
  });

  it('AC-IMP-003: a field with no matching header maps to null (unmapped)', () => {
    const mapping = autoMap(['Random', 'Other'], companyImportDescriptor.fields);
    expect(mapping.name).toBeNull();
    expect(mapping.type).toBeNull();
  });
});

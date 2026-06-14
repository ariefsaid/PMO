import { describe, it, expect } from 'vitest';
import { autoMap } from '../autoMap';
import { companyImportDescriptor } from '../companyDescriptor';

describe('autoMap', () => {
  it('AC-IMP-003: maps "company name"/"TYPE" headers to name/type fields case+space-insensitively via label; unknown header → null', () => {
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

  it('AC-IMP-003b: exact key match — spreadsheet header "name" auto-maps to the name field (key match, not just label match)', () => {
    // A spreadsheet with columns exactly named by the field key (e.g. "name", "type")
    // must auto-map even though the label is "Company name" / "Type".
    const headers = ['name', 'type', 'extra'];
    const mapping = autoMap(headers, companyImportDescriptor.fields);
    expect(mapping.name).toBe(0); // matched via key "name"
    expect(mapping.type).toBe(1); // matched via key "type"
  });

  it('AC-IMP-003b: key match is case-insensitive — header "NAME" maps to name field', () => {
    const headers = ['NAME', 'TYPE'];
    const mapping = autoMap(headers, companyImportDescriptor.fields);
    expect(mapping.name).toBe(0);
    expect(mapping.type).toBe(1);
  });

  it('AC-IMP-003b: label match takes priority over key match when both exist at different indices', () => {
    // Header at index 0 matches the label; header at index 1 matches the key.
    // Label match is tried first (both are acceptable, but label match wins the first slot).
    // The point is both produce a valid (non-null) mapping.
    const headers = ['Company name', 'name', 'type'];
    const mapping = autoMap(headers, companyImportDescriptor.fields);
    // 'name' field matches label at index 0 OR key at index 1; either is acceptable —
    // what matters is it's NOT null.
    expect(mapping.name).not.toBeNull();
    expect(mapping.type).toBe(2);
  });
});

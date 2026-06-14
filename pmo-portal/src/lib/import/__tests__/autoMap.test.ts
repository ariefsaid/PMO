import { describe, it, expect } from 'vitest';
import { autoMap } from '../autoMap';
import { companyImportDescriptor } from '../companyDescriptor';
import type { ImportField } from '../types';

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

  it('AC-IMP-003-key: autoMap matches on the field KEY (not just the label) when a header equals the key exactly', () => {
    // A spreadsheet might export the raw field key "name" rather than "Company name".
    // autoMap should match it — the real-world failure: header "name" → null instead of 0.
    const headers = ['name', 'Type'];
    const mapping = autoMap(headers, companyImportDescriptor.fields);
    // "name" matches field key "name" → index 0
    expect(mapping.name).toBe(0);
    // "Type" matches field label "Type" → index 1
    expect(mapping.type).toBe(1);
  });

  it('AC-IMP-003-key-case: key matching is also case+whitespace-insensitive', () => {
    // "NAME" should match key "name" (case-insensitive key match)
    const headers = ['NAME', 'type'];
    const mapping = autoMap(headers, companyImportDescriptor.fields);
    expect(mapping.name).toBe(0);
    expect(mapping.type).toBe(1);
  });

  it('AC-IMP-003-key-generic: key matching works for arbitrary descriptors, not just company', () => {
    // Generic test: a descriptor where key differs from label.
    type FooInput = { foo_field: string };
    const fields: ImportField<FooInput>[] = [
      {
        key: 'foo_field',
        label: 'Foo Label',
        required: true,
        validate: (v) => (v ? null : 'required'),
      },
    ];
    // Header exactly equals the key "foo_field"
    const mapping = autoMap(['foo_field', 'other'], fields);
    expect(mapping.foo_field).toBe(0);
  });
});

import { describe, expect, it, vi } from 'vitest';
vi.mock('@/src/lib/repositories', () => ({ repositories: { stock: { master: { createItem: vi.fn(), createWarehouse: vi.fn() } } } }));
import { makeStockLocationImportDescriptor } from '../stockItemDescriptor';
import { validateRows } from '../validateRows';
import { autoMap } from '../autoMap';

const none = async () => [] as string[];
describe('stock location import: vendor kind (AC-SVL-011)', () => {
  const d = makeStockLocationImportDescriptor([{ id: 'p1', name: 'Alpha' }], none);
  const H = ['Location code', 'Name', 'Kind', 'Project'];
  const v = validateRows([['V1', 'At a coater', 'vendor', 'Alpha'], ['V2', 'At a plater', 'vendor', '']], d.fields, autoMap(H, d.fields), d.validateRow, d.validateSheet);
  it('AC-SVL-011 refuses a project on a vendor location', () => {
    expect(v[0].valid).toBe(false);
    expect(v[0].errors.project).toMatch(/vendor location has no project/);
  });
  it('AC-SVL-011 accepts a vendor location without a project', () => expect(v[1].valid).toBe(true));
});

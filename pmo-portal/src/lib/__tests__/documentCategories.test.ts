import { describe, it, expect } from 'vitest';
import { categoryDisplay, documentCategoryLabel, viewableCategories } from '@/src/lib/documentCategories';
import type { DocumentCategory } from '@/src/lib/db/documentCategories';

const ID: Record<string, string> = {
  'project:documentCategory.drawing': 'Gambar',
  'project:documentCategory.reference': 'Referensi',
};
const tId = (key: string, fallback: string) => ID[key] ?? fallback;
const tEn = (_key: string, fallback: string) => fallback;

const cat = (over: Partial<DocumentCategory>): DocumentCategory => ({
  id: 'c', name: 'Drawing', is_system: true, sort_order: 10, archived_at: null,
  roles: ['Executive', 'Project Manager', 'Finance', 'Engineer', 'Admin'], ...over,
});

describe('AC-DCV-018 category names in the reader language (FR-DCV-021)', () => {
  it('shows a system category translated and a custom one as typed', () => {
    expect(categoryDisplay(tId, cat({ name: 'Drawing', is_system: true }))).toBe('Gambar');
    expect(categoryDisplay(tEn, cat({ name: 'Drawing', is_system: true }))).toBe('Drawing');
    expect(categoryDisplay(tId, cat({ name: 'Commercial approval', is_system: false }))).toBe('Commercial approval');
  });
  it('does not translate a custom category that happens to share a system name', () => {
    expect(categoryDisplay(tId, cat({ name: 'Drawing', is_system: false }))).toBe('Drawing');
  });
  it('keeps the stored-text label for register rows (Reference is a system label)', () => {
    expect(documentCategoryLabel(tId, 'Reference')).toBe('Referensi');
  });
});

describe('AC-DCV-018 the forms offer only categories the caller can see (FR-DCV-017)', () => {
  const all = [
    cat({ id: 'd', name: 'Drawing' }),
    cat({ id: 'i', name: 'Invoice', is_system: false, roles: ['Finance', 'Admin'] }),
    cat({ id: 'o', name: 'Old', is_system: false, archived_at: '2026-01-01T00:00:00Z' }),
  ];
  it('lists live categories whose viewer roles include the caller', () => {
    expect(viewableCategories(all, 'Engineer').map((c) => c.id)).toEqual(['d']);
    expect(viewableCategories(all, 'Finance').map((c) => c.id)).toEqual(['d', 'i']);
  });
  it('lists every live category for an Admin and none without a role', () => {
    expect(viewableCategories(all, 'Admin').map((c) => c.id)).toEqual(['d', 'i']);
    expect(viewableCategories(all, null)).toEqual([]);
  });
  it('keeps an archived category when asked to include the one a document already holds', () => {
    expect(viewableCategories(all, 'Admin', 'o').map((c) => c.id)).toEqual(['d', 'i', 'o']);
  });
});

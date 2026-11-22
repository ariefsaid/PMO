import categories from './documentCategories.json';
import type { Role } from '@/src/auth/AuthContext';
import { can } from '@/src/auth/policy';
import type { DocumentCategory } from '@/src/lib/db/documentCategories';

type Translate = (key: string, fallback: string) => string;

/** A stored document category in the reader's language. The stored value stays English; an unknown (typed) value reads as stored. */
export function documentCategoryLabel(t: Translate, value: string): string {
  switch (value) {
    case 'Drawing': return t('project:documentCategory.drawing', 'Drawing');
    case 'Specification': return t('project:documentCategory.specification', 'Specification');
    case 'Report': return t('project:documentCategory.report', 'Report');
    case 'Transmittal': return t('project:documentCategory.transmittal', 'Transmittal');
    case 'Submittal': return t('project:documentCategory.submittal', 'Submittal');
    case 'Certificate': return t('project:documentCategory.certificate', 'Certificate');
    case 'Other': return t('project:documentCategory.other', 'Other');
    case 'Reference': return t('project:documentCategory.reference', 'Reference');
    default: return value;
  }
}

/** A category's name in the reader's language: a system category is translated, an organisation-created one reads as typed (FR-DCV-021). */
export function categoryDisplay(t: Translate, category: Pick<DocumentCategory, 'name' | 'is_system'>): string {
  return category.is_system ? documentCategoryLabel(t, category.name) : category.name;
}

/**
 * The categories a form may offer: live, and the caller's role is a viewer role (FR-DCV-017). The database decides what a caller may
 * file into (the restrictive policy); this only keeps the list honest. `keepId` keeps the category a document already holds, so an edit
 * of a document in an archived category still shows it.
 */
export function viewableCategories(all: DocumentCategory[], role: Role | null, keepId?: string): DocumentCategory[] {
  if (!role) return [];
  return all.filter((c) => (c.archived_at === null || c.id === keepId) && can('view', 'documentCategory', { realRole: role, record: { roles: c.roles } }));
}

/** Category options shared between the create/edit modal and the revision modal. The list itself is JSON so `pmo documents` reads the same one. */
export const categoryOptions = (t: Translate) => categories.map((value) => ({ value, label: documentCategoryLabel(t, value) }));

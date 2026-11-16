import categories from './documentCategories.json';

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

/** Category options shared between the create/edit modal and the revision modal. The list itself is JSON so `pmo documents` reads the same one. */
export const categoryOptions = (t: Translate) => categories.map((value) => ({ value, label: documentCategoryLabel(t, value) }));

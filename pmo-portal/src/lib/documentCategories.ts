import categories from './documentCategories.json';

/** Category options shared between the create/edit modal and the revision modal. The list itself is JSON so `pmo documents` reads the same one. */
export const CATEGORY_OPTIONS = categories.map((value) => ({ value, label: value }));

/** Class strings for the rename list (`RenameRows.tsx`, #1126); kept apart so the component file exports components only. */
const GRID_TWO_FIELDS = 'xl:grid xl:grid-cols-[minmax(9rem,13rem)_minmax(0,1fr)_minmax(0,1fr)_auto] xl:items-start xl:gap-x-4';
const GRID_LANGUAGE_LINES = 'xl:grid xl:grid-cols-[minmax(8rem,11rem)_minmax(0,1fr)_auto] xl:items-start xl:gap-x-4';
/** One language line inside a row of the language-lines layout: language, singular, plural. */
export const RENAME_LANGUAGE_LINE = 'min-w-0 xl:grid xl:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] xl:items-center xl:gap-x-2';

export type RenameLayout = 'two-fields' | 'language-lines';
export const gridOf = (layout: RenameLayout) => (layout === 'two-fields' ? GRID_TWO_FIELDS : GRID_LANGUAGE_LINES);

export const renameRow = (layout: RenameLayout) => `space-y-3 border-b border-border px-4 py-3 last:border-b-0 xl:space-y-0 ${gridOf(layout)}`;

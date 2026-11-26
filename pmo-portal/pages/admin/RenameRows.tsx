import React from 'react';
import { RENAME_LANGUAGE_LINE, gridOf, type RenameLayout } from './renameRowClasses';

/**
 * The editable "rename" list shared by Terminology › Terms and › Role names (#1126): one row per thing to rename: a column per
 * language ('two-fields', one name per language) or a line per language ('language-lines', singular and plural), Save and Reset at the row's end. On a wide screen (1280px and up) it reads as a table under one header row; on a phone
 * each row stacks with its own field labels. The fields keep their own labels for assistive tech in both layouts.
 */
/** The header row (wide screens only). `columns` are the field columns after the first. */
export const RenameHeader: React.FC<{ layout: RenameLayout; first: string; columns: string[] }> = ({ layout, first, columns }) => (
  <div aria-hidden className={`hidden border-b border-border px-4 py-2 text-control font-medium text-muted-foreground ${gridOf(layout)}`}>
    <span>{first}</span>
    {layout === 'two-fields'
      ? columns.map((c) => <span key={c} className="min-w-0">{c}</span>)
      : <span className={RENAME_LANGUAGE_LINE}>{columns.map((c) => <span key={c} className="min-w-0">{c}</span>)}</span>}
    <span className="w-20" />
  </div>
);

/** The list surface: one bordered panel, rows divided by one hairline. */
export const RenameList: React.FC<{ children: React.ReactNode; label: string }> = ({ children, label }) => (
  <div role="list" aria-label={label} className="min-w-0 rounded-lg border border-border bg-card">
    {children}
  </div>
);

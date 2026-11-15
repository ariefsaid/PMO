/**
 * Keyset position for lists ordered `created_at desc, id desc` (#843; the `listNotificationsPage` shape). A row
 * written between two page reads never repeats or is skipped, which an offset cannot promise.
 */
export interface CreatedAtCursor {
  createdAt: string;
  id: string;
}

/** The PostgREST `or` filter for rows strictly after `cursor` in `created_at desc, id desc` order. */
export function afterCreatedAt(cursor: CreatedAtCursor): string {
  const { createdAt, id } = cursor;
  return `created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${id})`;
}

/** The cursor after the last row of a page, or `undefined` when the page was the last one. */
export function cursorAfter<T extends { created_at: string; id: string }>(page: { rows: T[]; truncated: boolean }): CreatedAtCursor | undefined {
  const last = page.rows[page.rows.length - 1];
  return page.truncated && last ? { createdAt: last.created_at, id: last.id } : undefined;
}

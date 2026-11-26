import { screen, within } from '@testing-library/react';

/** The cell a person reads under `column` in the row named `row` of the table named `table`. */
export function tableCell(table: string, row: string | RegExp, column: string): HTMLElement {
  const grid = screen.getByRole('table', { name: table });
  const headers = within(grid).getAllByRole('columnheader').map((h) => h.textContent?.trim() ?? '');
  const index = headers.findIndex((h) => h === column);
  if (index < 0) throw new Error(`no column "${column}" in ${headers.join(' | ')}`);
  const match = within(grid).getAllByRole('row').find((r) => (typeof row === 'string' ? r.textContent?.includes(row) : row.test(r.textContent ?? '')) && r.querySelector('td'));
  if (!match) throw new Error(`no row ${String(row)} in table ${table}`);
  return match.querySelectorAll<HTMLElement>('th,td')[index];
}

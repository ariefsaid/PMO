import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from '../DataTable';
import { pageWindow } from '../pageWindow';

interface Row { id: string; name: string }
const columns: Column<Row>[] = [{ key: 'name', header: 'Name', cell: (r) => r.name }];
const mk = (n: number): Row[] => Array.from({ length: n }, (_, i) => ({ id: `r${i}`, name: `Row ${i}` }));

function renderPaged(page: number, total = 205, onPageChange = vi.fn()) {
  render(
    <DataTable rows={mk(Math.min(50, total - (page - 1) * 50))} columns={columns} rowKey={(r) => r.id}
      total={total} pagination={{ page, pageSize: 50, onPageChange }} />,
  );
  return onPageChange;
}

describe('pageWindow', () => {
  it('lists every page when the range is short', () => {
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('collapses long ranges with ellipses around the current page', () => {
    expect(pageWindow(1, 20)).toEqual([1, 2, 'gap', 20]);
    expect(pageWindow(10, 20)).toEqual([1, 'gap', 9, 10, 11, 'gap', 20]);
    expect(pageWindow(20, 20)).toEqual([1, 'gap', 19, 20]);
  });
  it('narrows to the current page alone on a phone', () => {
    expect(pageWindow(10, 20, 0)).toEqual([1, 'gap', 10, 'gap', 20]);
    expect(pageWindow(2, 5, 0)).toEqual([1, 2, 'gap', 5]);
  });
});

describe('DataTable pagination (#843)', () => {
  it('names the visible range at the left and marks the current page', () => {
    renderPaged(1);
    expect(screen.getByText('Showing 1–50 of 205')).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(nav).getByRole('button', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('button', { name: 'Page 5' })).not.toHaveAttribute('aria-current');
    expect(screen.queryByRole('button', { name: /load more/i })).toBeNull();
  });

  it('shows the middle and last page ranges', () => {
    renderPaged(3);
    expect(screen.getByText('Showing 101–150 of 205')).toBeInTheDocument();
  });
  it('shows a short last page', () => {
    renderPaged(5);
    expect(screen.getByText('Showing 201–205 of 205')).toBeInTheDocument();
  });

  it('changes page from a number, Next and Previous', async () => {
    const onPageChange = renderPaged(3);
    await userEvent.click(screen.getByRole('button', { name: 'Page 5' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(onPageChange.mock.calls.map((c) => c[0])).toEqual([5, 4, 2]);
  });

  it('disables Previous on the first page and Next on the last', () => {
    renderPaged(1);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });
  it('disables Next on the last page', () => {
    renderPaged(5);
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeEnabled();
  });

  it('shows no pager when everything fits on one page, only the count', () => {
    renderPaged(1, 12);
    expect(screen.getByText('Showing 1–12 of 12')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Pagination' })).toBeNull();
  });

  it('is reachable by keyboard', async () => {
    const onPageChange = renderPaged(2);
    screen.getByRole('button', { name: 'Page 3' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onPageChange).toHaveBeenCalledWith(3);
  });
});

/**
 * #2077 — a row that opens a record is a real link. With `rowHref`, the first-cell activation
 * control is an `<a href>` so Cmd/Ctrl-click, middle-click and "Open link in new tab" work, while a
 * plain click and Enter keep the page's existing open behaviour (`onActivate`, which carries the
 * list-return context) without a full document load.
 */
import { afterEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from '../DataTable';

interface Row { id: string; name: string; value: number }
const rows: Row[] = [
  { id: 'C-1', name: 'Alpha', value: 1200 },
  { id: 'C-2', name: 'Beta', value: 980 },
];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name },
  { key: 'value', header: 'Value', align: 'num', cell: (r) => r.value },
];

function mockViewport(isDesktop: boolean) {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop, media: query, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  })));
}
afterEach(() => vi.unstubAllGlobals());

function renderTable(onActivate = vi.fn(), rowHref: (r: Row) => string | undefined = (r) => `/companies/${r.id}`) {
  render(
    <DataTable
      rows={rows}
      columns={columns}
      rowKey={(r) => r.id}
      onActivate={onActivate}
      rowLabel={(r) => `Open ${r.name}`}
      rowHref={rowHref}
    />,
  );
  return onActivate;
}

describe.each([['desktop', true], ['phone', false]] as const)('#2077 row links (%s)', (_label, isDesktop) => {
  it('renders the row activation as a link to the record, not a button', () => {
    mockViewport(isDesktop);
    renderTable();
    expect(screen.getByRole('link', { name: 'Open Alpha' })).toHaveAttribute('href', '/companies/C-1');
    expect(screen.getByRole('link', { name: 'Open Beta' })).toHaveAttribute('href', '/companies/C-2');
    expect(screen.queryByRole('button', { name: 'Open Alpha' })).toBeNull();
  });

  it('a plain click keeps the existing open behaviour and does not load a new document', () => {
    mockViewport(isDesktop);
    const onActivate = renderTable();
    const notCancelled = fireEvent.click(screen.getByRole('link', { name: 'Open Alpha' }));
    expect(notCancelled).toBe(false);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
  });

  it.each([
    ['Ctrl', { ctrlKey: true }],
    ['Cmd', { metaKey: true }],
    ['Shift', { shiftKey: true }],
  ])('a %s-click leaves the browser to open the record in a new tab', (_key, init) => {
    mockViewport(isDesktop);
    const onActivate = renderTable();
    const notCancelled = fireEvent.click(screen.getByRole('link', { name: 'Open Alpha' }), init);
    expect(notCancelled).toBe(true);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('a middle-click does not open the record in this tab', () => {
    mockViewport(isDesktop);
    const onActivate = renderTable();
    fireEvent(screen.getByRole('link', { name: 'Open Alpha' }), new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1 }));
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('Enter on the focused row link opens the record (keyboard path)', async () => {
    mockViewport(isDesktop);
    const onActivate = renderTable();
    screen.getByRole('link', { name: 'Open Beta' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[1]);
  });

  it('a row without an address keeps the activation button', () => {
    mockViewport(isDesktop);
    renderTable(vi.fn(), (r) => (r.id === 'C-1' ? `/companies/${r.id}` : undefined));
    expect(screen.getByRole('link', { name: 'Open Alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Beta' })).toBeInTheDocument();
  });
});

describe('#2077 whole-row convenience', () => {
  it('clicking elsewhere on a linked row still opens it once', async () => {
    mockViewport(true);
    const onActivate = renderTable();
    await userEvent.click(screen.getByText('980'));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[1]);
  });
});

/**
 * AC-2077-ROWHREF — a list row that opens a record is a REAL link: the first cell is an
 * `<a href>` so Cmd/Ctrl-click, middle-click and "open in new tab" work, a plain click or
 * Enter still navigates in-app through `onActivate`, and the whole-row click stays.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from '../DataTable';

interface Row { id: string; name: string; value: number }
const rows: Row[] = [{ id: 'a1', name: 'Alpha', value: 10 }, { id: 'b2', name: 'Beta', value: 20 }];
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

const table = (onActivate = vi.fn()) => render(
  <DataTable
    rows={rows}
    columns={columns}
    rowKey={(r) => r.id}
    onActivate={onActivate}
    rowLabel={(r) => `Open ${r.name}`}
    rowHref={(r) => `/things/${r.id}`}
  />,
);

describe.each([['desktop table', true], ['phone cards', false]])('AC-2077-ROWHREF %s', (_label, desktop) => {
  it('renders a real link per row with the record URL, and no button for the row open control', () => {
    mockViewport(desktop);
    table();
    expect(screen.getByRole('link', { name: 'Open Alpha' })).toHaveAttribute('href', '/things/a1');
    expect(screen.getByRole('link', { name: 'Open Beta' })).toHaveAttribute('href', '/things/b2');
    expect(screen.queryByRole('button', { name: 'Open Alpha' })).not.toBeInTheDocument();
  });

  it('a plain click navigates in-app once (default prevented, onActivate called once)', () => {
    mockViewport(desktop);
    const onActivate = vi.fn();
    table(onActivate);
    const link = screen.getByRole('link', { name: 'Open Alpha' });
    const click = createEvent.click(link, { button: 0 });
    fireEvent(link, click);
    expect(click.defaultPrevented).toBe(true);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
  });

  it('Ctrl/Cmd/Shift-click and middle-click are left to the browser (new tab): no in-app activation', () => {
    mockViewport(desktop);
    const onActivate = vi.fn();
    table(onActivate);
    const link = screen.getByRole('link', { name: 'Open Alpha' });
    for (const init of [{ button: 0, ctrlKey: true }, { button: 0, metaKey: true }, { button: 0, shiftKey: true }, { button: 1 }]) {
      const ev = createEvent.click(link, init);
      fireEvent(link, ev);
      expect(ev.defaultPrevented).toBe(false);
    }
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('keyboard: the link is a tab stop and Enter activates it', async () => {
    mockViewport(desktop);
    const onActivate = vi.fn();
    table(onActivate);
    const first = screen.getByRole('link', { name: 'Open Alpha' });
    for (let i = 0; i < 6 && document.activeElement !== first; i += 1) await userEvent.tab();
    expect(first).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
  });
});

describe('AC-2077-ROWHREF desktop row click', () => {
  it('whole-row click still activates, and without rowHref the open control stays a button', async () => {
    mockViewport(true);
    const onActivate = vi.fn();
    table(onActivate);
    await userEvent.click(screen.getByText('20'));
    expect(onActivate).toHaveBeenCalledWith(rows[1]);
    const { unmount } = render(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onActivate={vi.fn()} rowLabel={(r) => `Open ${r.name}`} />,
    );
    expect(screen.getAllByRole('button', { name: 'Open Alpha' }).length).toBeGreaterThan(0);
    unmount();
  });
});

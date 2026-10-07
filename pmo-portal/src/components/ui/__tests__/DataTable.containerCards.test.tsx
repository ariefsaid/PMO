/**
 * AC-TBL-CARDS-001 (#785 Discover) — a DataTable inside a column narrower than the viewport implies (the record layout:
 * table beside the record panel) switches to the stacked record cards on its OWN width, opt-in via `cardBelow`.
 *
 * WHAT BROKE. At 1024px the Work orders table sat in a 346px column; its four columns needed ~530px, so the table
 * scrolled sideways inside a clipped box: the Invoice action sat behind a scrollbar nobody saw and billing words were cut
 * mid-word at the clip. The viewport rule (cards below 768px) never fired because the VIEWPORT was wide.
 *
 * Exactly one branch renders (the single-render rule), so nothing is duplicated in the DOM or the a11y tree.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import React from 'react';
import { DataTable, type Column } from '../DataTable';

interface Row { id: string; name: string }
const rows: Row[] = [{ id: 'r-1', name: 'Alpha' }];
const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name },
  { key: 'act', header: 'Actions', cell: () => <button type="button">Invoice</button> },
];

let width = 0;
let observed: ((w: number) => void) | null = null;
beforeEach(() => {
  width = 0;
  observed = null;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width, height: 0, top: 0, left: 0, right: width, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
  vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) {
      observed = (w: number) => { width = w; cb([] as unknown as ResizeObserverEntry[], this as unknown as ResizeObserver); };
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const renderTable = (cardBelow?: number) =>
  render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} cardBelow={cardBelow} />);

describe('DataTable — cards on its own width (AC-TBL-CARDS-001)', () => {
  it('AC-TBL-CARDS-001 a table narrower than its threshold renders the record cards, not a sideways-scrolling table', () => {
    width = 346;
    renderTable(560);
    expect(screen.getByTestId('dt-card-branch')).toBeInTheDocument();
    expect(screen.queryByTestId('dt-table-branch')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Invoice' })).toHaveLength(1);
  });

  it('AC-TBL-CARDS-001 a table at or above its threshold stays a table', () => {
    width = 602;
    renderTable(560);
    expect(screen.getByTestId('dt-table-branch')).toBeInTheDocument();
    expect(screen.queryByTestId('dt-card-branch')).toBeNull();
  });

  it('AC-TBL-CARDS-001 it follows the column as it resizes, both ways', () => {
    width = 602;
    renderTable(560);
    act(() => observed?.(346));
    expect(screen.getByTestId('dt-card-branch')).toBeInTheDocument();
    act(() => observed?.(700));
    expect(screen.getByTestId('dt-table-branch')).toBeInTheDocument();
  });

  it('AC-TBL-CARDS-001 without the opt-in, or with no measured width, a desktop table stays a table', () => {
    width = 200;
    const a = renderTable();
    expect(screen.getByTestId('dt-table-branch')).toBeInTheDocument();
    a.unmount();
    width = 0;
    renderTable(560);
    expect(screen.getByTestId('dt-table-branch')).toBeInTheDocument();
  });
});

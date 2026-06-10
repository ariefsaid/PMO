import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import React from 'react';
import { DataTable, type Column, type RowMenuItem } from '../DataTable';

/**
 * B-4 (AC-W2-IXD-006): Row-action discoverability.
 *
 * The DataTable's row-action menu trigger (⋯) was `opacity-0 group-hover:opacity-100` —
 * invisible without hover, and therefore undiscoverable on touch devices and for
 * keyboard users who navigate without a mouse.
 *
 * Fix: remove `opacity-0 group-hover:opacity-100` so the trigger is always visible.
 * Keep `focus-visible:opacity-100` (focus ring for keyboard users) and
 * `aria-expanded:opacity-100` (open-state persistence) — both are still relevant
 * for keyboard + screen-reader paths.
 *
 * Owning layer: component (RTL) — AC-W2-IXD-006.
 */

type Row = { id: string; name: string };

const columns: Column<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name },
];

const menu: (row: Row) => RowMenuItem[] = (row) => [
  { label: `Edit ${row.name}`, onClick: () => undefined },
];

const renderTable = () =>
  render(
    <DataTable<Row>
      rows={[{ id: 'r1', name: 'Acme Corp' }]}
      columns={columns}
      rowKey={(r) => r.id}
      rowMenu={menu}
    />,
  );

// Helper: scope to the desktop table branch so each test targets the specific trigger
// being verified (discoverability on the always-visible table row trigger).
// The dual-render (OD-W4-4) means BOTH branches now expose a "Row actions" button —
// the card branch is no longer aria-hidden (mobile AT fix). Scoping to the table branch
// keeps these assertions focused on the desktop row-action affordance.
function getTableBranch() {
  return document.querySelector('[data-testid="dt-table-branch"]') as HTMLElement;
}

describe('DataTable — row-action discoverability (B-4, AC-W2-IXD-006)', () => {
  it('AC-W2-IXD-006: the row-action trigger is rendered in the DOM (not visibility:hidden or display:none)', () => {
    renderTable();
    // Scope to the table branch — the card branch also has a Row actions trigger after
    // the mobile a11y fix removed aria-hidden. Either trigger proves discoverability;
    // scoping here confirms the desktop/table path specifically.
    const trigger = within(getTableBranch()).getByRole('button', { name: /row actions/i });
    expect(trigger).toBeInTheDocument();
    // The trigger must be visible/reachable — not just in the DOM but not hidden.
    // (Tailwind opacity-0 is not `visibility:hidden`, but the key intent is no hover-gating.)
    expect(trigger).not.toHaveStyle({ display: 'none' });
  });

  it('AC-W2-IXD-006: the trigger does NOT have opacity-0 as an inline style (visible by default)', () => {
    renderTable();
    const trigger = within(getTableBranch()).getByRole('button', { name: /row actions/i });
    // opacity-0 applied via Tailwind class — check the class list, not computed style
    // (jsdom doesn't compute Tailwind). The fix removes the `opacity-0` class.
    expect(trigger.className).not.toContain('opacity-0');
  });

  it('AC-W2-IXD-006: the trigger is keyboard-focusable (tabIndex not -1)', () => {
    renderTable();
    const trigger = within(getTableBranch()).getByRole('button', { name: /row actions/i });
    // The trigger must be in the natural tab order — tabIndex 0 (or unset = 0).
    expect(trigger.tabIndex).not.toBe(-1);
  });
});

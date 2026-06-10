/**
 * AC-IXD-MOBILE-W4-C1 — DataTable mobile card-reflow
 *
 * The shared DataTable renders a stacked record-card list on narrow viewports
 * (`md:hidden` card branch) alongside the existing `<table>` (`hidden md:block`
 * table branch) so every list-surface inherits the reflow without consumer changes.
 *
 * Architecture (OD-W4-4):
 * - The `<table>` branch carries `hidden md:block` — excluded from AT at ≥768px by
 *   display:none from the `hidden` Tailwind class.
 * - The card `<ul>` branch carries `md:hidden` — excluded from AT at ≥768px by
 *   display:none. At <768px it IS the visible structure and MUST be AT-readable.
 * - AT presence at each breakpoint is governed entirely by `display:none` (from
 *   Tailwind `hidden`/`md:hidden`). Neither branch uses `aria-hidden`; at any given
 *   viewport exactly one branch is `display:none` and therefore absent from AT.
 * - jsdom cannot evaluate Tailwind responsive classes — both branches are always
 *   visible in the DOM in the test environment; RTL accessible-role queries find
 *   both. Consumer tests that target a specific branch use `within(getTableBranch())`
 *   or `within(getCardBranch())` scoping to stay precise.
 *
 * Test strategy: we verify:
 *   - correct responsive classes on each branch
 *   - card branch has NO aria-hidden (AT-readable when displayed at mobile)
 *   - card row data IS accessible via role/accessible-name queries (regression guard
 *     against the double-hide bug: display:none + aria-hidden = invisible to mobile AT)
 *   - card branch has one <li> per row, <dl>/<dt>/<dd> field anatomy
 *   - activation <button> carries the correct aria-label (AT-reachable by name)
 *   - rowMenu ⋯ trigger has the touch-target class
 *   - state variants (loading/empty/error) delegate to ListState in the card branch
 *   - selected card carries the primary/[0.07] wash class
 *   - no data column is dropped
 *
 * Desktop regression: the table branch carries `hidden md:block` — its content
 * is untouched and the existing consumer test suite (DataTable.test.tsx, all page
 * tests) remains stable (scoped to `dt-table-branch`).
 *
 * Touch-target sweep (C6): Button size="sm" and size="icon" carry `.touch-target`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable, type Column } from '../DataTable';
import { Button } from '../Button';

interface Row {
  id: string;
  name: string;
  value: number;
  status: string;
}

const rows: Row[] = [
  { id: 'R-1', name: 'Alpha Corp', value: 125000, status: 'Active' },
  { id: 'R-2', name: 'Beta Ltd', value: 87400, status: 'Pending' },
];

const columns: Column<Row>[] = [
  { key: 'name', header: 'Company', cell: (r) => r.name },
  { key: 'value', header: 'Value', align: 'num', cell: (r) => r.value },
  { key: 'status', header: 'Status', cell: (r) => r.status },
];

// Helper: get the card branch DOM node.
function getCardBranch() {
  return document.querySelector('[data-testid="dt-card-branch"]') as HTMLElement;
}

// Helper: get the table branch DOM node.
function getTableBranch() {
  return document.querySelector('[data-testid="dt-table-branch"]') as HTMLElement;
}

// ── Dual-render structure ─────────────────────────────────────────────────────

describe('DataTable — mobile card-reflow (AC-IXD-MOBILE-W4-C1)', () => {
  it('renders the table branch with hidden md:block (desktop unchanged)', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const tableWrapper = getTableBranch();
    expect(tableWrapper).toBeInTheDocument();
    expect(tableWrapper.className).toContain('hidden');
    expect(tableWrapper.className).toContain('md:block');
  });

  it('AC-IXD-MOBILE-W4-A11Y: renders the card-list branch with md:hidden and NO aria-hidden (mobile AT must read cards)', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const cardBranch = getCardBranch();
    expect(cardBranch).toBeInTheDocument();
    expect(cardBranch.className).toContain('md:hidden');
    // CRITICAL: aria-hidden must NOT be present. At <768px the table branch is display:none
    // (from `hidden md:block`) and the card branch is the only visible structure. If the card
    // branch also had aria-hidden="true", mobile screen-reader users would have ZERO row data.
    // display:none from Tailwind `hidden`/`md:hidden` already scopes AT per viewport — we do
    // not need aria-hidden on either branch.
    expect(cardBranch).not.toHaveAttribute('aria-hidden');
  });

  it('AC-IXD-MOBILE-W4-A11Y: card branch row data is AT-reachable via role/accessible-name (regression: no double-hide)', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={vi.fn()}
        rowLabel={(r) => `Open ${r.name}`}
      />,
    );
    const cardBranch = getCardBranch();
    // The card branch <ul> must itself have role="list" and be AT-reachable.
    // (If aria-hidden were present, screen.getByRole scoped within the card branch's
    // parent would not find any listitem nodes inside it.)
    expect(cardBranch).toHaveAttribute('role', 'list');
    // Each card <li> is an accessible listitem — within() searches descendants.
    const items = within(cardBranch).getAllByRole('listitem');
    expect(items).toHaveLength(rows.length);
    // The activation button is AT-reachable by its accessible name — the company name
    // is exposed to the screen reader via the card, not just the (hidden at mobile) table.
    // within(cardBranch) scopes to the card branch to prove these buttons are in the card AX tree.
    expect(within(cardBranch).getByRole('button', { name: 'Open Alpha Corp' })).toBeInTheDocument();
    expect(within(cardBranch).getByRole('button', { name: 'Open Beta Ltd' })).toBeInTheDocument();
  });

  // ── Card anatomy ─────────────────────────────────────────────────────────

  it('each row produces an <li> in the card branch (one per row)', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const cardBranch = getCardBranch();
    const liItems = cardBranch.querySelectorAll('li');
    expect(liItems).toHaveLength(rows.length);
  });

  it('the first column value appears in each card', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const cardBranch = getCardBranch();
    expect(cardBranch.textContent).toContain('Alpha Corp');
    expect(cardBranch.textContent).toContain('Beta Ltd');
  });

  it('remaining columns render as <dt>/<dd> pairs in the card <dl>', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const cardBranch = getCardBranch();
    // <dt> labels for remaining columns (Value, Status — not the first column Company)
    const dts = cardBranch.querySelectorAll('dt');
    const dtTexts = Array.from(dts).map((dt) => dt.textContent);
    expect(dtTexts).toContain('Value');
    expect(dtTexts).toContain('Status');
    // <dd> values
    expect(cardBranch.textContent).toContain('125000');
    expect(cardBranch.textContent).toContain('Active');
  });

  it('numeric columns carry the tabular and text-right classes on their <dd>', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const cardBranch = getCardBranch();
    // Find the <dd> for the Value column by locating the sibling of the "Value" <dt>
    const valueDt = Array.from(cardBranch.querySelectorAll('dt')).find(
      (dt) => dt.textContent === 'Value',
    );
    expect(valueDt).toBeTruthy();
    const valueDd = valueDt!.nextElementSibling as HTMLElement;
    expect(valueDd.tagName).toBe('DD');
    expect(valueDd.className).toContain('tabular');
    expect(valueDd.className).toContain('text-right');
  });

  // ── Activation (rowLabel + onActivate) ───────────────────────────────────

  it('when rowLabel+onActivate supplied, the card title is a <button> with the aria-label', () => {
    const onActivate = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Open ${r.name}`}
      />,
    );
    const cardBranch = getCardBranch();
    // DOM query scoped to the card branch — the table branch also has an "Open Alpha Corp" button.
    const btn = cardBranch.querySelector('button[aria-label="Open Alpha Corp"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // focus-visible ring classes
    expect(btn.className).toContain('focus-visible:outline-offset-2');
    expect(btn.className).toContain('focus-visible:outline-ring');
    expect(btn.tabIndex).not.toBe(-1);
  });

  it('clicking the card activation button fires onActivate with the row', async () => {
    const onActivate = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={onActivate}
        rowLabel={(r) => `Open ${r.name}`}
      />,
    );
    const cardBranch = getCardBranch();
    const btn = cardBranch.querySelector('button[aria-label="Open Alpha Corp"]') as HTMLButtonElement;
    await userEvent.click(btn);
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
  });

  // ── rowMenu in card ──────────────────────────────────────────────────────

  it('the rowMenu ⋯ trigger appears in each card (one per row)', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
      />,
    );
    const cardBranch = getCardBranch();
    // Each RowMenu trigger has aria-label="Row actions"
    const triggers = cardBranch.querySelectorAll('button[aria-label="Row actions"]');
    expect(triggers).toHaveLength(rows.length);
  });

  it('the rowMenu ⋯ trigger in the card carries the touch-target class', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
      />,
    );
    const cardBranch = getCardBranch();
    const trigger = cardBranch.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    expect(trigger.className).toContain('touch-target');
  });

  it('the rowMenu opens from the card branch trigger and menu items fire their callbacks', async () => {
    const onEdit = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit item', onClick: onEdit }]}
      />,
    );
    const cardBranch = getCardBranch();
    const trigger = cardBranch.querySelector('button[aria-label="Row actions"]') as HTMLButtonElement;
    await userEvent.click(trigger);
    // The menu popover renders inside the card branch — use DOM query to scope to this branch.
    const menuItem = cardBranch.querySelector('button[role="menuitem"]') as HTMLButtonElement;
    expect(menuItem).not.toBeNull();
    expect(menuItem.textContent).toBe('Edit item');
    await userEvent.click(menuItem);
    expect(onEdit).toHaveBeenCalled();
  });

  // ── Async states (ListState delegation) ──────────────────────────────────

  it('state="loading" renders the loading ListState inside the card branch', () => {
    render(
      <DataTable rows={[]} columns={columns} rowKey={(r) => r.id} state="loading" />,
    );
    const cardBranch = getCardBranch();
    expect(cardBranch.querySelector('[data-testid="liststate-loading"]')).not.toBeNull();
  });

  it('state="empty" renders the empty ListState inside the card branch', () => {
    render(
      <DataTable
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        state="empty"
        emptyTitle="Nothing here"
      />,
    );
    const cardBranch = getCardBranch();
    expect(cardBranch.textContent).toContain('Nothing here');
  });

  it('state="error" renders the error ListState inside the card branch', async () => {
    const onRetry = vi.fn();
    render(
      <DataTable
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        state="error"
        errorTitle="Load failed"
        onRetry={onRetry}
      />,
    );
    const cardBranch = getCardBranch();
    expect(cardBranch.textContent).toContain('Load failed');
    // Retry button — use querySelectorAll (aria-hidden container; find by text inside)
    const retryBtns = Array.from(cardBranch.querySelectorAll('button')).filter(
      (b) => /retry/i.test(b.textContent ?? ''),
    );
    expect(retryBtns.length).toBeGreaterThanOrEqual(1);
    await userEvent.click(retryBtns[0]);
    expect(onRetry).toHaveBeenCalled();
  });

  // ── Selected state ───────────────────────────────────────────────────────

  it('the selected card carries the primary/[0.07] wash class', () => {
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        selectedKey="R-1"
      />,
    );
    const cardBranch = getCardBranch();
    const firstLi = cardBranch.querySelector('li') as HTMLElement;
    expect(firstLi.className).toContain('bg-primary/[0.07]');
  });

  // ── No data dropped ──────────────────────────────────────────────────────

  it('every non-title column has a <dt> label in the card (no data dropped)', () => {
    render(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />,
    );
    const cardBranch = getCardBranch();
    const dts = cardBranch.querySelectorAll('dt');
    // columns: Company (title), Value, Status → 2 dt per card × 2 rows = 4
    expect(dts).toHaveLength(4);
  });

  // ── Touch-target sweep (C6) ──────────────────────────────────────────────

  it('Button size="sm" carries the touch-target class for coarse-pointer hit-area expansion (C6)', () => {
    render(<Button size="sm">Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.className).toContain('touch-target');
  });

  it('Button iconOnly (size="icon") carries the touch-target class (C6)', () => {
    render(<Button iconOnly aria-label="Close" />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.className).toContain('touch-target');
  });
});

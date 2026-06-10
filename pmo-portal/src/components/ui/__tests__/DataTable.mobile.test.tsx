/**
 * AC-IXD-MOBILE-W4-C1 — DataTable mobile card-reflow
 *
 * The shared DataTable renders a stacked record-card list on narrow viewports
 * (`md:hidden` card branch) alongside the existing `<table>` (`hidden md:block`
 * table branch) so every list-surface inherits the reflow without consumer changes.
 *
 * Architecture (OD-W4-4):
 * - The `<table>` is the authoritative semantic/accessible structure (aria-sort,
 *   role="row", column headers). It is ALWAYS in the DOM.
 * - The card `<ul>` is a CSS-layout visual alternative for sighted touch users,
 *   marked `aria-hidden="true"` to avoid duplicating content for screen readers.
 *   AT always navigates via the table; the card branch is visual-only.
 * - jsdom cannot evaluate Tailwind responsive classes — both branches are always
 *   visible in the DOM; on a real narrow viewport only the card branch renders.
 *
 * Test strategy: because the card branch is aria-hidden we query it with direct
 * DOM APIs (`querySelector`, `querySelectorAll`, `closest`) rather than RTL's
 * accessible-tree queries (`getByRole`). We verify structural integrity:
 *   - correct responsive classes on each branch
 *   - card branch has one <li> per row
 *   - each <li> contains the first-column value and a <dl> with the remaining columns
 *   - activation <button> is present in the card with the correct class/label
 *   - rowMenu ⋯ trigger has the touch-target class
 *   - state variants (loading/empty/error) delegate to ListState in the card branch
 *   - selected card carries the primary/[0.07] wash class
 *   - no data column is dropped
 *
 * Desktop regression: the table branch carries `hidden md:block` — its content
 * is untouched and the existing consumer test suite (DataTable.test.tsx, all page
 * tests) runs against the table branch as the accessible structure.
 *
 * Touch-target sweep (C6): Button size="sm" and size="icon" carry `.touch-target`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

// Helper: get the card branch DOM node directly (bypasses aria-hidden for DOM queries).
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

  it('renders the card-list branch with md:hidden and aria-hidden (mobile shows cards, AT uses table)', () => {
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const cardBranch = getCardBranch();
    expect(cardBranch).toBeInTheDocument();
    expect(cardBranch.className).toContain('md:hidden');
    // aria-hidden keeps the card branch out of the accessible tree — the table is the
    // authoritative semantic structure; cards are a visual layout alternative only.
    expect(cardBranch).toHaveAttribute('aria-hidden', 'true');
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
    // DOM query (card branch is aria-hidden, not accessible-tree)
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
    // The menu popover renders inside the aria-hidden card branch — use DOM query.
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

/**
 * AC-IXD-MOBILE-W4-C1 — DataTable mobile card-reflow (SINGLE render)
 *
 * The shared DataTable single-renders EITHER the desktop `<table>` OR a stacked
 * record-card list, chosen by `useIsDesktop()` reading `(min-width: 768px)`.
 * Exactly ONE branch is in the DOM at a time — no duplication, no aria-hidden.
 *
 * Architecture (OD-W4-4):
 * - At ≥768px: only the `<table>` branch renders (the card branch is absent).
 * - At <768px: only the card `<ul role="list">` branch renders (the table branch
 *   is absent). It is the sole structure, so it MUST be fully AT-readable — and it
 *   carries NO aria-hidden (which would hide the only row data from mobile AT).
 *
 * Test strategy: jsdom has no real layout, so these tests drive the branch choice
 * by stubbing `window.matchMedia`:
 *   - the suite-wide default (test/setup.ts) is DESKTOP (`matches:true`) → table branch.
 *   - `mockViewport(false)` below stubs MOBILE → card branch, for the card tests.
 * We verify, at mobile, that the card branch renders (and the table branch does
 * NOT), the AT-reachability (cards in the a11y tree, NO aria-hidden), card anatomy
 * (<li>/<dl>/<dt>/<dd>), activation buttons, rowMenu, and the async states; and at
 * desktop that the table renders and the card branch is absent.
 *
 * Touch-target sweep (C6): Button size="sm" and size="icon" carry `.touch-target`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
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

/**
 * Stubs `window.matchMedia` so `useIsDesktop()` resolves to the given viewport.
 * `isDesktop=false` → the `(min-width:768px)` query reports `matches:false` →
 * DataTable renders the card branch. Restored by `afterEach` (unstubAllGlobals).
 */
function mockViewport(isDesktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: isDesktop,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

afterEach(() => vi.unstubAllGlobals());

// Helper: get the card branch DOM node (present only at mobile).
function getCardBranch() {
  return document.querySelector('[data-testid="dt-card-branch"]') as HTMLElement | null;
}

// Helper: get the table branch DOM node (present only at desktop).
function getTableBranch() {
  return document.querySelector('[data-testid="dt-table-branch"]') as HTMLElement | null;
}

describe('DataTable — mobile card-reflow (AC-IXD-MOBILE-W4-C1)', () => {
  // ── Branch selection: single render ─────────────────────────────────────────

  it('at mobile (<768px) renders the card branch and NOT the table branch', () => {
    mockViewport(false);
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(getCardBranch()).toBeInTheDocument();
    expect(getTableBranch()).not.toBeInTheDocument();
    // No <table> in the DOM at mobile.
    expect(document.querySelector('table')).toBeNull();
  });

  it('at desktop (≥768px) renders the table branch and NOT the card branch', () => {
    mockViewport(true);
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(getTableBranch()).toBeInTheDocument();
    expect(getCardBranch()).not.toBeInTheDocument();
  });

  // ── AT reachability (no aria-hidden, single copy) ───────────────────────────

  it('AC-IXD-MOBILE-W4-A11Y: the card branch is in the a11y tree with NO aria-hidden (mobile AT must read cards)', () => {
    mockViewport(false);
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const cardBranch = getCardBranch()!;
    expect(cardBranch).toBeInTheDocument();
    // CRITICAL: at mobile the card branch is the ONLY structure rendered. If it
    // carried aria-hidden="true", a mobile screen-reader user would get ZERO row
    // data. Single-render means no aria-hidden is needed on either branch.
    expect(cardBranch).not.toHaveAttribute('aria-hidden');
    expect(cardBranch).toHaveAttribute('role', 'list');
  });

  it('AC-IXD-MOBILE-W4-A11Y: card row data is AT-reachable via role/accessible-name (single, unambiguous match)', () => {
    mockViewport(false);
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={vi.fn()}
        rowLabel={(r) => `Open ${r.name}`}
      />,
    );
    // One listitem per row — discoverable in the global a11y tree (no scoping needed,
    // the table branch is absent so there is no second copy).
    expect(screen.getAllByRole('listitem')).toHaveLength(rows.length);
    // The activation buttons are AT-reachable by name — a SINGLE match each now that
    // the table branch is not in the DOM.
    expect(screen.getByRole('button', { name: 'Open Alpha Corp' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Beta Ltd' })).toBeInTheDocument();
  });

  // ── Card anatomy ─────────────────────────────────────────────────────────

  it('each row produces an <li> in the card branch (one per row)', () => {
    mockViewport(false);
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(getCardBranch()!.querySelectorAll('li')).toHaveLength(rows.length);
  });

  it('the first column value appears in each card', () => {
    mockViewport(false);
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    expect(screen.getByText('Alpha Corp')).toBeInTheDocument();
    expect(screen.getByText('Beta Ltd')).toBeInTheDocument();
  });

  it('remaining columns render as <dt>/<dd> pairs in the card <dl>', () => {
    mockViewport(false);
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const cardBranch = getCardBranch()!;
    const dtTexts = Array.from(cardBranch.querySelectorAll('dt')).map((dt) => dt.textContent);
    expect(dtTexts).toContain('Value');
    expect(dtTexts).toContain('Status');
    expect(cardBranch.textContent).toContain('125000');
    expect(cardBranch.textContent).toContain('Active');
  });

  it('numeric columns carry the tabular and text-right classes on their <dd>', () => {
    mockViewport(false);
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    const cardBranch = getCardBranch()!;
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
    mockViewport(false);
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        onActivate={vi.fn()}
        rowLabel={(r) => `Open ${r.name}`}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Open Alpha Corp' });
    expect(btn.className).toContain('focus-visible:outline-offset-2');
    expect(btn.className).toContain('focus-visible:outline-ring');
    expect((btn as HTMLButtonElement).tabIndex).not.toBe(-1);
  });

  it('clicking the card activation button fires onActivate with the row', async () => {
    mockViewport(false);
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
    await userEvent.click(screen.getByRole('button', { name: 'Open Alpha Corp' }));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith(rows[0]);
  });

  // ── rowMenu in card ──────────────────────────────────────────────────────

  it('the rowMenu ⋯ trigger appears in each card (one per row)', () => {
    mockViewport(false);
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
      />,
    );
    expect(screen.getAllByRole('button', { name: /row actions/i })).toHaveLength(rows.length);
  });

  it('the rowMenu ⋯ trigger in the card carries the touch-target class', () => {
    mockViewport(false);
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit', onClick: vi.fn() }]}
      />,
    );
    expect(screen.getAllByRole('button', { name: /row actions/i })[0].className).toContain(
      'touch-target',
    );
  });

  it('the rowMenu opens from the card branch trigger and menu items fire their callbacks', async () => {
    mockViewport(false);
    const onEdit = vi.fn();
    render(
      <DataTable
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        rowMenu={() => [{ label: 'Edit item', onClick: onEdit }]}
      />,
    );
    await userEvent.click(screen.getAllByRole('button', { name: /row actions/i })[0]);
    const menuItem = screen.getByRole('menuitem', { name: 'Edit item' });
    await userEvent.click(menuItem);
    expect(onEdit).toHaveBeenCalled();
  });

  // ── Async states (ListState delegation) ──────────────────────────────────

  it('state="loading" renders the loading ListState inside the card branch', () => {
    mockViewport(false);
    render(<DataTable rows={[]} columns={columns} rowKey={(r) => r.id} state="loading" />);
    expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  });

  it('state="empty" renders the empty ListState inside the card branch', () => {
    mockViewport(false);
    render(
      <DataTable
        rows={[]}
        columns={columns}
        rowKey={(r) => r.id}
        state="empty"
        emptyTitle="Nothing here"
      />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('state="error" renders the error ListState inside the card branch', async () => {
    mockViewport(false);
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
    expect(screen.getByRole('alert')).toHaveTextContent('Load failed');
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  // ── Selected state ───────────────────────────────────────────────────────

  it('the selected card carries the primary/[0.07] wash class', () => {
    mockViewport(false);
    render(
      <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} selectedKey="R-1" />,
    );
    const firstLi = getCardBranch()!.querySelector('li') as HTMLElement;
    expect(firstLi.className).toContain('bg-primary/[0.07]');
  });

  // ── No data dropped ──────────────────────────────────────────────────────

  it('every non-title column has a <dt> label in the card (no data dropped)', () => {
    mockViewport(false);
    render(<DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />);
    // columns: Company (title), Value, Status → 2 dt per card × 2 rows = 4
    expect(getCardBranch()!.querySelectorAll('dt')).toHaveLength(4);
  });

  // ── Touch-target sweep (C6) ──────────────────────────────────────────────

  it('Button size="sm" carries the touch-target class for coarse-pointer hit-area expansion (C6)', () => {
    render(<Button size="sm">Save</Button>);
    expect(screen.getByRole('button', { name: 'Save' }).className).toContain('touch-target');
  });

  it('Button iconOnly (size="icon") carries the touch-target class (C6)', () => {
    render(<Button iconOnly aria-label="Close" />);
    expect(screen.getByRole('button', { name: 'Close' }).className).toContain('touch-target');
  });
});

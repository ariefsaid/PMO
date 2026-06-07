import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette, type PaletteItem } from '../CommandPalette';

const items: PaletteItem[] = [
  { id: 'nav-sales', group: 'Navigate', title: 'Sales Pipeline', icon: 'pipe', run: vi.fn() },
  { id: 'nav-proc', group: 'Navigate', title: 'Procurement', icon: 'cart', run: vi.fn() },
  { id: 'act-new', group: 'Actions', title: 'New project', icon: 'plus', run: vi.fn() },
];

describe('CommandPalette', () => {
  it('renders a modal dialog when open', () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  it('renders nothing when closed', () => {
    render(<CommandPalette open={false} items={items} onClose={vi.fn()} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('typing filters the options (after the debounce)', async () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'proc');
    // 120ms debounce before the filter applies.
    expect(await screen.findByText('Procurement')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Sales Pipeline')).not.toBeInTheDocument()
    );
  });

  it('ArrowDown moves aria-selected; Enter runs the selected item', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open items={items} onClose={onClose} />);
    // first option is selected by default
    const opts = screen.getAllByRole('option');
    expect(opts[0]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(items[1].run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('Esc closes', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open items={items} onClose={onClose} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('clicking the backdrop closes', async () => {
    const onClose = vi.fn();
    render(<CommandPalette open items={items} onClose={onClose} />);
    await userEvent.click(screen.getByTestId('cmdk-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('no-match shows an empty state (after the debounce)', async () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'zzzzz');
    expect(await screen.findByText(/no results/i)).toBeInTheDocument();
  });

  it('returns focus to the trigger on close', async () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();
    const { rerender } = render(
      <CommandPalette open items={items} onClose={vi.fn()} returnFocusTo={trigger} />
    );
    rerender(<CommandPalette open={false} items={items} onClose={vi.fn()} returnFocusTo={trigger} />);
    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  // I1 — active option must carry a clearly-perceptible visible-selection class
  it('I1: active option carries visible-selection class (bg-primary/10) — not just bg-accent', () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    const opts = screen.getAllByRole('option');
    // First item is selected by default
    expect(opts[0]).toHaveAttribute('aria-selected', 'true');
    // Must have the primary tint class for perceptible contrast, not the invisible accent
    expect(opts[0].className).toMatch(/bg-primary\/10/);
  });

  it('I1: non-active options do NOT carry bg-primary/10', () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    const opts = screen.getAllByRole('option');
    expect(opts[1]).toHaveAttribute('aria-selected', 'false');
    expect(opts[1].className).not.toMatch(/bg-primary\/10/);
  });

  // ── Phase E: record search states ──────────────────────────────────────────

  // AC-CMDK-004: record lists still fetching → skeleton rows, Navigate still shows.
  it('AC-CMDK-004: loading shows skeleton rows (not a spinner) and Navigate still renders', () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} loading />);
    expect(screen.getAllByTestId('cmdk-skeleton-row').length).toBeGreaterThan(0);
    // Navigate group still works during record-list loading (graceful degradation).
    expect(screen.getByText('Sales Pipeline')).toBeInTheDocument();
  });

  // AC-CMDK-005: a record list errored → inline retry note + Navigate still works.
  it('AC-CMDK-005: error shows an inline retry note and Navigate still renders', async () => {
    const onRetry = vi.fn();
    render(<CommandPalette open items={items} onClose={vi.fn()} error onRetry={onRetry} />);
    expect(screen.getByText(/couldn.t load records/i)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalled();
    // Module navigation is unaffected by the record-list error.
    expect(screen.getByText('Procurement')).toBeInTheDocument();
  });

  // AC-CMDK-006: a group with > cap matches shows 8 rows + a "+N more" footer.
  it('AC-CMDK-006: caps a group at 8 rows and shows a "+N more" footer', async () => {
    const many: PaletteItem[] = Array.from({ length: 11 }, (_, i) => ({
      id: `rec-${i}`,
      group: 'Records',
      title: `Record match ${i}`,
      sub: 'Project',
      icon: 'folder',
      run: vi.fn(),
    }));
    render(<CommandPalette open items={many} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'record match');
    // "+3 more" overflow footer (11 - 8), after the debounce.
    expect(await screen.findByText(/\+3 more/i)).toBeInTheDocument();
    expect(screen.getByText(/refine your search/i)).toBeInTheDocument();
    // Only the cap renders as options.
    const recordOptions = screen
      .getAllByRole('option')
      .filter((o) => /Record match/.test(o.textContent ?? ''));
    expect(recordOptions).toHaveLength(8);
  });

  // AC-CMDK-003: a Records row Enter runs its `run` and closes.
  it('AC-CMDK-003: pressing Enter on a record row runs it and closes', async () => {
    const run = vi.fn();
    const onClose = vi.fn();
    const recs: PaletteItem[] = [
      { id: 'rec-1', group: 'Records', title: 'Harbour Expansion', sub: 'Project', code: 'PRJ-0142', icon: 'folder', run },
      ...items,
    ];
    render(<CommandPalette open items={recs} onClose={onClose} />);
    await userEvent.type(screen.getByRole('combobox'), 'harbour');
    // Wait for the debounced filter so the record row is the selected option.
    await screen.findByText('Harbour Expansion');
    await userEvent.keyboard('{Enter}');
    expect(run).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  // AC-CMDK-002: exact code match ranks first inside Records, even when a
  // competing substring match is present. Proven against the REAL rendered palette.
  it('AC-CMDK-002: an exact code match renders before a competing substring match', async () => {
    const recs: PaletteItem[] = [
      // Title-substring match for "pr-9": ranks AFTER the exact-code row.
      { id: 'rec-decoy', group: 'Records', title: 'PR-90 staging works', sub: 'Procurement', code: 'PRC-0500', icon: 'cart', run: vi.fn() },
      // Exact code match for "pr-9": must float to the top of Records.
      { id: 'rec-exact', group: 'Records', title: 'Crane hire', sub: 'Procurement', code: 'PR-9', icon: 'cart', run: vi.fn() },
      ...items,
    ];
    render(<CommandPalette open items={recs} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'pr-9');
    // After the debounce both rows match; the exact-code row must be first.
    await screen.findByText('Crane hire');
    const recordOptions = screen
      .getAllByRole('option')
      .filter((o) => /Procurement/.test(o.textContent ?? ''));
    expect(recordOptions).toHaveLength(2);
    expect(recordOptions[0]).toHaveTextContent('Crane hire'); // exact-code first
    expect(recordOptions[1]).toHaveTextContent('PR-90 staging works');
  });

  // a11y: a polite live region announces the result count as the filter narrows.
  it('exposes an aria-live result-count region', async () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    const live = screen.getByTestId('cmdk-live-count');
    expect(live).toHaveAttribute('aria-live', 'polite');
    await userEvent.type(screen.getByRole('combobox'), 'proc');
    await waitFor(() => expect(within(live).getByText(/result/i)).toBeInTheDocument());
  });
});

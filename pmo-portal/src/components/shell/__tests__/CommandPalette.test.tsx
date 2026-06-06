import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

  it('typing filters the options', async () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'proc');
    expect(screen.getByText('Procurement')).toBeInTheDocument();
    expect(screen.queryByText('Sales Pipeline')).not.toBeInTheDocument();
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

  it('no-match shows an empty state', async () => {
    render(<CommandPalette open items={items} onClose={vi.fn()} />);
    await userEvent.type(screen.getByRole('combobox'), 'zzzzz');
    expect(screen.getByText(/no results/i)).toBeInTheDocument();
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
});

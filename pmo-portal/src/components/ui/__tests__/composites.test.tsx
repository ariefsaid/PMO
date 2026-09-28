import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Kanban, KanbanColumn, KanbanCard } from '../Kanban';
import { LifecycleStepper } from '../LifecycleStepper';
import { Funnel } from '../Funnel';
import { GateNotice } from '../GateNotice';
import { PageHeader } from '../PageHeader';
import { Tabs } from '../Tabs';
import { StatTiles } from '../StatTiles';

describe('Kanban', () => {
  it('renders columns; empty column shows its message', () => {
    render(
      <Kanban>
        <KanbanColumn title="Leads" count={0} emptyMessage="No leads" />
      </Kanban>
    );
    expect(screen.getByText('Leads')).toBeInTheDocument();
    expect(screen.getByText('No leads')).toBeInTheDocument();
  });

  it('card Enter activates', async () => {
    const onActivate = vi.fn();
    render(<KanbanCard onActivate={onActivate}>Alpha</KanbanCard>);
    const card = screen.getByRole('button', { name: 'Alpha' });
    card.focus();
    await userEvent.keyboard('{Enter}');
    expect(onActivate).toHaveBeenCalled();
  });

  it('renders a column with prob chip, totals, and child cards', () => {
    render(
      <Kanban>
        <KanbanColumn title="Quote" count={1} prob="40%" totals={<span>$2M</span>}>
          <KanbanCard selected>Deal A</KanbanCard>
        </KanbanColumn>
      </Kanban>
    );
    expect(screen.getByText('40%')).toBeInTheDocument();
    expect(screen.getByText('$2M')).toBeInTheDocument();
    expect(screen.getByText('Deal A')).toBeInTheDocument();
  });
});

describe('LifecycleStepper', () => {
  it('bar variant fills done/current bars and de-emphasizes upcoming labels (the ONE stepper)', () => {
    render(
      <LifecycleStepper
        variant="bar"
        steps={[
          { label: 'PR', state: 'done' },
          { label: 'RFQ', state: 'current' },
          { label: 'PO', state: 'upcoming' },
        ]}
      />
    );
    // done bar carries the success fill
    const prStep = screen.getByText('PR').closest('.jstep')!;
    expect(prStep.querySelector('.bg-success')).toBeInTheDocument();
    // current bar carries the primary fill + the `current` state class
    const rfqStep = screen.getByText('RFQ').closest('.jstep')!;
    expect(rfqStep.className).toContain('current');
    expect(rfqStep.querySelector('.bg-primary')).toBeInTheDocument();
    // upcoming step is de-emphasized
    expect(screen.getByText('PO').className).toContain('text-muted-foreground');
  });

  it('bar variant is NOT the retired numbered-circle node stepper (no .pstep nodes)', () => {
    render(
      <LifecycleStepper
        variant="bar"
        steps={[
          { label: 'PR', state: 'done' },
          { label: 'RFQ', state: 'current' },
        ]}
      />
    );
    // The retired node stepper rendered numbered `.pstep` circles — they must be gone.
    expect(document.querySelector('.pstep')).toBeNull();
    expect(screen.getByText('PR').closest('.jstep')).toBeInTheDocument();
  });

  it('inline variant renders pips with done/current/upcoming + links', () => {
    render(
      <LifecycleStepper
        variant="inline"
        steps={[
          { label: 'Draft', state: 'done' },
          { label: 'Active', state: 'current' },
          { label: 'Paid', state: 'paid' },
        ]}
      />
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveAttribute('aria-label', expect.stringContaining('done'));
  });

  it('bar variant renders a doc ref slot', () => {
    render(
      <LifecycleStepper
        variant="bar"
        steps={[{ label: 'PO', state: 'done', ref: 'PO-0042' }]}
      />
    );
    expect(screen.getByText('PO-0042')).toBeInTheDocument();
  });

  it('bar variant paid step renders success treatment (not upcoming grey)', () => {
    render(
      <LifecycleStepper
        variant="bar"
        steps={[
          { label: 'PR', state: 'done' },
          { label: 'Payment', state: 'paid' },
        ]}
      />
    );
    const paymentStep = screen.getByText('Payment').closest('.jstep')!;
    // The paid bar must carry the success fill — not the bare/upcoming track
    expect(paymentStep.querySelector('.bg-success')).toBeInTheDocument();
    expect(paymentStep.querySelector('.bg-transparent')).toBeNull();
  });

  it('AC-A11Y-03: bar variant each step has aria-label conveying "{label}: {state}"', () => {
    render(
      <LifecycleStepper
        variant="bar"
        steps={[
          { label: 'PR', state: 'done' },
          { label: 'RFQ', state: 'current' },
          { label: 'PO', state: 'upcoming' },
        ]}
      />
    );
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('aria-label', 'PR: done');
    expect(items[1]).toHaveAttribute('aria-label', 'RFQ: current');
    expect(items[2]).toHaveAttribute('aria-label', 'PO: upcoming');
  });
});

describe('Funnel', () => {
  it('renders N stages and selected gets the primary wash + inset rule', () => {
    render(
      <Funnel
        selectedIndex={1}
        onSelect={() => {}}
        stages={[
          { name: 'Leads', value: '$1M' },
          { name: 'Quote', value: '$2M' },
        ]}
      />
    );
    expect(screen.getAllByRole('button')).toHaveLength(2);
    expect(screen.getByText('Quote').closest('[role=button]')!.className).toContain('bg-primary/[0.06]');
  });

  it('non-interactive funnel renders prob + weighted + bar without buttons', () => {
    render(
      <Funnel
        stages={[
          { name: 'Leads', value: '$1M', prob: '20%', weighted: '$200K', barPct: 40 },
        ]}
      />
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('20%')).toBeInTheDocument();
    expect(screen.getByText('$200K')).toBeInTheDocument();
  });

  it('funnel stage is keyboard-activatable when interactive', async () => {
    const onSelect = vi.fn();
    render(<Funnel onSelect={onSelect} stages={[{ name: 'Leads', value: '$1M' }]} />);
    const stage = screen.getByRole('button');
    stage.focus();
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it('AC-A11Y-02: prob chip font size is ≥11px (AA floor, text-[11px] class)', () => {
    render(
      <Funnel
        stages={[{ name: 'Leads', value: '$1M', prob: '20%' }]}
      />
    );
    const probChip = screen.getByText('20%');
    // Must carry text-[11px] — not text-[10px] (which was below the AA floor)
    expect(probChip.className).toContain('text-[11px]');
    expect(probChip.className).not.toContain('text-[10px]');
  });

  it('AC-SFA-004: a long dashboard-panel value stays exact inside one local Funnel scroll viewport', () => {
    const longVal = '$1,234,567';
    render(
      <div style={{ width: 260 }}>
        <Funnel
          stages={Array.from({ length: 5 }, (_, i) => ({
            name: `Stage ${i + 1}`,
            value: longVal,
          }))}
        />
      </div>
    );

    // The exact long value is NOT abbreviated or dropped.
    expect(screen.getAllByText(longVal)).toHaveLength(5);

    // The shared Funnel owns a bounded local scroll viewport (never shrinks/abbreviates).
    const scrollArea = screen.getByTestId('funnel-scroll-area');
    expect(scrollArea.className).toContain('max-w-full');
    expect(scrollArea.className).toContain('min-w-0');
    expect(scrollArea.className).toContain('overflow-x-auto');

    // Its child grid is a min-w-full five-track grid so the panel delegates overflow
    // to the local scroller instead of widening the host or clipping the amount.
    const grid = screen.getByTestId('funnel-stage-grid');
    expect(grid.className).toContain('grid');
    expect(grid.className).toContain('min-w-full');
    // Discover fix (2026-09-28, #687 follow-up): each track's MIN is now the stage's own
    // max-content — an intrinsic sizing function, so the browser's track-sizing algorithm
    // treats it as a hard content-derived floor (unlike a fixed `10rem`, which cannot grow
    // for a longer, unbreakable amount and let the digits overflow their stage — FR-SFA-001).
    // The MAX stays `1fr` so leftover desktop width still distributes evenly across stages.
    expect(grid.style.gridTemplateColumns).toBe('repeat(5, minmax(max-content, 1fr))');
  });

  it('FR-SFA-001: a representative long IDR amount does not shrink its stage below its own content width', () => {
    // Regression for the Discover finding: a fixed `10rem` track floor left ~132px of usable
    // content width after padding, while a trillions-scale IDR amount needs ~181px — the
    // digits overflowed into the neighbouring stage. `max-content` tracks must never allow
    // the stage's rendered width to be narrower than its own amount text requires.
    const longIdrVal = 'Rp 1.250.000.000.000,00';
    render(
      <div style={{ width: 390 }}>
        <Funnel
          stages={[
            { name: 'Leads', value: '$1' },
            { name: 'Tender', value: longIdrVal },
          ]}
        />
      </div>
    );
    // The default text normalizer collapses the NBSP after "Rp" to a plain space before
    // matching, so disable it here — the point is the exact unbreakable string, NBSP intact.
    const amount = screen.getByText(longIdrVal, { normalizer: (s) => s });
    expect(amount.className).not.toContain('truncate');
    expect(amount.className).not.toContain('overflow-hidden');
    // jsdom performs no real layout, so this only locks the markup contract (no truncation/
    // clipping classes, exact text preserved); the rendered-geometry proof is the browser
    // oracle in e2e/AC-SFA-001-sales-funnel-amount-geometry.spec.ts.
    expect(amount.textContent).toBe(longIdrVal);
  });

  it('AC-A11Y-SCROLL: a non-interactive (no onSelect) Funnel scroll viewport is itself keyboard-focusable', () => {
    // Discover finding (2026-09-28): the dashboard renders Funnel with no `onSelect`, so no
    // stage is a focusable button — the overflow-x-auto viewport had no focusable content at
    // all, failing axe's `scrollable-region-focusable` for keyboard users. Mirrors the pattern
    // already shipped on pages/BudgetProjection.tsx's scrollable table wrapper.
    render(
      <Funnel
        stages={[
          { name: 'Leads', value: '$1M' },
          { name: 'Quote', value: '$2M' },
        ]}
      />
    );
    const scrollArea = screen.getByTestId('funnel-scroll-area');
    expect(scrollArea).toHaveAttribute('role', 'group');
    expect(scrollArea).toHaveAttribute('aria-label', 'Stage summary, scrollable horizontally');
    expect(scrollArea).toHaveAttribute('tabIndex', '0');
    expect(scrollArea.className).toContain('focus-visible:outline');
  });

  it('AC-A11Y-SCROLL: an interactive (onSelect present) Funnel does not add a redundant wrapper tab stop', () => {
    // The stage buttons are already focusable when onSelect is passed — adding role=group +
    // tabIndex=0 to the wrapper too would insert an extra Tab stop ahead of the first stage.
    render(
      <Funnel
        onSelect={() => {}}
        stages={[
          { name: 'Leads', value: '$1M' },
          { name: 'Quote', value: '$2M' },
        ]}
      />
    );
    const scrollArea = screen.getByTestId('funnel-scroll-area');
    expect(scrollArea).not.toHaveAttribute('role');
    expect(scrollArea).not.toHaveAttribute('tabIndex');
  });

  it('a focused interactive stage scrolls itself into view (keyboard users reach off-screen stages)', () => {
    // Discover finding (2026-09-28): Tab to a partly off-screen stage did not scroll it into
    // view at 390px. Browser scroll geometry can't be proven in jsdom; this locks the call.
    const scrollIntoViewSpy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    render(
      <Funnel
        onSelect={() => {}}
        stages={[
          { name: 'Leads', value: '$1M' },
          { name: 'Quote', value: '$2M' },
        ]}
      />
    );
    const stage = screen.getAllByRole('button')[1];
    stage.focus();
    expect(scrollIntoViewSpy).toHaveBeenCalledWith({ inline: 'nearest', block: 'nearest' });
    scrollIntoViewSpy.mockRestore();
  });

  it('the progress bar stays flush to the bottom of the stage even when weighted text wraps to two lines', () => {
    // Discover finding (2026-09-28): stages stretch to the tallest row member (grid default);
    // a stage whose weighted text wraps sits taller, but its bar previously followed right
    // after that text instead of the box's bottom edge, so bars visibly misaligned across a
    // row. `mt-auto` on a flex-column stage pins the bar to the bottom of every stage box.
    render(
      <Funnel
        stages={[{ name: 'Leads', value: '$1M', weighted: '$200K weighted', barPct: 40 }]}
      />
    );
    const stage = screen.getByText('Leads').closest('[data-funnel-stage]')!;
    expect(stage.className).toContain('flex');
    expect(stage.className).toContain('flex-col');
    const bar = stage.querySelector('.bg-secondary')!;
    expect(bar.className).toContain('mt-auto');
    expect(bar.className).not.toContain('mt-2');
  });
});

describe('GateNotice', () => {
  it('blocked → warning token classes; ready → success', () => {
    const { rerender } = render(<GateNotice variant="blocked">Blocked</GateNotice>);
    expect(screen.getByText('Blocked').closest('div')!.parentElement!.className).toContain('bg-warning/12');
    rerender(<GateNotice variant="ready">Ready</GateNotice>);
    expect(screen.getByText('Ready').closest('div')!.parentElement!.className).toContain('bg-success/10');
  });
});

describe('PageHeader', () => {
  it('renders icon, name, status, meta, stats, and actions', () => {
    render(
      <PageHeader
        icon={<span>P</span>}
        iconColor="hsl(var(--primary))"
        name="Project Alpha"
        status={<span>Active</span>}
        meta="Client: Acme"
        stats={[{ label: 'Budget', value: '$1.2M' }]}
        actions={<button>Edit</button>}
      />
    );
    expect(screen.getByRole('heading', { name: 'Project Alpha' })).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Client: Acme')).toBeInTheDocument();
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
  });
});

describe('Tabs', () => {
  it('marks active tab aria-selected and arrow keys change selection', async () => {
    const onChange = vi.fn();
    render(
      <Tabs
        ariaLabel="Detail"
        value="overview"
        onChange={onChange}
        idBase="t"
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'budget', label: 'Budget' },
        ]}
      />
    );
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    screen.getByRole('tab', { name: 'Overview' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(onChange).toHaveBeenCalledWith('budget');
  });
});

describe('StatTiles', () => {
  it('positive/negative tone coloring', () => {
    render(
      <StatTiles
        tiles={[
          { label: 'Variance', value: '+$10K', tone: 'pos' },
          { label: 'Overrun', value: '-$4K', tone: 'neg' },
        ]}
      />
    );
    expect(screen.getByText('+$10K').className).toContain('text-success');
    expect(screen.getByText('-$4K').className).toContain('text-destructive');
  });
});

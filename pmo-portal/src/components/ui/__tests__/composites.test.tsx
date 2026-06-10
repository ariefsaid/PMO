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
  it('node variant shows a check on done steps and current/upcoming classes', () => {
    render(
      <LifecycleStepper
        variant="node"
        steps={[
          { label: 'PR', state: 'done' },
          { label: 'RFQ', state: 'current' },
          { label: 'PO', state: 'upcoming' },
        ]}
      />
    );
    // done step renders a check icon (not a number)
    const prStep = screen.getByText('PR').closest('.pstep')!;
    expect(prStep.querySelector('svg')).toBeInTheDocument();
    // current step carries the `current` state class
    expect(screen.getByText('RFQ').closest('.pstep')!.className).toContain('current');
    // upcoming step is de-emphasized
    expect(screen.getByText('PO').className).toContain('text-muted-foreground');
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

  it('node variant renders a doc ref slot', () => {
    render(
      <LifecycleStepper
        variant="node"
        steps={[{ label: 'PO', state: 'done', ref: 'PO-0042' }]}
      />
    );
    expect(screen.getByText('PO-0042')).toBeInTheDocument();
  });

  it('node variant paid step renders success treatment (not upcoming grey)', () => {
    render(
      <LifecycleStepper
        variant="node"
        steps={[
          { label: 'PR', state: 'done' },
          { label: 'Payment', state: 'paid' },
        ]}
      />
    );
    const paymentStep = screen.getByText('Payment').closest('.pstep')!;
    const circle = paymentStep.querySelector('span')!;
    // Must carry success classes — not the grey upcoming treatment
    expect(circle.className).toContain('border-success');
    expect(circle.className).toContain('bg-success');
    expect(circle.className).not.toContain('border-border');
    // Paid node renders a check icon (like done), not a number
    expect(paymentStep.querySelector('svg')).toBeInTheDocument();
  });

  it('AC-A11Y-03: node variant each step has aria-label conveying "{label}: {state}"', () => {
    render(
      <LifecycleStepper
        variant="node"
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

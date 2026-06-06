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
  it('renders name, stats, and actions', () => {
    render(
      <PageHeader
        name="Project Alpha"
        stats={[{ label: 'Budget', value: '$1.2M' }]}
        actions={<button>Edit</button>}
      />
    );
    expect(screen.getByRole('heading', { name: 'Project Alpha' })).toBeInTheDocument();
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

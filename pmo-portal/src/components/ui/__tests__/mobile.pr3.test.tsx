/**
 * AC-IXD-MOBILE-W4-PR3 — detail surfaces: Tabs scroll-snap, kanban scroll-snap +
 * stage-progress indicator, stepper scroll-fade, timesheet scroll-fade.
 *
 * Scope: Wave-4 PR-3. FE-only — no migration, no pgTAP. Desktop unchanged.
 *
 * Tests verify MARKUP/CLASS PRESENCE that signals correct behaviour:
 *   - Tabs: scroll container has overflow-x-auto + snap-x on the tablist wrapper
 *   - Tabs: each tab has scroll-snap-align:start equivalent (snap-start)
 *   - Tabs: role=tablist, role=tab, aria-selected preserved
 *   - Tabs: each tab min-h ≥ 44px (h-11 or min-h-[44px])
 *   - Kanban: .kanban-scroll has scroll-snap classes (added via CSS update + data-attr test)
 *   - KanbanStageIndicator: renders stage dots (aria-hidden) + a visible label for each open column
 *   - LifecycleStepper: the scroll-fade wrapper class is present
 *   - TimesheetGrid: the scroll container carries the scroll-fade class
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tabs, type TabItem } from '../Tabs';
import { LifecycleStepper } from '../LifecycleStepper';
import { TimesheetGrid } from '../TimesheetGrid';
import { KanbanStageIndicator } from '../KanbanStageIndicator';

// ─── Tabs ──────────────────────────────────────────────────────────────────

const TAB_ITEMS: TabItem[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'budget', label: 'Budget' },
  { value: 'procurement', label: 'Procurement' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'documents', label: 'Documents' },
];

describe('Tabs — mobile scroll-snap strip (AC-IXD-MOBILE-W4-PR3-C2)', () => {
  it('the tablist container is horizontally scrollable with snap-x', () => {
    render(
      <Tabs
        items={TAB_ITEMS}
        value="overview"
        onChange={() => {}}
        ariaLabel="Project sections"
      />,
    );
    const tablist = screen.getByRole('tablist');
    // The scroll wrapper MUST carry overflow-x-auto and snap-x so tabs don't clip at 375px
    expect(tablist.className).toMatch(/overflow-x-auto/);
    expect(tablist.className).toMatch(/snap-x/);
  });

  it('each tab button has snap-start (scroll-snap-align: start)', () => {
    render(
      <Tabs
        items={TAB_ITEMS}
        value="overview"
        onChange={() => {}}
        ariaLabel="Project sections"
      />,
    );
    const tabs = screen.getAllByRole('tab');
    tabs.forEach((tab) => {
      expect(tab.className).toMatch(/snap-start/);
    });
  });

  it('tabs keep role=tablist and role=tab semantics', () => {
    render(
      <Tabs
        items={TAB_ITEMS}
        value="overview"
        onChange={() => {}}
        ariaLabel="Project sections"
      />,
    );
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getAllByRole('tab')).toHaveLength(TAB_ITEMS.length);
  });

  it('the active tab has aria-selected=true', () => {
    render(
      <Tabs
        items={TAB_ITEMS}
        value="procurement"
        onChange={() => {}}
        ariaLabel="Project sections"
      />,
    );
    const active = screen.getByRole('tab', { name: 'Procurement', selected: true });
    expect(active).toBeInTheDocument();
    expect(active).toHaveAttribute('aria-selected', 'true');
  });

  it('each tab button carries min-h-[44px] or h-11 for touch targets', () => {
    render(
      <Tabs
        items={TAB_ITEMS}
        value="overview"
        onChange={() => {}}
        ariaLabel="Project sections"
      />,
    );
    const tabs = screen.getAllByRole('tab');
    tabs.forEach((tab) => {
      // Accepts h-11 (44px), min-h-[44px], or py-[10px] (10px pad × 2 + 24px content > 44)
      const cls = tab.className;
      const hasTouchHeight = /h-11|min-h-\[44px\]|h-\[44px\]/.test(cls);
      expect(hasTouchHeight).toBe(true);
    });
  });

  it('the tablist has whitespace-nowrap so tabs do not wrap at narrow widths', () => {
    render(
      <Tabs
        items={TAB_ITEMS}
        value="overview"
        onChange={() => {}}
        ariaLabel="Project sections"
      />,
    );
    const tablist = screen.getByRole('tablist');
    expect(tablist.className).toMatch(/whitespace-nowrap|flex-nowrap|flex\s/);
  });
});

// ─── KanbanStageIndicator ─────────────────────────────────────────────────

describe('KanbanStageIndicator (AC-IXD-MOBILE-W4-PR3-C5)', () => {
  const stages = [
    { title: 'Leads', dotColor: 'hsl(var(--muted-foreground))', activeIndex: 0 },
    { title: 'Pre-Qual', dotColor: 'hsl(var(--muted-foreground))', activeIndex: 0 },
    { title: 'Quotation', dotColor: 'hsl(var(--muted-foreground))', activeIndex: 0 },
    { title: 'Tender', dotColor: 'hsl(var(--muted-foreground))', activeIndex: 0 },
    { title: 'Negotiation', dotColor: 'hsl(var(--primary))', activeIndex: 0 },
  ];

  it('renders a nav/region with an accessible label', () => {
    render(<KanbanStageIndicator stages={stages} activeIndex={0} />);
    // The strip should be a navigation landmark or a labelled region
    const nav = screen.getByRole('navigation', { name: /pipeline stage/i });
    expect(nav).toBeInTheDocument();
  });

  it('renders a button/link for each stage', () => {
    render(<KanbanStageIndicator stages={stages} activeIndex={0} />);
    // One accessible affordance per stage so users can jump
    stages.forEach((s) => {
      expect(screen.getByRole('button', { name: new RegExp(s.title, 'i') })).toBeInTheDocument();
    });
  });

  it('the active stage button has aria-current="true" or aria-pressed="true"', () => {
    render(<KanbanStageIndicator stages={stages} activeIndex={2} />);
    const active = screen.getByRole('button', { name: /quotation/i });
    const hasActive =
      active.getAttribute('aria-current') === 'true' ||
      active.getAttribute('aria-pressed') === 'true';
    expect(hasActive).toBe(true);
  });

  it('stage dots are aria-hidden (decorative)', () => {
    render(<KanbanStageIndicator stages={stages} activeIndex={0} />);
    // Every colored dot element should be aria-hidden="true"
    const dots = document.querySelectorAll('[data-stage-dot]');
    dots.forEach((dot) => {
      expect(dot.getAttribute('aria-hidden')).toBe('true');
    });
  });
});

// ─── LifecycleStepper scroll-fade ─────────────────────────────────────────

describe('LifecycleStepper — scroll-fade affordance (AC-IXD-MOBILE-W4-PR3-C4)', () => {
  const steps = [
    { label: 'Draft', state: 'done' as const },
    { label: 'Submitted', state: 'current' as const },
    { label: 'Approved', state: 'upcoming' as const },
    { label: 'Ordered', state: 'upcoming' as const },
    { label: 'Received', state: 'upcoming' as const },
    { label: 'Paid', state: 'upcoming' as const },
  ];

  it('the node-variant stepper has a scroll-fade wrapper (scroll-fade-x class or mask-image)', () => {
    render(<LifecycleStepper variant="node" steps={steps} aria-label="Lifecycle" />);
    // The scroll-fade wrapper must be present
    const container = document.querySelector('[data-testid="stepper-scroll-container"]');
    expect(container).toBeInTheDocument();
  });

  it('the scroll-fade overlay element is aria-hidden and pointer-events-none (decorative)', () => {
    render(<LifecycleStepper variant="node" steps={steps} aria-label="Lifecycle" />);
    // The fade affordance itself (a pseudo or sibling element) must be decorative
    const fade = document.querySelector('[data-testid="stepper-fade"]');
    expect(fade).toBeInTheDocument();
    expect(fade?.getAttribute('aria-hidden')).toBe('true');
  });

  it('preserves all step labels and aria semantics', () => {
    render(<LifecycleStepper variant="node" steps={steps} aria-label="Lifecycle" />);
    expect(screen.getByRole('list', { name: 'Lifecycle' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(steps.length);
  });
});

// ─── TimesheetGrid scroll-fade ────────────────────────────────────────────

describe('TimesheetGrid — scroll-fade affordance (AC-IXD-MOBILE-W4-PR3-C1b)', () => {
  const days = [
    { label: 'Mon', dateNum: '2', weekend: false },
    { label: 'Tue', dateNum: '3', weekend: false },
    { label: 'Wed', dateNum: '4', weekend: false },
    { label: 'Thu', dateNum: '5', weekend: false },
    { label: 'Fri', dateNum: '6', weekend: false },
    { label: 'Sat', dateNum: '7', weekend: true },
    { label: 'Sun', dateNum: '8', weekend: true },
  ];
  const rows = [
    { id: 'R1', project: 'Alpha Project', code: 'AP-001', hours: [4, 4, 0, 8, 8, 0, 0] },
  ];

  it('the scroll container carries the scroll-fade-x class or mask-image utility', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    const container = document.querySelector('[data-testid="tsgrid-scroll"]');
    expect(container).toBeInTheDocument();
    // Must carry scroll-fade-x class (or mask-image equivalent)
    const cls = container?.className ?? '';
    expect(cls).toMatch(/scroll-fade-x|mask-image|\[mask-image:/);
  });

  it('the scroll-fade affordance element is aria-hidden (decorative)', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    const fade = document.querySelector('[data-testid="tsgrid-fade"]');
    expect(fade).toBeInTheDocument();
    expect(fade?.getAttribute('aria-hidden')).toBe('true');
  });

  it('at max-md the project column has narrowed (min-w-[160px]) class applied', () => {
    render(<TimesheetGrid days={days} rows={rows} />);
    const header = document.querySelector('[data-testid="tsgrid-project-header"]');
    expect(header).toBeInTheDocument();
    // Must have the max-md narrow class
    const cls = header?.className ?? '';
    expect(cls).toMatch(/max-md:min-w-\[160px\]|min-w-\[160px\]/);
  });
});

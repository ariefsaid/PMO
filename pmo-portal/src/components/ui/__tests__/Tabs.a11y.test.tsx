import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { Tabs, type TabItem } from '../Tabs';
import { tabId, tabPanelId } from '../tabIds';

describe('Tabs a11y wiring (G4)', () => {
  const items = [
    { value: 'overview', label: 'Overview' },
    { value: 'budget', label: 'Budget' },
  ] as const;

  it('reveals an offscreen active tab by scrolling the strip without scrolling the page', () => {
    const { rerender } = render(<Tabs items={[...items]} value="overview" onChange={() => {}} ariaLabel="Sections" idBase="proj" />);
    const list = screen.getByRole('tablist', { name: 'Sections' });
    const budget = screen.getByRole('tab', { name: 'Budget' });
    const scrollBy = vi.fn();
    Object.defineProperty(list, 'scrollBy', { value: scrollBy });
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 200 } as DOMRect);
    vi.spyOn(budget, 'getBoundingClientRect').mockReturnValue({ left: 180, right: 250 } as DOMRect);
    const scrollIntoView = vi.spyOn(budget, 'scrollIntoView');
    rerender(<Tabs items={[...items]} value="budget" onChange={() => {}} ariaLabel="Sections" idBase="proj" />);
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 50 }));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('AC-W6-G4: each tab has id + aria-controls resolving to its panel id', () => {
    render(
      <>
        <Tabs items={[...items]} value="budget" onChange={() => {}} ariaLabel="Sections" idBase="proj" />
        <div role="tabpanel" id={tabPanelId('proj', 'budget')} aria-labelledby={tabId('proj', 'budget')}>
          panel
        </div>
      </>,
    );
    const budgetTab = screen.getByRole('tab', { name: 'Budget' });
    // id helper is deterministic and matches what the component renders
    expect(budgetTab).toHaveAttribute('id', tabId('proj', 'budget'));
    expect(budgetTab).toHaveAttribute('aria-controls', tabPanelId('proj', 'budget'));

    // The panel back-references the active tab
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', tabPanelId('proj', 'budget'));
    expect(panel).toHaveAttribute('aria-labelledby', tabId('proj', 'budget'));
  });

  it('renders an optional count badge as text in the tab accessible name (DESIGN.md §5 Count badge)', () => {
    render(
      <Tabs
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'documents', label: 'Documents', count: 7 },
        ]}
        value="overview"
        onChange={() => {}}
        ariaLabel="Sections"
        idBase="proc"
      />,
    );
    // The count is part of the accessible name (read by SRs / color-blind users), not color-only.
    expect(screen.getByRole('tab', { name: /Documents\s*7/ })).toBeInTheDocument();
    // A tab with no count has no trailing badge text.
    expect(screen.getByRole('tab', { name: 'Overview' })).toBeInTheDocument();
  });

  it('renders inline project counts as muted numbers instead of badges', () => {
    const items: Array<TabItem<'documents'> & { countPresentation: 'inline' }> = [
      { value: 'documents', label: 'Documents', count: 7, countPresentation: 'inline' },
    ];
    render(
      <Tabs
        items={items}
        value="documents"
        onChange={() => {}}
        ariaLabel="Project sections"
        idBase="project-detail"
      />,
    );
    const tab = screen.getByRole('tab', { name: 'Documents 7' });
    const count = within(tab).getByText('7');
    expect(count).toHaveClass('text-muted-foreground');
    expect(count).not.toHaveClass('bg-status-neutral-surface');
  });

  it('omits the count badge when count is null/undefined (back-compat with ProjectDetail)', () => {
    render(
      <Tabs
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'items', label: 'Line items', count: null },
        ]}
        value="overview"
        onChange={() => {}}
        ariaLabel="Sections"
        idBase="proc"
      />,
    );
    expect(screen.getByRole('tab', { name: 'Line items' })).toBeInTheDocument();
  });

  it('AC-W6-G4: id helpers are stable + collision-safe across values', () => {
    expect(tabId('proj', 'overview')).not.toBe(tabId('proj', 'budget'));
    expect(tabPanelId('proj', 'overview')).not.toBe(tabId('proj', 'overview'));
  });

  it('AC-W6-G4: inactive tab has NO aria-controls (dangling-ref fix)', () => {
    // value="budget" → overview is inactive, budget is active
    render(
      <>
        <Tabs items={[...items]} value="budget" onChange={() => {}} ariaLabel="Sections" idBase="proj" />
        <div role="tabpanel" id={tabPanelId('proj', 'budget')} aria-labelledby={tabId('proj', 'budget')}>
          panel
        </div>
      </>,
    );
    const overviewTab = screen.getByRole('tab', { name: 'Overview' });
    // Inactive tab must NOT reference a panel id that isn't in the DOM
    expect(overviewTab).not.toHaveAttribute('aria-controls');
  });

  it('AC-W6-G4: real-composition — active tab aria-controls matches panel id, panel aria-labelledby matches tab id', () => {
    // Mimics the ProjectDetail composition: idBase="project-detail", 5 tabs, tasks active
    const projectDetailItems = [
      { value: 'overview', label: 'Overview' },
      { value: 'tasks', label: 'Tasks' },
      { value: 'budget', label: 'Budget' },
      { value: 'procurement', label: 'Procurement' },
      { value: 'documents', label: 'Documents' },
    ] as const;

    render(
      <>
        <Tabs
          items={[...projectDetailItems]}
          value="tasks"
          onChange={() => {}}
          ariaLabel="Project sections"
          idBase="project-detail"
        />
        <div
          role="tabpanel"
          id={tabPanelId('project-detail', 'tasks')}
          aria-labelledby={tabId('project-detail', 'tasks')}
        >
          Tasks content
        </div>
      </>,
    );

    // Active tab: aria-controls resolves to the rendered panel
    const tasksTab = screen.getByRole('tab', { name: 'Tasks' });
    expect(tasksTab).toHaveAttribute('aria-selected', 'true');
    const resolvedPanelId = tasksTab.getAttribute('aria-controls');
    expect(resolvedPanelId).toBe(tabPanelId('project-detail', 'tasks'));

    // Panel exists in DOM with that id
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', resolvedPanelId!);

    // Panel's aria-labelledby resolves to the active tab's id
    const labelledById = panel.getAttribute('aria-labelledby');
    expect(labelledById).toBe(tabId('project-detail', 'tasks'));
    const labelElement = document.getElementById(labelledById!);
    expect(labelElement).not.toBeNull();
    expect(labelElement).toHaveAttribute('aria-selected', 'true');

    // All inactive tabs have no aria-controls
    const inactiveTabs = ['overview', 'budget', 'procurement', 'documents'];
    for (const value of inactiveTabs) {
      const tab = screen.getByRole('tab', { name: new RegExp(value, 'i') });
      expect(tab).not.toHaveAttribute('aria-controls');
    }
  });
});

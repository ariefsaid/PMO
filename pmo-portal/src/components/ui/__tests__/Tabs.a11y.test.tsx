import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Tabs } from '../Tabs';
import { tabId, tabPanelId } from '../tabIds';

describe('Tabs a11y wiring (G4)', () => {
  const items = [
    { value: 'overview', label: 'Overview' },
    { value: 'budget', label: 'Budget' },
  ] as const;

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

  it('AC-W6-G4: id helpers are stable + collision-safe across values', () => {
    expect(tabId('proj', 'overview')).not.toBe(tabId('proj', 'budget'));
    expect(tabPanelId('proj', 'overview')).not.toBe(tabId('proj', 'overview'));
  });
});

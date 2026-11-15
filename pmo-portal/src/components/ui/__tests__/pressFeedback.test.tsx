import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Funnel } from '../Funnel';
import { KPITile, KPIRow } from '../KPITile';
import { KanbanCard } from '../Kanban';

/** #2130: pressable surfaces dip to 0.98 on press, and stay still under reduced motion. */
const pressOk = (el: HTMLElement) => {
  expect(el.className).toContain('active:scale-[0.98]');
  expect(el.className).toContain('motion-reduce:active:scale-100');
  expect(el.className).not.toContain('0.992');
};

describe('press feedback (#2130)', () => {
  it('an interactive funnel stage presses; a static one does not', () => {
    const stages = [{ name: 'Lead', value: '3' }, { name: 'Won', value: '1' }];
    const { rerender } = render(<Funnel stages={stages} onSelect={vi.fn()} />);
    pressOk(screen.getAllByRole('button')[0]);
    rerender(<Funnel stages={stages} />);
    expect(document.querySelector('[class*="active:scale"]')).toBeNull();
  });

  it('a drillable KPI tile presses (both layouts); a plain tile does not', () => {
    const { rerender } = render(
      <MemoryRouter><KPITile icon="dollar" tone="blue" label="At risk" value="3" testId="k" to="/projects" linkLabel="Open" /></MemoryRouter>,
    );
    pressOk(screen.getByTestId('k'));
    rerender(
      <MemoryRouter><KPIRow aria-label="Row"><KPITile icon="dollar" tone="blue" label="At risk" value="3" testId="k" to="/projects" linkLabel="Open" /></KPIRow></MemoryRouter>,
    );
    pressOk(screen.getByTestId('k'));
    rerender(<MemoryRouter><KPITile icon="dollar" tone="blue" label="Plain" value="3" testId="k" /></MemoryRouter>);
    expect(screen.getByTestId('k').className).not.toContain('active:scale');
  });

  it('a kanban card presses in the perceptible range', () => {
    render(<KanbanCard onActivate={vi.fn()}>Alpha</KanbanCard>);
    pressOk(screen.getByRole('button', { name: /alpha/i }));
  });
});

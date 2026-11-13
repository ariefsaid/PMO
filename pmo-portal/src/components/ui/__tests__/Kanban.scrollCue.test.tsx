import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { Kanban, KanbanColumn } from '../Kanban';

const size = (el: HTMLElement, v: { scrollWidth: number; clientWidth: number; scrollLeft: number }) =>
  Object.entries(v).forEach(([k, n]) => Object.defineProperty(el, k, { configurable: true, value: n }));

describe('AC-DND-018: kanban scroll cue', () => {
  it('shows the cue only while columns run off the right edge', () => {
    const { container } = render(<Kanban><div /></Kanban>);
    const scroller = container.querySelector('.kanban-scroll') as HTMLElement;
    size(scroller, { scrollWidth: 1200, clientWidth: 600, scrollLeft: 0 });
    fireEvent.scroll(scroller);
    expect(scroller).toHaveAttribute('data-more-right', 'true');
    size(scroller, { scrollWidth: 1200, clientWidth: 600, scrollLeft: 600 });
    fireEvent.scroll(scroller);
    expect(scroller).not.toHaveAttribute('data-more-right');
  });

  it('no cue when everything fits', () => {
    const { container } = render(<Kanban><div /></Kanban>);
    const scroller = container.querySelector('.kanban-scroll') as HTMLElement;
    size(scroller, { scrollWidth: 600, clientWidth: 600, scrollLeft: 0 });
    fireEvent.scroll(scroller);
    expect(scroller).not.toHaveAttribute('data-more-right');
  });

  it('exposes the opt-in flag for boards that fit their columns to the viewport', () => {
    const { container } = render(<Kanban fitColumns aria-label="Sales pipeline board"><div>Leads</div></Kanban>);

    expect(container.querySelector('[data-fit-columns="true"]')).toBeInTheDocument();
  });

  it('marks an empty column so the board can narrow it, and not a filled one', () => {
    const { container } = render(<><KanbanColumn title="A" count={0} /><KanbanColumn title="B" count={1}><p>x</p></KanbanColumn></>);
    expect(container.querySelectorAll('[data-empty-column]')).toHaveLength(1);
  });
});

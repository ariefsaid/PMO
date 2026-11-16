import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SelectedInView } from './SelectedInView';

const rect = (left: number, width: number) => ({ left, width, right: left + width, top: 0, bottom: 0, height: 0, x: left, y: 0, toJSON: () => ({}) });

/** Phone: choosing a status segment scrolls the segment so the chosen one is visible, never off the right edge. */
describe('SelectedInView', () => {
  it('scrolls a selected segment that sits beyond the visible width into view', () => {
    const { rerender } = render(<SelectedInView value="All" className=""><button role="tab" aria-selected="false">At risk</button></SelectedInView>);
    const scroller = screen.getByTestId('status-filter-scroll');
    const tab = screen.getByRole('tab');
    Object.defineProperty(scroller, 'clientWidth', { value: 200 });
    scroller.getBoundingClientRect = () => rect(0, 200) as DOMRect;
    tab.getBoundingClientRect = () => rect(320, 80) as DOMRect;
    tab.setAttribute('aria-selected', 'true');
    rerender(<SelectedInView value="at-risk" className=""><button role="tab" aria-selected="true">At risk</button></SelectedInView>);
    expect(scroller.scrollLeft).toBeGreaterThan(0);
  });
});

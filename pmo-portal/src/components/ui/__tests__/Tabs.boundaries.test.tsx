import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs } from '../Tabs';

const items = ['Alpha', 'Beta', 'Gamma', 'Delta'].map((label) => ({ value: label, label }));
const starts = [0, 120, 270, 400];
afterEach(() => vi.restoreAllMocks());

function renderOverflow() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('role') === 'tablist' ? 200 : 0; });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.getAttribute('role') === 'tablist' ? 600 : 0; });
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.getAttribute('role') === 'tab') {
      const left = starts[items.findIndex((item) => item.label === this.textContent)] - (this.closest('[role="tablist"]')?.scrollLeft ?? 0);
      return { left, right: left + 100 } as DOMRect;
    }
    return { left: 0, right: 200 } as DOMRect;
  });
  render(<Tabs items={items} value="Alpha" onChange={() => {}} ariaLabel="Sections" idBase="boundaries" />);
  const list = screen.getByRole('tablist');
  const scrollBy = vi.fn();
  Object.defineProperty(list, 'scrollBy', { configurable: true, value: scrollBy });
  return { list, scrollBy };
}

it('moves the next-arrow scroll to a tab boundary rather than through a label', async () => {
  const { scrollBy } = renderOverflow();
  await userEvent.click(screen.getByRole('button', { name: 'Scroll tabs right' }));
  expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 120 }));
});

it('moves the previous-arrow scroll back to the nearest tab boundary', async () => {
  const { list, scrollBy } = renderOverflow();
  list.scrollLeft = 130;
  fireEvent.scroll(list);
  await userEvent.click(screen.getByRole('button', { name: 'Scroll tabs left' }));
  expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: -10 }));
});

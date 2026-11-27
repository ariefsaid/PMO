import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { act, render, screen } from '@testing-library/react';
import { Tabs } from '../Tabs';

const items = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
];

describe('Tabs first-tab left edge', () => {
  it('a list-page tab row starts its first label on the page edge', () => {
    render(<Tabs items={items} value="a" onChange={() => {}} ariaLabel="Views" idBase="t1" />);
    expect(screen.getByRole('tab', { name: 'Alpha' }).className).toContain('first:ps-0');
  });

  it('a record-page tab row starts its first label on the record header inset', () => {
    render(<Tabs items={items} value="a" onChange={() => {}} ariaLabel="Views" idBase="t2" insetFirstTab />);
    const cls = screen.getByRole('tab', { name: 'Alpha' }).className;
    expect(cls).toContain('first:ps-[calc(var(--space-content-inset)+1px)]');
    expect(cls).not.toContain('first:ps-0');
  });

  it('a record page whose header is a panel starts its first label on the panel inset', () => {
    render(<Tabs items={items} value="a" onChange={() => {}} ariaLabel="Views" idBase="t3" insetFirstTab="panel" />);
    const cls = screen.getByRole('tab', { name: 'Alpha' }).className;
    expect(cls).toContain('first:ps-[calc(var(--panel-inset)+1px)]');
    expect(cls).not.toContain('first:ps-0');
  });

  it('brings the last tab into view when the user reaches it by keyboard', async () => {
    const scrollBy = vi.fn();
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { left: 0, right: this.getAttribute('role') === 'tab' ? 480 : 390 } as DOMRect;
    });
    const previous = HTMLElement.prototype.scrollBy;
    HTMLElement.prototype.scrollBy = scrollBy;
    function Harness() {
      const [value, setValue] = useState('a');
      return <Tabs items={[...items, { value: 'rate', label: 'Attendance rate' }]} value={value} onChange={setValue} ariaLabel="Views" idBase="reach" />;
    }
    try {
      render(<Harness />);
      screen.getByRole('tab', { name: 'Alpha' }).focus();
      await userEvent.keyboard('{End}');
      expect(screen.getByRole('tab', { name: 'Attendance rate' })).toHaveAttribute('aria-selected', 'true');
      expect(scrollBy).toHaveBeenCalledWith({ left: 90, behavior: expect.any(String) });
    } finally {
      rect.mockRestore();
      HTMLElement.prototype.scrollBy = previous;
    }
  });

  it('reveals the selected tab even when a caller requests the legacy first-tab position', async () => {
    const scrollBy = vi.fn();
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return { left: 0, right: this.getAttribute('role') === 'tab' ? 480 : 390 } as DOMRect;
    });
    const previous = HTMLElement.prototype.scrollBy;
    HTMLElement.prototype.scrollBy = scrollBy;
    function Harness() {
      const [value, setValue] = useState('b');
      return <Tabs items={items} value={value} onChange={setValue} ariaLabel="Views" idBase="start" startAtFirst />;
    }
    try {
      render(<Harness />);
      expect(scrollBy).toHaveBeenCalled();
      const initialCalls = scrollBy.mock.calls.length;
      await userEvent.click(screen.getByRole('tab', { name: 'Alpha' }));
      expect(scrollBy.mock.calls.length).toBeGreaterThan(initialCalls);
    } finally {
      rect.mockRestore();
      HTMLElement.prototype.scrollBy = previous;
    }
  });
});

it('keeps the selected tab entirely inside the scrolling track after a resize', () => {
  const resized: Array<() => void> = [];
  let trackRight = 400;
  const scrollBy = vi.fn();
  const previousScroll = HTMLElement.prototype.scrollBy;
  const previousObserver = globalThis.ResizeObserver;
  globalThis.ResizeObserver = class { callback: () => void; constructor(callback: () => void) { this.callback = callback; } observe(target: Element) { if (target.getAttribute('role') === 'tablist') resized.push(this.callback); } disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;
  HTMLElement.prototype.scrollBy = scrollBy;
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { left: this.getAttribute('role') === 'tab' ? 200 : 0, right: this.getAttribute('role') === 'tab' ? 340 : trackRight } as DOMRect;
  });
  try {
    render(<Tabs items={items} value="b" onChange={() => {}} ariaLabel="Resize views" idBase="resize" />);
    scrollBy.mockClear();
    trackRight = 310;
    Object.defineProperty(screen.getByRole('tablist'), 'clientWidth', { configurable: true, value: 310 });
    act(() => [...resized].forEach((callback) => callback()));
    expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 30 }));
  } finally {
    rect.mockRestore();
    HTMLElement.prototype.scrollBy = previousScroll;
    globalThis.ResizeObserver = previousObserver;
  }
});

it('speed: fitting first tab mount skips active-tab geometry work', () => {
  const width = vi.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(390);
  const scrollWidth = vi.spyOn(Element.prototype, 'scrollWidth', 'get').mockReturnValue(390);
  const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
  try {
    render(<Tabs items={items} value="a" onChange={() => {}} ariaLabel="Fast views" idBase="fast" />);
    expect(rect).not.toHaveBeenCalled();
  } finally { width.mockRestore(); scrollWidth.mockRestore(); rect.mockRestore(); }
});

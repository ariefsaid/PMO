import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
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
      expect(scrollBy).toHaveBeenCalledWith({ left: 118, behavior: expect.any(String) });
    } finally {
      rect.mockRestore();
      HTMLElement.prototype.scrollBy = previous;
    }
  });

  it('keeps the first tab visible on arrival and follows a later user selection', async () => {
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
      expect(scrollBy).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole('tab', { name: 'Alpha' }));
      expect(scrollBy).toHaveBeenCalled();
    } finally {
      rect.mockRestore();
      HTMLElement.prototype.scrollBy = previous;
    }
  });
});

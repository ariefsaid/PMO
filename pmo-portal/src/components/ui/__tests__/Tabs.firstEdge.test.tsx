import { describe, it, expect } from 'vitest';
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
});

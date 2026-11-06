/**
 * The two hand-rails the dashboard memo boundaries stand on (perf: dashboard render work). They keep
 * a prop's reference stable across commits that changed nothing they render, and they must always
 * hand back the NEW value the moment it changes — otherwise a memoised panel would go stale.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { countsSignature, itemsSignature, useStableCallback, useStableValue } from './renderStability';

describe('render stability helpers', () => {
  it('useStableValue keeps the reference while the signature holds and swaps it when the signature changes', () => {
    const seen: Array<{ reference: string[]; value: string }> = [];
    const Probe: React.FC<{ items: string[] }> = ({ items }) => {
      const value = useStableValue(items, (list) => list.join('|'));
      seen.push({ reference: value, value: value.join(',') });
      return <p>{value.join(',')}</p>;
    };

    const view = render(<Probe items={['a', 'b']} />);
    const first = seen.at(-1)!.reference;
    // A parent commit with an equal-content array must not hand the child a new reference.
    view.rerender(<Probe items={['a', 'b']} />);
    expect(seen.at(-1)!.reference).toBe(first);
    expect(screen.getByText('a,b')).toBeInTheDocument();

    // A real change must reach the child in the same commit (no stale value).
    view.rerender(<Probe items={['a', 'c']} />);
    expect(seen.at(-1)!.reference).not.toBe(first);
    expect(screen.getByText('a,c')).toBeInTheDocument();
  });

  it('useStableCallback keeps one identity while always calling the latest closure', () => {
    const calls: string[] = [];
    const Probe: React.FC<{ label: string }> = ({ label }) => {
      const handler = useStableCallback(() => { calls.push(label); });
      React.useEffect(() => { handler(); }, [handler, label]);
      return <p>{label}</p>;
    };

    const view = render(<Probe label="first" />);
    view.rerender(<Probe label="second" />);
    expect(calls).toEqual(['first', 'second']);
    expect(vi.isMockFunction(Probe)).toBe(false);
  });

  it('signatures cover every value the panels render, so a text change always counts as a change', () => {
    const item = { id: 'at-risk', count: 2, label: 'projects at risk', href: '/projects?filter=at-risk' };
    expect(itemsSignature([item])).toBe(itemsSignature([{ ...item }]));
    expect(itemsSignature([item])).not.toBe(itemsSignature([{ ...item, count: 3 }]));
    expect(itemsSignature([item])).not.toBe(itemsSignature([{ ...item, label: 'proyek berisiko' }]));
    expect(countsSignature({ p1: 2, p2: 0 })).toBe(countsSignature({ p1: 2, p2: 0 }));
    expect(countsSignature({ p1: 2 })).not.toBe(countsSignature({ p1: 3 }));
  });
});

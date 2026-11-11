import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LateText } from '../LateText';
import { isMostUrgentLateRow } from '../lateTextRows';

describe('LateText', () => {
  it('keeps lateness in foreground text until the caller marks the urgent row', () => {
    const { rerender } = render(<LateText>263 days late</LateText>);
    expect(screen.getByText('263 days late')).toHaveClass('text-control', 'font-normal', 'text-foreground');
    expect(screen.getByText('263 days late')).not.toHaveClass('text-destructive-text');

    rerender(<LateText emphasis>263 days late</LateText>);
    expect(screen.getByText('263 days late')).toHaveClass('font-semibold', 'text-destructive-text');
  });

  it('marks only the first row in a sorted late list for emphasis', () => {
    const rows = [{ id: 'oldest' }, { id: 'next' }, { id: 'newest' }];
    expect(rows.map((row) => isMostUrgentLateRow(rows, row))).toEqual([true, false, false]);
    expect(isMostUrgentLateRow([], rows[0]!)).toBe(false);
  });
});

/**
 * C2 — Funnel segments expose selected state non-visually via aria-pressed.
 * AC: the selected segment has aria-pressed="true"; all others have aria-pressed="false".
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { Funnel } from '../Funnel';
import type { FunnelStage } from '../Funnel';

const stages: FunnelStage[] = [
  { name: 'Lead', value: '3' },
  { name: 'Proposal', value: '2' },
  { name: 'Won', value: '1' },
];

describe('Funnel — aria-pressed (C2)', () => {
  it('selected segment has aria-pressed="true", others have aria-pressed="false"', () => {
    render(
      <Funnel
        stages={stages}
        selectedIndex={1}
        onSelect={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);

    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'false');
  });

  it('when selectedIndex=0, first segment is pressed', () => {
    render(
      <Funnel
        stages={stages}
        selectedIndex={0}
        onSelect={vi.fn()}
      />,
    );

    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[1]).toHaveAttribute('aria-pressed', 'false');
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'false');
  });

  it('non-interactive Funnel (no onSelect) has no aria-pressed', () => {
    render(<Funnel stages={stages} />);

    // No button role when not interactive
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

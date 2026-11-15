import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React, { useState } from 'react';
import { PanelList } from './PanelList';
import type { PanelSpec } from '@/src/lib/viewspec/types';

const mk = (id: string): PanelSpec =>
  ({ id, primitive: 'table', querySpec: { entity: 'projects', select: ['name'] } }) as unknown as PanelSpec;

function Harness() {
  const [panels, setPanels] = useState([mk('a'), mk('b'), mk('c')]);
  const move = (i: number, d: number) =>
    setPanels((p) => {
      const n = [...p];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  return <PanelList panels={panels} onEdit={vi.fn()} onRemove={vi.fn()} onMoveUp={(i) => move(i, -1)} onMoveDown={(i) => move(i, 1)} />;
}

describe('#2084 PanelList keeps focus when a move button reaches the list end', () => {
  it('moving the last-but-one panel down leaves focus on an enabled button of that panel', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const down = screen.getByRole('button', { name: /move panel 2 down/i });
    down.focus();
    await user.keyboard('{Enter}');
    // The panel is now third; its "down" is disabled, so focus must have moved to its "up".
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toHaveAccessibleName(/move panel 3 up/i);
  });
  it('moving the second panel up to the top lands focus on its down button', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole('button', { name: /move panel 2 up/i }).focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toHaveAccessibleName(/move panel 1 down/i);
  });
});

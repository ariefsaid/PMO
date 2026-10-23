/** MenuButton — the row-menu primitive with a visible text trigger (one labelled action per row). */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MenuButton } from '../index';

describe('MenuButton', () => {
  it('opens a menu from a labelled trigger and runs the chosen item; a disabled item does nothing', async () => {
    const link = vi.fn();
    const blocked = vi.fn();
    render(<MenuButton label="Link…" ariaLabel="Link PINV-1" items={[
      { label: 'Link to purchase', onClick: link },
      { label: 'New purchase needs a single project', onClick: blocked, disabled: true },
    ]} />);
    const trigger = screen.getByRole('button', { name: 'Link PINV-1' });
    expect(trigger).toHaveTextContent('Link…');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('menuitem', { name: 'New purchase needs a single project' }));
    expect(blocked).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Link to purchase' }));
    expect(link).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

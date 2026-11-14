import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ContextBar } from '../ContextBar';

vi.mock('../NotificationBell', () => ({ NotificationBell: () => null }));
vi.mock('../AccountMenu', () => ({ AccountMenu: () => null }));

describe('ContextBar tablet navigation', () => {
  it('opens the same More drawer with an accessible 44px target', async () => {
    const onOpenMore = vi.fn();
    render(
      <MemoryRouter>
        <ContextBar
          breadcrumb={[{ label: 'Dashboard' }]}
          onOpenPalette={vi.fn()}
          onOpenMore={onOpenMore}
          moreOpen
        />
      </MemoryRouter>,
    );

    const more = screen.getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('data-drawer-toggle');
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(more.className).toContain('tablet-nav-more');
    expect(more.className).toContain('min-h-11');
    expect(more.className).toContain('min-w-11');

    await userEvent.click(more);
    expect(onOpenMore).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter } from 'react-router';
import { Menu } from '../menu';

describe('shared Menu wrapper', () => {
  it('closes after selecting a link and releases the inert app layer', async () => {
    const { container: root } = render(
      <MemoryRouter initialEntries={['/']}>
        <Menu.Root>
          <Menu.Trigger>Open account menu</Menu.Trigger>
          <Menu.Portal>
            <Menu.Positioner>
              <Menu.Popup>
                <Menu.LinkItem render={<Link to="/settings/profile" />}>
                  Profile &amp; preferences
                </Menu.LinkItem>
              </Menu.Popup>
            </Menu.Positioner>
          </Menu.Portal>
        </Menu.Root>
      </MemoryRouter>,
    );
    root.id = 'root';

    await userEvent.click(screen.getByRole('button', { name: 'Open account menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Profile & preferences' }));

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(root).not.toHaveAttribute('data-base-ui-inert');
  });
});

/** AC-LA-010 (#2710) — a light account lands on /my from any route; no navigation is rendered. */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';

vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ signOut: vi.fn() }) }));
vi.mock('@/pages/MyHome', () => ({ default: () => <h1>home-screen</h1> }));
vi.mock('@/pages/ProfileSettings', () => ({ default: () => <h1>profile-screen</h1> }));
import { LightShell } from './LightShell';

const Where: React.FC = () => <span data-testid="where">{useLocation().pathname}</span>;

describe('AC-LA-010 light shell', () => {
  it.each(['/', '/projects', '/projects/abc/tasks', '/work-orders/x', '/administration/users'])('redirects %s to /my', async (path) => {
    render(<MemoryRouter initialEntries={[path]}><LightShell /><Where /></MemoryRouter>);
    expect(await screen.findByText('home-screen')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/my');
  });
  it('renders no navigation landmark', async () => {
    render(<MemoryRouter initialEntries={['/my']}><LightShell /></MemoryRouter>);
    await screen.findByText('home-screen');
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });

  it('JOB-NAV-LIGHT-SETTINGS: a light account reaches its own settings (profile, language, text size) and back, and nothing else', async () => {
    render(<MemoryRouter initialEntries={['/my']}><LightShell /><Where /></MemoryRouter>);
    await screen.findByText('home-screen');
    await userEvent.click(screen.getByRole('link', { name: 'Settings' }));
    expect(await screen.findByText('profile-screen')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/settings/profile');
    await userEvent.click(screen.getByRole('link', { name: 'My work' }));
    expect(await screen.findByText('home-screen')).toBeInTheDocument();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';

const requestPasswordReset = vi.hoisted(() => vi.fn());
vi.mock('./useAuth', () => ({ useAuth: () => ({ requestPasswordReset }) }));

import ResetPasswordPage from './ResetPasswordPage';

describe('ResetPasswordPage floor', () => {
  it('floor: Back to sign in goes to /login', () => {
    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login');
  });

  it('keeps the reset page inside one main with one h1', () => {
    render(
      <MemoryRouter>
        <ResetPasswordPage />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('PMO Portal')).toBeInTheDocument();
  });
});

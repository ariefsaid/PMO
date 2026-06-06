import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { AppShell } from '../AppShell';

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe('AppShell', () => {
  it('renders the grid areas (rail/header/tabstrip/main slots)', () => {
    wrap(
      <AppShell
        rail={<div data-testid="rail-slot" />}
        header={<div data-testid="header-slot" />}
        tabstrip={<div data-testid="tabstrip-slot" />}
      >
        <div>page content</div>
      </AppShell>
    );
    expect(screen.getByTestId('rail-slot')).toBeInTheDocument();
    expect(screen.getByTestId('header-slot')).toBeInTheDocument();
    expect(screen.getByTestId('tabstrip-slot')).toBeInTheDocument();
    expect(screen.getByText('page content')).toBeInTheDocument();
  });

  it('main is a programmatically-focusable landmark with id=main', () => {
    wrap(
      <AppShell rail={null} header={null} tabstrip={null}>
        <div>x</div>
      </AppShell>
    );
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('renders a skip-to-main link', () => {
    wrap(
      <AppShell rail={null} header={null} tabstrip={null}>
        <div>x</div>
      </AppShell>
    );
    const skip = screen.getByRole('link', { name: /skip to main content/i });
    expect(skip).toHaveAttribute('href', '#main');
  });
});

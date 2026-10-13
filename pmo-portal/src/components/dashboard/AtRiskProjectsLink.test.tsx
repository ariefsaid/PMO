import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AtRiskProjectsLink } from './AtRiskProjectsLink';

describe('AtRiskProjectsLink', () => {
  const renderLink = (count: number) => render(
    <MemoryRouter><AtRiskProjectsLink count={count} /></MemoryRouter>,
  );

  it('shows no exception action for a true zero', () => {
    renderLink(0);
    expect(screen.queryByTestId('dashboard-at-risk-link')).not.toBeInTheDocument();
  });

  it('gives a single risk a singular, risk-specific destination', () => {
    renderLink(1);
    const link = screen.getByRole('link', { name: 'Review 1 at-risk project' });
    expect(link).toHaveAttribute('href', '/projects?filter=at-risk');
  });

  it('keeps a multi-risk count on the same canonical filtered destination', () => {
    renderLink(3);
    const link = screen.getByRole('link', { name: 'Review 3 at-risk projects' });
    expect(link).toHaveAttribute('href', '/projects?filter=at-risk');
  });
});

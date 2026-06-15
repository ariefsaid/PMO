/**
 * AC-JR-W3B-01: CompanyNameLink — shared link component for company names.
 * Mirrors ProjectNameLink's 3-branch contract (link / inert span / em-dash).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CompanyNameLink } from '../CompanyNameLink';

const wrap = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe('AC-JR-W3B-01: CompanyNameLink', () => {
  it('AC-JR-W3B-01: links to /companies/:id when id present', () => {
    wrap(<CompanyNameLink companyId="c1" name="Acme Corp" />);
    const link = screen.getByRole('link', { name: 'Open Acme Corp' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/companies/c1');
  });

  it('AC-JR-W3B-01: renders inert text when companyId is null', () => {
    wrap(<CompanyNameLink companyId={null} name="Acme Corp" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Acme Corp')).toBeInTheDocument();
  });

  it('AC-JR-W3B-01: renders em-dash when name is null', () => {
    wrap(<CompanyNameLink companyId="c1" name={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('AC-JR-W3B-01: applies hover and focus-visible classes to the link', () => {
    wrap(<CompanyNameLink companyId="c1" name="Acme Corp" />);
    const link = screen.getByRole('link', { name: 'Open Acme Corp' });
    expect(link.className).toContain('hover:');
    expect(link.className).toContain('focus-visible:');
  });
});

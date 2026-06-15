/**
 * AC-JR-W3B-02: ContactNameLink — shared link component for contact names.
 * Mirrors ProjectNameLink's 3-branch contract (link / inert span / em-dash).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ContactNameLink } from '../ContactNameLink';

const wrap = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe('AC-JR-W3B-02: ContactNameLink', () => {
  it('AC-JR-W3B-02: links to /contacts/:id when id present', () => {
    wrap(<ContactNameLink contactId="ct1" name="Jane Smith" />);
    const link = screen.getByRole('link', { name: 'Open Jane Smith' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/contacts/ct1');
  });

  it('AC-JR-W3B-02: renders inert text when contactId is null', () => {
    wrap(<ContactNameLink contactId={null} name="Jane Smith" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Jane Smith')).toBeInTheDocument();
  });

  it('AC-JR-W3B-02: renders em-dash when name is null', () => {
    wrap(<ContactNameLink contactId="ct1" name={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('AC-JR-W3B-02: applies hover and focus-visible classes to the link', () => {
    wrap(<ContactNameLink contactId="ct1" name="Jane Smith" />);
    const link = screen.getByRole('link', { name: 'Open Jane Smith' });
    expect(link.className).toContain('hover:');
    expect(link.className).toContain('focus-visible:');
  });
});

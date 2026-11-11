import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { ProjectNameLink } from '../ProjectNameLink';

const wrap = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe('AC-JR-W1-01: ProjectNameLink', () => {
  it('AC-JR-W1-01: links to /projects/:id when id present', () => {
    wrap(<ProjectNameLink projectId="p1" name="Bridge" />);
    const link = screen.getByRole('link', { name: 'Open Bridge' });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toBe('/projects/p1');
  });

  it('AC-JR-W1-01: renders inert text + em-dash fallback when id is null', () => {
    wrap(<ProjectNameLink projectId={null} name="Bridge" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Bridge')).toBeInTheDocument();
  });

  it('AC-JR-W1-01: renders em-dash when name is null', () => {
    wrap(<ProjectNameLink projectId="p1" name={null} />);
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('AC-JR-W1-01: applies hover and focus-visible classes to the link', () => {
    wrap(<ProjectNameLink projectId="p1" name="Bridge" />);
    const link = screen.getByRole('link', { name: 'Open Bridge' });
    expect(link.className).toContain('hover:');
    expect(link.className).toContain('focus-visible:');
  });
});

describe('AC-002 #1325: ProjectNameLink with a short name', () => {
  it('describes the link by the contractual name and titles it', () => {
    wrap(<ProjectNameLink projectId="p1" name="Depot" legalName="Contractual Depot Expansion" />);
    const link = screen.getByRole('link', { name: 'Open Depot' });
    expect(link).toHaveAccessibleDescription('Contractual Depot Expansion');
    expect(link).toHaveAttribute('title', 'Contractual Depot Expansion');
  });
  it('adds no description when the legal name equals the shown name or is absent', () => {
    wrap(<ProjectNameLink projectId="p1" name="Bridge" legalName="Bridge" />);
    const link = screen.getByRole('link', { name: 'Open Bridge' });
    expect(link).not.toHaveAttribute('aria-describedby');
    expect(link).not.toHaveAttribute('title');
  });
});

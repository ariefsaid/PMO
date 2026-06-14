import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
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

  it('AC-JR-W1-01: renders inert text when id is null', () => {
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

/**
 * AC-JR-W1-01 — ProjectNameLink primitive
 * Links to /projects/:id when id present; em-dash + inert text when null.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import { ProjectNameLink } from '../ProjectNameLink';

const wrap = (ui: React.ReactElement) =>
  render(<MemoryRouter>{ui}</MemoryRouter>);

describe('AC-JR-W1-01: ProjectNameLink', () => {
  it('AC-JR-W1-01: links to /projects/:id when id and name are present', () => {
    wrap(<ProjectNameLink projectId="p1" name="Bridge" />);
    const link = screen.getByRole('link', { name: 'Open Bridge' });
    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('/projects/p1');
    expect(link.textContent).toBe('Bridge');
  });

  it('AC-JR-W1-01: renders inert text (not a link) when projectId is null', () => {
    wrap(<ProjectNameLink projectId={null} name="Bridge" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Bridge')).toBeDefined();
  });

  it('AC-JR-W1-01: renders em-dash when name is null', () => {
    wrap(<ProjectNameLink projectId="p1" name={null} />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('—')).toBeDefined();
  });

  it('AC-JR-W1-01: renders em-dash when name is empty string', () => {
    wrap(<ProjectNameLink projectId="p1" name="" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('—')).toBeDefined();
  });

  it('AC-JR-W1-01: accepts custom aria-label override', () => {
    wrap(
      <ProjectNameLink projectId="p1" name="Bridge" aria-label="Navigate to Bridge project" />,
    );
    const link = screen.getByRole('link', { name: 'Navigate to Bridge project' });
    expect(link).toBeDefined();
  });

  it('AC-JR-W1-01: renders inert text when projectId is undefined', () => {
    wrap(<ProjectNameLink projectId={undefined} name="Bridge" />);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Bridge')).toBeDefined();
  });
});

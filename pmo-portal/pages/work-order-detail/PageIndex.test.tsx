import React from 'react';
import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageGroup, PageIndex } from './PageIndex';

/** Walk T-G1: the work-order page names its groups in a bar that stays in view, and a name takes the reader there. */
const entries = [{ id: 'wo-scope', label: 'Site and scope' }, { id: 'wo-billing', label: 'Billing' }];
const renderPage = () => render(
  <div className="main-scroll">
    <PageIndex entries={entries} />
    <PageGroup id="wo-scope" label="Site and scope"><p>scope panel</p></PageGroup>
    <PageGroup id="wo-billing" label="Billing"><p>billing panel</p></PageGroup>
  </div>,
);

describe('work-order page index', () => {
  it('names every group in one navigation landmark, the first marked current', () => {
    renderPage();
    const nav = screen.getByRole('navigation', { name: 'Sections of this work order' });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Site and scope' })).toHaveAttribute('aria-current', 'location');
    expect(screen.getByRole('link', { name: 'Billing' })).not.toHaveAttribute('aria-current');
  });

  it('a group name moves the reader to that group, marks it current and keeps it in the address', () => {
    renderPage();
    fireEvent.click(screen.getByRole('link', { name: 'Billing' }));
    expect(screen.getByRole('group', { name: 'Billing' })).toHaveFocus();
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('aria-current', 'location');
    expect(window.location.hash).toBe('#wo-billing');
  });

  it('keeps every panel on the page (the index only moves the reader)', () => {
    renderPage();
    expect(screen.getByText('scope panel')).toBeInTheDocument();
    expect(screen.getByText('billing panel')).toBeInTheDocument();
  });
});

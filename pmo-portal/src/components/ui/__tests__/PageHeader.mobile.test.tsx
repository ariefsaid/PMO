/** The long record identity remains present beside its status and actions. */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '../PageHeader';
import { StatusPill } from '../StatusPill';

describe('PageHeader identity availability', () => {
  it('keeps the complete record name, status, and action in the document', () => {
    const name = 'Alstom KLCC Extension Phase 2 — A Very Long Project Name That Exceeds 390px';
    render(
      <PageHeader
        name={name}
        status={<StatusPill variant="progress">In Progress</StatusPill>}
        actions={<button type="button">Edit</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name })).toBeVisible();
    expect(screen.getByText('In Progress')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeVisible();
  });
});

describe('PageHeader mobile identity layout', () => {
  it('places status below the full-width title and metadata on mobile', () => {
    const { container } = render(
      <PageHeader
        name="Cascade Foods 6.0 MW Ground-Mount PV"
        status={<StatusPill variant="progress">Ongoing Project</StatusPill>}
        meta={<span>PRJ-012 · Cascade Foods</span>}
        statusBelowMetaOnMobile
      />,
    );
    const row = screen.getByRole('heading').parentElement;
    const title = screen.getByRole('heading');
    const statusRow = container.querySelector('.row-start-3');
    const meta = screen.getByText(/PRJ-012/).parentElement;
    expect(row?.className).toMatch(/grid/);
    expect(title.className).toMatch(/col-span-2/);
    expect(meta?.className).toMatch(/row-start-2/);
    expect(statusRow).toHaveTextContent('Ongoing Project');
    expect(container.querySelector('h1')).toHaveTextContent('Cascade Foods 6.0 MW Ground-Mount PV');
  });
});

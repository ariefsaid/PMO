import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { RecordHeader } from '../RecordHeader';
import { StatusPill } from '../StatusPill';

describe('RecordHeader', () => {
  it('renders the canonical anatomy: icon tile + name + status + top-right actions', () => {
    render(
      <RecordHeader
        icon="A"
        name="Acme Corp"
        status={<StatusPill variant="won">Active</StatusPill>}
        actions={<button type="button">Edit</button>}
      />,
    );
    const header = screen.getByTestId('record-header');
    expect(header).toBeInTheDocument();
    // identity
    expect(screen.getByRole('heading', { name: 'Acme Corp' })).toBeInTheDocument();
    // status pill is present
    expect(screen.getByText('Active')).toBeInTheDocument();
    // the icon tile shows the leading glyph
    expect(header).toHaveTextContent('A');
    // the action zone holds the Edit affordance
    const actionZone = screen.getByTestId('record-header-actions');
    expect(actionZone).toContainElement(screen.getByRole('button', { name: 'Edit' }));
  });

  it('forwards meta and iconColor to the underlying PageHeader anatomy', () => {
    render(
      <RecordHeader
        icon="P"
        iconColor="hsl(280 50% 50%)"
        name="Project X"
        status={<StatusPill variant="progress">In progress</StatusPill>}
        meta="Cascade Port · PRJ-001"
      />,
    );
    expect(screen.getByText('Cascade Port · PRJ-001')).toBeInTheDocument();
  });

  it('batch-3: gives the record name width priority and lets the action zone wrap below on narrow widths', () => {
    render(
      <RecordHeader
        icon="C"
        name="Cascade Port Authority — A Very Long Record Name"
        status={<StatusPill variant="neutral">Client</StatusPill>}
        actions={<button type="button">Edit</button>}
      />,
    );
    expect(screen.getByRole('heading').className).toContain('break-words');
    expect(screen.getByTestId('record-header-actions').parentElement?.className).toContain('w-full');
  });

  it('drawer variant renders without the standalone card chrome (host supplies the seam)', () => {
    render(
      <RecordHeader
        variant="drawer"
        icon="C"
        name="Jane Doe"
        status={<StatusPill variant="violet">Vendor</StatusPill>}
        actions={<button type="button">Archive</button>}
      />,
    );
    const header = screen.getByTestId('record-header');
    // drawer variant drops the bordered/card wrapper used by the page variant
    expect(header.className).not.toContain('border-border');
    expect(header.className).not.toContain('bg-card');
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });
});

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ProjectDetailHeader from '../ProjectDetailHeader';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const project = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'PRJ-001',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  contract_value: 5000000,
  budget: 4700000,
  spent: 2100000,
  start_date: '2026-01-01',
  end_date: '2026-12-18',
  contract_date: '2026-01-10',
  customer_contract_ref: 'CPO-2026-001',
  client: { name: 'Innovate Corp' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

describe('ProjectDetailHeader', () => {
  it('renders the project name + StatusPill + customer + mono code + Customer PO ref (AC-G)', () => {
    render(<ProjectDetailHeader project={project} />);
    expect(screen.getByRole('heading', { name: 'Innovate Corp HQ Fit-Out' })).toBeInTheDocument();
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
    // The meta row concatenates customer · mono code · Customer-PO ref + date.
    expect(screen.getByText(/Innovate Corp · PRJ-001 · PO CPO-2026-001/)).toBeInTheDocument();
  });

  it('renders a 5-stat strip with contract/actual figures (AC-G)', () => {
    render(<ProjectDetailHeader project={project} />);
    expect(screen.getByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('Actual')).toBeInTheDocument();
    expect(screen.getByText('On-hand margin')).toBeInTheDocument();
    expect(screen.getByText('$5,000,000')).toBeInTheDocument();
    // margin = 5,000,000 - 2,100,000 = 2,900,000 (positive)
    expect(screen.getByText('$2,900,000')).toBeInTheDocument();
  });

  it('shows a negative margin with a true minus glyph and destructive tone (edge)', () => {
    const over = { ...project, spent: 6000000 } as ProjectWithRefs;
    render(<ProjectDetailHeader project={over} />);
    // margin = 5,000,000 - 6,000,000 = -1,000,000, rendered with U+2212
    expect(screen.getByText(/−\$1,000,000/)).toBeInTheDocument();
  });

  it('renders Edit Project as an outline (stub) action', () => {
    render(<ProjectDetailHeader project={project} />);
    expect(screen.getByRole('button', { name: /Edit Project/i })).toBeInTheDocument();
  });
});

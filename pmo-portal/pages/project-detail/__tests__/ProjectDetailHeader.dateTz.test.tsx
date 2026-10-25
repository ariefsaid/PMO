/**
 * AC-W2-3-01: moving PO details below section content keeps its date-only value on the same day.
 *
 * A YYYY-MM-DD value parsed as a UTC instant shifts to the prior date in behind-UTC timezones.
 * The record details use formatDateOnly, which preserves the calendar date.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import ProjectDetailRail from '../ProjectDetailRail';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

vi.mock('@/pages/project-detail/ProjectErpLink', () => ({ ProjectErpLink: () => null }));

const project = {
  id: 'p1',
  name: 'TZ Test Project',
  status: 'Ongoing Project',
  customer_contract_ref: 'CPO-TZ-001',
  contract_date: '2026-06-14',
} as unknown as ProjectWithRefs;

describe('AC-W2-3-01: project detail PO date — no UTC day-shift', () => {
  it('renders contract_date 2026-06-14 as Jun 14, 2026 (not Jun 13)', () => {
    render(<ProjectDetailRail project={project} />);
    fireEvent.click(screen.getByText('Project details'));
    const date = screen.getByText('Customer PO date').nextElementSibling;
    expect(date).toHaveTextContent('Jun 14, 2026');
    expect(date).not.toHaveTextContent('Jun 13, 2026');
  });
});

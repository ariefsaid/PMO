/**
 * The record's facts strip: six answers in one glance. The figure hooks are the seam; the strip's job is
 * to show what they know, leave out what they don't, and keep money cells behind the money role gate.
 */
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ProjectWithRefs } from '@/src/lib/db/projects';

const h = vi.hoisted(() => ({
  canViewMoney: true,
  schedule: { today: '2026-11-09', milestones: [{ id: 'a' }, { id: 'b' }], progress: 51, endLate: 131, lateCount: 3, worst: null, planned: 100, isPending: false } as Record<string, unknown>,
  usage: { pos: { hasBudget: true, spent: 1_780_000, budget: 4_500_000 }, committed: 2_510_000, usedPercent: 95 } as Record<string, unknown>,
  billing: { invoiced: 0, paid: 0, count: 0, pending: false } as Record<string, unknown>,
}));

vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => (action: string, entity: string) => !(entity === 'salesInvoice' && action === 'view') || h.canViewMoney }));
vi.mock('../useProjectOverviewFigures', () => ({
  useScheduleSummary: () => h.schedule,
  useBudgetUsage: () => h.usage,
  useInvoicedPaid: () => h.billing,
}));

import { ProjectFactsStrip } from '../ProjectFactsStrip';

const project = {
  id: 'p1', currency: 'USD', end_date: '2026-06-30', contract_value: 5_250_000, tax_treatment: null, tax_rate: null,
  last_update: null, pm: { full_name: 'Diego Salvatierra' },
} as unknown as ProjectWithRefs;

describe('ProjectFactsStrip', () => {
  beforeEach(() => {
    h.canViewMoney = true;
    h.billing = { invoiced: 0, paid: 0, count: 0, pending: false };
  });

  it('shows the manager, schedule lateness, progress against plan and budget use', () => {
    render(<ProjectFactsStrip project={project} />);
    expect(screen.getByText('Diego Salvatierra')).toBeInTheDocument();
    expect(screen.getByText('131 days late', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('vs 100% plan')).toBeInTheDocument();
    expect(screen.getByTestId('contract-value-amount')).toHaveTextContent(/5\.[23]M/);
    expect(screen.getByText('95%', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Nothing billed yet')).toBeInTheDocument();
  });

  it('leaves the money cells out for a role without money access', () => {
    h.canViewMoney = false;
    render(<ProjectFactsStrip project={project} />);
    expect(screen.getByText('Project manager')).toBeInTheDocument();
    expect(screen.queryByText('Contract')).not.toBeInTheDocument();
    expect(screen.queryByText('Budget used')).not.toBeInTheDocument();
    expect(screen.queryByText('Invoiced · paid')).not.toBeInTheDocument();
  });

  it('shows no invented figure when invoiced is not known', () => {
    h.billing = { invoiced: null, paid: null, count: 0, pending: false };
    render(<ProjectFactsStrip project={project} />);
    expect(screen.queryByText('Nothing billed yet')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Not known yet')).toBeInTheDocument();
  });
});

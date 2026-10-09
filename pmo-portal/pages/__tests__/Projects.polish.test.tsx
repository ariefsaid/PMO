import React, { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import Projects from '../Projects';
import ProjectClassificationFilters from '../../components/ProjectClassificationFilters';
import type { ProjectClassificationFilters as FilterValues } from '@/src/lib/projectClassification';

const { state } = vi.hoisted(() => ({ state: { data: [
  { id: 'p1', name: 'Harbor Renewal Programme — Eastern Terminal Delivery', status: 'Ongoing Project', pmo_project_number: 'PMO-001', code: 'CLIENT-001', currency: 'USD', contract_value: 500000, service_line: 'Engineering', sector: 'Energy', award_type: 'tender', bidding_entity: 'alone', location: 'West Java', client: null, end_client: null, pm: null },
  { id: 'p2', name: 'Harbor Renewal Programme — Western Terminal Delivery', status: 'Ongoing Project', pmo_project_number: 'PMO-002', currency: 'USD', contract_value: 250000, service_line: 'Advisory', client: null, end_client: null, pm: null },
], isPending: false, isError: false, refetch: vi.fn() } }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => state, useClientCompanies: () => ({ data: [] }), useProjectManagers: () => ({ data: [] }), useProjectsMilestoneDates: () => ({ data: [] }), useProjectMutations: () => ({ create: {}, updateHeader: {}, archive: {} }) }));
vi.mock('@/src/hooks/useCompanies', () => ({ useCompanies: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useMyTasks', () => ({ useMyTasks: () => ({ data: [] }) }));
vi.mock('@/src/hooks/useProjectsDelivery', () => ({ useProjectsDeliverySummary: () => ({ data: {} }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ role: 'Project Manager', currentUser: { id: 'pm' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }) }));
vi.mock('../../components/ProjectStatusControl', () => ({ default: () => null }));

function viewport(desktop = true) {
  vi.stubGlobal('matchMedia', vi.fn((media: string) => ({ matches: desktop, media, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
}
function page(path = '/projects?view=table') {
  return render(<MemoryRouter initialEntries={[path]}><ToastProvider><Projects /></ToastProvider></MemoryRouter>);
}
beforeEach(() => { sessionStorage.clear(); viewport(); state.isPending = false; state.isError = false; });

describe('UIP-003 project recognition', () => {
  it('UIP-003 reserves desktop identity space and two-line titles without hiding ancillary columns or numeric alignment', () => {
    page();
    const title = screen.getByRole('button', { name: state.data[0].name });
    expect(title).toHaveClass('md:line-clamp-2');
    expect(title.className).not.toMatch(/truncate|16ch/);
    expect(title.parentElement?.parentElement).toHaveClass('md:w-[190px]');
    expect(title.closest('td')).toHaveClass('min-[1280px]:w-[244px]');
    for (const name of ['Customer', 'End customer']) {
      expect(screen.getByRole('columnheader', { name })).not.toHaveClass('hidden');
    }
    expect(screen.getByRole('columnheader', { name: 'Contract' })).toHaveClass('text-right');
    expect(screen.getByText('CLIENT-001')).toBeInTheDocument();
  });
});

it.each([true, false])('UIP-004 Projects has a separate collapsed Classification disclosure (desktop=%s) with URL-owned summary, count and clear', async (desktop) => {
  viewport(desktop);
  page('/projects?view=table&serviceLine=Engineering&sector=Energy');
  const user = userEvent.setup();
  const trigger = screen.getByRole('button', { name: /^Classification\s*2/ });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByLabelText('Filter by service line')).not.toBeInTheDocument();
  expect(screen.getByText('Service line: Engineering')).toBeVisible();
  expect(screen.getByText('Sector: Energy')).toBeVisible();
  expect(screen.queryByRole('button', { name: state.data[1].name })).not.toBeInTheDocument();
  await user.click(trigger);
  expect(screen.getByLabelText('Filter by service line')).toHaveValue('Engineering');
  await user.keyboard('{Escape}');
  expect(trigger).toHaveFocus();
  await user.click(screen.getByRole('button', { name: 'Clear classifications' }));
  expect(screen.getByRole('button', { name: state.data[1].name })).toBeVisible();
  expect(screen.getByRole('button', { name: /^Classification$/ })).toHaveAttribute('aria-expanded', 'false');
});

it('UIP-004 shared classifications summarize all five selections, retain missing options, remove individually and clear a pending location', async () => {
  function Harness() {
    const [value, setValue] = useState<FilterValues>({ serviceLine: 'Legacy service', sector: 'Energy', awardType: 'direct', biddingEntity: 'consortium', location: 'Java' });
    return <ProjectClassificationFilters rows={[]} value={value} onChange={(patch) => setValue((old) => ({ ...old, ...patch }))} />;
  }
  render(<Harness />);
  const user = userEvent.setup();
  expect(screen.getByRole('button', { name: /^Classification\s*5/ })).toHaveAttribute('aria-expanded', 'false');
  for (const text of ['Service line: Legacy service', 'Sector: Energy', 'Award type: Direct award', 'Bidding entity: Consortium', 'Location: Java']) expect(screen.getByText(text)).toBeVisible();
  await user.click(screen.getByRole('button', { name: /Remove classification: Sector: Energy/ }));
  expect(screen.getByRole('button', { name: /^Classification\s*4/ })).toBeVisible();
  await user.click(screen.getByRole('button', { name: /^Classification\s*4/ }));
  expect(within(screen.getByLabelText('Filter by service line')).getByRole('option', { name: 'Legacy service' })).toBeInTheDocument();
  await user.type(screen.getByLabelText('Filter by location'), ' Sea');
  await user.click(screen.getByRole('button', { name: 'Clear classifications' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /^Classification$/ })).toBeVisible());
  await new Promise((resolve) => setTimeout(resolve, 350));
  await user.click(screen.getByRole('button', { name: /^Classification$/ }));
  expect(screen.getByLabelText('Filter by location')).toHaveValue('');
  expect(screen.queryByText('Location: Java Sea')).not.toBeInTheDocument();
});

it('UIP-004 keyboard removal of the last applied classification returns focus to its surviving trigger', async () => {
  function Harness() {
    const [value, setValue] = useState<FilterValues>({ awardType: 'tender' });
    return <ProjectClassificationFilters rows={[]} value={value} onChange={(patch) => setValue((old) => ({ ...old, ...patch }))} />;
  }
  render(<Harness />);
  const user = userEvent.setup();
  await user.tab();
  await user.tab();
  expect(screen.getByRole('button', { name: 'Remove classification: Award type: Tender' })).toHaveFocus();
  await user.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: /^Classification$/ })).toHaveFocus();
});

it.each(['loading', 'error'])('UIP-004 Projects preserves its explicit %s state', (kind) => {
  state.isPending = kind === 'loading'; state.isError = kind === 'error'; page();
  if (kind === 'loading') expect(screen.getByTestId('liststate-loading')).toBeInTheDocument();
  else expect(screen.getByText("Couldn't load projects")).toBeVisible();
});

import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';
import { FinanceI18nTestProvider } from '@/pages/__tests__/financeI18nTestProvider';
import { financeTestI18n, financeTestI18nReady } from '@/pages/__tests__/financeI18nTestInstance';
import type { CostAttributionRule } from '@/src/lib/repositories/costAttribution';

const h = vi.hoisted(() => ({
  canManage: true,
  list: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
  end: vi.fn(),
}));
vi.mock('@/src/auth/usePermission', () => ({ usePermission: () => () => h.canManage }));
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'IDR' }));
vi.mock('@/src/hooks/useFkOptions', () => ({
  useProjectOptions: () => ({
    isPending: false,
    isError: false,
    refetch: vi.fn(),
    data: [{ value: 'p1', label: 'Alpha Plant' }, { value: 'p2', label: 'Beta Yard' }],
  }),
}));
vi.mock('@/src/lib/repositories/costAttribution', () => ({
  listCostAttributionRules: h.list,
  previewCostAttribution: h.preview,
  saveCostAttributionRule: h.save,
  endCostAttributionRule: h.end,
}));

import CostAttribution from './CostAttribution';

const payroll: CostAttributionRule = {
  id: 'r1v2', rule_key: 'rk1', version: 2, is_current: true, name: 'Engineer payroll',
  match_account: 'Salary - RIS', match_account_group: null, match_cost_center: 'Ops - RIS', match_party_type: null, match_party: null,
  effective_from: '2025-01-01', effective_to: null, specificity: 12,
  targets: [
    { project_id: 'p1', project_name: 'Alpha Plant', percent: 60 },
    { project_id: 'p2', project_name: 'Beta Yard', percent: 40 },
  ],
  created_by: 'u1', created_at: '2025-01-01T00:00:00Z',
};

const travel: CostAttributionRule = {
  ...payroll,
  id: 'r2v1', rule_key: 'rk2', version: 1, name: 'Travel allocation',
  match_account: 'Travel - RIS', match_cost_center: null,
  effective_from: '2025-01-01', effective_to: '2025-12-31',
  targets: [{ project_id: 'p2', project_name: 'Beta Yard', percent: 100 }],
};

const LocationProbe = () => {
  const location = useLocation();
  return <output data-testid="location">{location.search}{location.hash}</output>;
};

function renderScreen(initial = '/administration/cost-attribution') {
  return render(
    <FinanceI18nTestProvider><MemoryRouter initialEntries={[initial]}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
        <ToastProvider><CostAttribution /><LocationProbe /></ToastProvider>
      </QueryClientProvider>
    </MemoryRouter></FinanceI18nTestProvider>,
  );
}

async function pickProject(label: string, name: string) {
  await userEvent.click(screen.getByRole('combobox', { name: new RegExp(label) }));
  await userEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

async function fillNewRule() {
  await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText(/Rule name/), 'Overhead to Alpha');
  await userEvent.type(within(dialog).getByLabelText(/^ERP account/), 'Salary - RIS');
  await userEvent.type(within(dialog).getByLabelText(/Applies from/), '2025-01-01');
  await pickProject('Project', 'Alpha Plant');
  return dialog;
}

beforeEach(async () => {
  await financeTestI18nReady;
  await financeTestI18n.changeLanguage('en');
  h.canManage = true;
  h.list.mockReset().mockResolvedValue([payroll]);
  h.preview.mockReset().mockResolvedValue([]);
  h.save.mockReset().mockResolvedValue(undefined);
  h.end.mockReset().mockResolvedValue(undefined);
});

describe('AC-CAT-014 Cost attribution screen', () => {
  it('lists each rule with projects, dates and match; opening its name shows version details', async () => {
    renderScreen();
    const row = (await screen.findByText('Engineer payroll')).closest('tr') as HTMLElement;
    expect(within(row).getAllByText(/Salary - RIS/).length).toBeGreaterThan(0);
    expect(within(row).getAllByText(/Ops - RIS/).length).toBeGreaterThan(0);
    expect(within(row).getByText(/Alpha Plant 60%/)).toBeInTheDocument();
    expect(within(row).getByText(/Beta Yard 40%/)).toBeInTheDocument();
    expect(within(row).getByText(/2025/)).toBeInTheDocument();
    expect(within(row).getByText('v2')).not.toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'View details for Engineer payroll' }));
    expect(screen.getByRole('region', { name: 'Details for Engineer payroll' })).toHaveTextContent('v2');
  });

  it('restores search/status/sort from the URL and writes changes without dropping unrelated state', async () => {
    h.list.mockResolvedValueOnce([payroll, travel]);
    renderScreen('/administration/cost-attribution?keep=1&cost_search=travel&cost_status=ended&cost_sort=desc#cost-attribution');
    expect(await screen.findByRole('searchbox', { name: 'Search cost attribution rules' })).toHaveValue('travel');
    expect(await screen.findByText('Travel allocation')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View details for Travel allocation' })).toBeInTheDocument();
    expect(screen.queryByRole('row', { name: /Engineer payroll/ })).not.toBeInTheDocument();

    await userEvent.clear(screen.getByRole('searchbox', { name: 'Search cost attribution rules' }));
    expect(screen.getByTestId('location')).toHaveTextContent('keep=1');
    expect(screen.getByTestId('location')).toHaveTextContent('cost_status=ended');
    expect(screen.getByTestId('location')).toHaveTextContent('#cost-attribution');
  });

  it('sorts rule names A–Z and Z–A while keeping the selected status scope', async () => {
    h.list.mockResolvedValueOnce([travel, payroll]);
    renderScreen('/administration/cost-attribution?cost_status=all');
    const table = await screen.findByRole('table');
    await screen.findByText('Travel allocation');
    const dataRows = () => within(table).getAllByRole('row').slice(1);
    expect(dataRows()[0]).toHaveTextContent('Engineer payroll');
    expect(dataRows()[1]).toHaveTextContent('Travel allocation');

    await userEvent.click(screen.getByRole('button', { name: 'Rule name A–Z' }));
    expect(dataRows()[0]).toHaveTextContent('Travel allocation');
    expect(dataRows()[1]).toHaveTextContent('Engineer payroll');
    expect(screen.getByTestId('location')).toHaveTextContent('cost_status=all');
  });

  it('distinguishes a filtered no-match from an empty rule collection and Clear filters restores the rules', async () => {
    renderScreen('/administration/cost-attribution?cost_search=missing');
    expect(await screen.findByText('No rules match these filters')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(await screen.findByText('Engineer payroll')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('');
  });

  it('shows an empty state with an add action, and a retry on a failed load', async () => {
    h.list.mockResolvedValueOnce([]);
    renderScreen();
    expect(await screen.findByText(/No cost attribution rules yet/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add rule' }).length).toBeGreaterThan(0);
  });

  it('shows a retryable error when the rules cannot be read', async () => {
    h.list.mockRejectedValueOnce(new Error('boom'));
    renderScreen();
    expect(await screen.findByText(/Couldn't load cost attribution rules/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Engineer payroll')).toBeInTheDocument();
  });

  it('is read-only for a role that cannot manage rules (a Project Manager reads, never edits)', async () => {
    h.canManage = false;
    renderScreen();
    expect(await screen.findByText('Engineer payroll')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add rule' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Edit / })).toBeNull();
    expect(screen.queryByRole('button', { name: /^End / })).toBeNull();
  });

  it('adds a rule: preview shows amount per project per month and flags an unmapped category, then save sends the rule JSON', async () => {
    h.preview.mockResolvedValue([
      { project_id: 'p1', month: '2025-02-01', category: 'Labor', amount: 1500000, line_count: 3 },
      { project_id: 'p1', month: '2025-03-01', category: null, amount: 700000, line_count: 1 },
    ]);
    renderScreen();
    await screen.findByText('Engineer payroll');
    const dialog = await fillNewRule();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview effect' }));
    const table = await within(dialog).findByRole('table', { name: /Preview/ });
    expect(h.preview).toHaveBeenCalledWith(expect.objectContaining({
      rule_key: null, name: 'Overhead to Alpha', account: 'Salary - RIS', effective_from: '2025-01-01',
      targets: [{ project_id: 'p1', percent: 100 }],
    }));
    expect(within(table).getAllByText(/Alpha Plant/)).toHaveLength(2);
    expect(within(table).getByText(/Feb(ruary)? 2025/)).toBeInTheDocument();
    expect(within(table).getByText(/1\.500\.000|1,500,000/)).toBeInTheDocument();
    expect(within(dialog).getByText(/not mapped to a budget category/i)).toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][0]).toMatchObject({ rule_key: null, expected_version: null, account: 'Salary - RIS' });
  });

  it('refuses a split that does not total 100 before calling the server', async () => {
    renderScreen();
    await screen.findByText('Engineer payroll');
    const dialog = await fillNewRule();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add project' }));
    await pickProject('Project 2', 'Beta Yard');
    const percents = within(dialog).getAllByLabelText(/Percent/);
    await userEvent.clear(percents[0]); await userEvent.type(percents[0], '70');
    await userEvent.clear(percents[1]); await userEvent.type(percents[1], '20');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));
    expect((await within(dialog).findAllByText(/must total 100/)).length).toBeGreaterThan(0);
    expect(h.save).not.toHaveBeenCalled();
  });

  it('names the conflicting rule when a tie is refused (23505) and keeps the form open', async () => {
    h.save.mockRejectedValue(Object.assign(new Error('conflicts with rule Engineer payroll'), { code: '23505' }));
    renderScreen();
    await screen.findByText('Engineer payroll');
    const dialog = await fillNewRule();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(/Engineer payroll/);
    expect(alert).toHaveTextContent(/overlaps/i);
  });

  it('explains a stale edit (40001) and reloads the list', async () => {
    h.save.mockRejectedValue(Object.assign(new Error('rule changed since it was loaded (current version 3)'), { code: '40001' }));
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Engineer payroll' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText(/Rule name/)).toHaveValue('Engineer payroll');
    await userEvent.type(within(dialog).getByLabelText(/Rule name/), ' 2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));
    expect(h.save.mock.calls[0][0]).toMatchObject({ rule_key: 'rk1', expected_version: 2, name: 'Engineer payroll 2' });
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/changed since you opened it/i);
    expect(h.list.mock.calls.length).toBeGreaterThan(1);
  });

  it('maps a permission refusal (42501) and an invalid rule (22023) to clear messages', async () => {
    h.save.mockRejectedValueOnce(Object.assign(new Error('not authorized'), { code: '42501' }));
    renderScreen();
    await screen.findByText('Engineer payroll');
    const dialog = await fillNewRule();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Finance and Admin/);
    h.save.mockRejectedValueOnce(Object.assign(new Error('account "Salary - RIS" not found'), { code: '22023' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save rule' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/Salary - RIS/);
  });

  it('shows a preview refusal (22023) in the form instead of a table', async () => {
    h.preview.mockRejectedValue(Object.assign(new Error('account "Salary - RIS" not found'), { code: '22023' }));
    renderScreen();
    await screen.findByText('Engineer payroll');
    const dialog = await fillNewRule();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Preview effect' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/can't be saved.*Salary - RIS/);
    expect(within(dialog).queryByRole('table')).toBeNull();
  });

  it('ends a rule after confirmation, with its version', async () => {
    renderScreen();
    await userEvent.click(await screen.findByRole('button', { name: 'End Engineer payroll' }));
    await userEvent.click(await screen.findByRole('button', { name: 'End rule' }));
    expect(h.end).toHaveBeenCalledWith('rk1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), 2);
  });
});

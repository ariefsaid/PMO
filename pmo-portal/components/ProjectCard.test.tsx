import { describe, it, expect, vi } from 'vitest';
import { render as rtlRender, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter } from 'react-router';
import { ToastProvider } from '@/src/components/ui';
import ProjectCard from './ProjectCard';
import type { ProjectWithRefs } from '@/src/lib/db/projects';
import type { ProjectMoneyRead } from '@/src/lib/db/projectMoney';
import { resetActiveLocale, setActiveLocale } from '@/src/lib/locale/activeLocale';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import enCommon from '../public/locales/en/common.json';
import idCommon from '../public/locales/id/common.json';

// ProjectCard embeds ProjectStatusControl (useToast) + CompanyNameLink (Link) —
// wrap in both providers.
const render = (ui: ReactElement) =>
  rtlRender(
    <MemoryRouter>
      <ToastProvider>{ui}</ToastProvider>
    </MemoryRouter>,
  );

// ADR-0016: ProjectStatusControl now gates on the REAL JWT role via usePermission,
// so the mock supplies realRole (equal to effectiveRole — no impersonation here).
// FR-L10N-020: this component reads useOrgCurrency for its ACROSS-record aggregates. Pinned here
// rather than left to a real query. ⚑ At LINE-START on purpose — inserted inside a neighbouring
// vi.mock call it parses as a syntax error and hides every real error beneath it.
vi.mock('@/src/hooks/useOrgCurrency', () => ({ useOrgCurrency: () => 'USD' }));
vi.mock('@/src/auth/impersonation', () => ({
  useEffectiveRole: () => ({ effectiveRole: 'Project Manager', realRole: 'Project Manager' }),
}));
vi.mock('@/src/hooks/useProjectTransitions', () => ({
  useProjectTransition: () => ({ mutate: vi.fn(), isError: false, error: null, isPending: false }),
}));

const base = {
  id: 'p1',
  name: 'Innovate Corp HQ Fit-Out',
  code: 'CLIENT-81',
  pmo_project_number: 'PMO-26-7711',
  status: 'Ongoing Project',
  client_id: 'c2',
  project_manager_id: 'u-alice',
  contract_value: 5000000, currency: 'USD', tax_treatment: 'exclusive',
  budget: 4700000,
  spent: 2100000,
  end_date: '2026-12-18',
  customer_contract_ref: 'CPO-2026-001',
  client: { name: 'Innovate Corp' },
  pm: { full_name: 'Alice Manager' },
} as unknown as ProjectWithRefs;

describe('ProjectCard', () => {
  it('shows the full client name so similarly named customers remain distinguishable', () => {
    render(<ProjectCard project={{ ...base, client: { name: 'Example Legal Company', short_name: 'Example' } }} onOpen={vi.fn()} />);
    expect(screen.getByText('Example Legal Company')).toBeVisible();
    expect(screen.queryByText('Example', { exact: true })).not.toBeInTheDocument();
  });
  it('H-09: the open control visibly names the full contractual project identity', () => {
    render(<ProjectCard project={{ ...base, short_name: 'Harbor Operations' }} onOpen={vi.fn()} />);
    const title = screen.getByRole('button', { name: 'Innovate Corp HQ Fit-Out' });
    expect(title).toHaveTextContent('Innovate Corp HQ Fit-Out');
    expect(title).toBeVisible();
  });

  it('renders the project name, customer, contract value and PM (AC-401 strings)', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByText('Innovate Corp HQ Fit-Out')).toBeInTheDocument();
    expect(screen.getByText('Innovate Corp')).toBeInTheDocument();
    expect(screen.getByText(/PM: Alice Manager/)).toBeInTheDocument();
    expect(screen.getByText('5,000,000')).toBeInTheDocument();
    expect(screen.getByText('Amounts · USD')).toBeInTheDocument();
  });

  it('shows the project lifecycle state on the card', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByText('Ongoing Project')).toBeInTheDocument();
  });

  it('R-015: localizes the project lifecycle state for Indonesian readers', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'id', fallbackLng: 'en', defaultNS: 'common',
      resources: { en: { common: enCommon }, id: { common: idCommon } },
      interpolation: { escapeValue: false }, react: { useSuspense: false },
    });
    rtlRender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter><ToastProvider><ProjectCard project={base} onOpen={vi.fn()} /></ToastProvider></MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('Proyek berjalan')).toBeInTheDocument();
  });

  it('PL-B: carries no status-change control (transitions live on the record)', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.queryByTestId('project-status-control')).not.toBeInTheDocument();
  });

  it('shows the customer contract ref on demand', async () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    await userEvent.click(screen.getByText('Project IDs (3)'));
    expect(screen.getByText(/Customer contract reference:/)).toBeVisible();
    expect(screen.getByText('CPO-2026-001')).toBeVisible();
  });

  it('renders em-dashes for a missing customer and PM rather than blank', () => {
    // A genuinely unassigned project: BOTH pm:null AND project_manager_id:null.
    const sparse = { ...base, client: null, pm: null, project_manager_id: null } as unknown as ProjectWithRefs;
    render(<ProjectCard project={sparse} onOpen={vi.fn()} />);
    expect(screen.getByText(/PM: Unassigned/)).toBeInTheDocument();
    expect(screen.getByText('Customer unavailable')).toBeInTheDocument();
  });

  it('FR-PRJUX-004: an assigned profile with a blank name shows `Unnamed user · shortID`, not Unassigned', () => {
    const blankAssigned = {
      ...base,
      project_manager_id: 'aaaaaaaa-bbbb-0000',
      pm: { full_name: '   ' },
    } as unknown as ProjectWithRefs;
    render(<ProjectCard project={blankAssigned} onOpen={vi.fn()} />);
    expect(screen.getByText(/PM: Unnamed user · aaaaaaaa/)).toBeInTheDocument();
    expect(screen.queryByText(/PM: Unassigned/)).not.toBeInTheDocument();
  });

  it('calls onOpen when the card is activated, but not when Edit is used', async () => {
    const onOpen = vi.fn();
    const onEdit = vi.fn();
    render(<ProjectCard project={base} onOpen={onOpen} onEdit={onEdit} />);
    await userEvent.click(screen.getByRole('button', { name: 'Innovate Corp HQ Fit-Out' }));
    expect(onOpen).toHaveBeenCalledWith(base);

    onOpen.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /^Edit Innovate Corp HQ Fit-Out/i }));
    expect(onEdit).toHaveBeenCalledWith(base);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('AC-CODE-003: renders PMO Project Number and Client Project Code as separate labelled identities', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByRole('article')).toHaveTextContent('PMO Project Number: PMO-26-7711');
    expect(screen.getByRole('article')).toHaveTextContent('Client Project Code: CLIENT-81');
  });

  it('AC-S02: an unresolved collection read does not claim that no Active budget exists', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.getByText('Actual / Budget used')).toBeVisible();
    expect(screen.queryByText('No active budget')).not.toBeInTheDocument();
    expect(screen.queryByText('$4,700,000')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('UX-020: near-complete card delivery is not colored as a financial risk', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} deliverySummary={{ deliveryPct: 95, committedSpend: 0, budget: 0 }} />);
    expect(screen.getByLabelText('Delivery 95%').querySelector('[data-testid="progress-fill"]')).toHaveClass('bg-primary');
  });

  it('I5: when deliverySummary is provided, shows Delivery alongside Actual-based budget usage', () => {
    render(
      <ProjectCard
        project={base}
        onOpen={vi.fn()}
        deliverySummary={{ deliveryPct: 50, committedSpend: 2_000_000, budget: 3_800_000 }}
        projectMoney={{ ledgerBasis: 'erp', actuals: { currency: 'USD', total: '125000.00', asOf: '2026-10-01T00:00:00Z', excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '125000.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true }}
      />,
    );
    // Delivery progress bar
    const deliveryBar = screen.getByLabelText('Delivery 50%');
    expect(deliveryBar).toBeInTheDocument();
    // Budget used bar is based on mapped Actual / Active budget, not committed spend.
    const budgetBar = screen.getByLabelText(/25% of Active budget/i);
    expect(budgetBar).toBeInTheDocument();
    expect(screen.getByText('125,000')).toBeInTheDocument();
    expect(screen.getByText('500,000')).toBeInTheDocument();
    // PL-B: no freshness line and no "x of y" caption on the card.
    expect(screen.queryByText(/Updated|of .* Active budget/)).not.toBeInTheDocument();
    // Should NOT show the old Committed/Actual bars
    expect(screen.queryByLabelText(/Committed: \d+% of contract/i)).not.toBeInTheDocument();
  });

  it('AC-S02: the compact Actual summary uses Actual currency, not project currency', () => {
    const project = { ...base, currency: 'IDR' } as ProjectWithRefs;
    render(<ProjectCard project={project} onOpen={vi.fn()} deliverySummary={{ deliveryPct: 50, committedSpend: 0, budget: 0 }} projectMoney={{ ledgerBasis: 'erp', actuals: { currency: 'USD', total: '125000.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '125000.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true }} />);
    expect(screen.getByText('USD 125,000')).toBeInTheDocument();
    expect(screen.getByText('Amounts by currency')).toBeInTheDocument();
    // Not comparable: no Budget used bar (and no repeated explanation on the card).
    expect(screen.queryByRole('progressbar', { name: /Active budget/ })).not.toBeInTheDocument();
    expect(screen.getByText('Budget currency differs from Actual')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review budget' })).toHaveAttribute('href', '/projects/p1/budget');
  });

  it('formats the exact Actual with the selected number locale, independently of UI language', () => {
    setActiveLocale({ locale: 'en', numberLocale: 'id-ID', timezone: 'UTC' });
    try {
      render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={{ ledgerBasis: 'erp', actuals: { currency: 'USD', total: '125000.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '125000.00' }] }, activeBudgetAmount: '500000.00', activeBudgetCurrency: 'USD', hasActiveBudget: true }} />);
      expect(screen.getByText('125.000')).toBeInTheDocument();
    } finally {
      resetActiveLocale();
    }
  });

  it('uses the canonical at-risk predicate rather than rounded display percentages', () => {
    const actuals = (amount: string) => ({ currency: 'USD', total: amount, asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount }] });
    const budget = { activeBudgetAmount: '100.00', activeBudgetCurrency: 'USD', hasActiveBudget: true } as const;
    const { unmount } = render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={{ ledgerBasis: 'erp', actuals: actuals('89.50'), ...budget }} />);
    expect(screen.queryByText('At risk')).not.toBeInTheDocument();
    unmount();
    render(<ProjectCard project={{ ...base, status: 'Close Out' } as ProjectWithRefs} onOpen={vi.fn()} projectMoney={{ ledgerBasis: 'erp', actuals: actuals('95.00'), ...budget }} />);
    expect(screen.queryByText('At risk')).not.toBeInTheDocument();
  });

  it('AC-S02/R-012: partial and restricted Actual names its state and offers finance review without driving budget usage', () => {
    const cases: Array<[ProjectMoneyRead['actuals'], string]> = [
      [{ currency: 'USD', total: '450.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '450.00' }, { category: 'Materials', mapped: false, amount: null }] }, 'Incomplete source coverage'],
      [{ currency: 'USD', total: '450.00', asOf: null, excludesRestrictedRows: true, categories: [{ category: 'Labor', mapped: true, amount: '450.00' }] }, 'Restricted rows excluded'],
    ];
    for (const [actuals, expectedState] of cases) {
      const { unmount } = render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={{ ledgerBasis: 'erp', actuals, activeBudgetAmount: '500.00', activeBudgetCurrency: 'USD', hasActiveBudget: true }} />);
      expect(screen.queryByText('$450')).not.toBeInTheDocument();
      expect(screen.getByText(expectedState)).toBeVisible();
      expect(screen.getAllByRole('link', { name: 'Review project finances' })).toHaveLength(1);
      expect(screen.queryByRole('progressbar', { name: /Active budget/i })).not.toBeInTheDocument();
      unmount();
    }
  });

  it('R-012: missing delivery phases have a named next step', () => {
    render(<ProjectCard project={base} onOpen={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'Review delivery plan' })).toHaveAttribute('href', '/projects/p1/overview');
    expect(screen.getByRole('link', { name: 'Review delivery plan' })).toHaveAttribute('href', '/projects/p1/overview');
  });

  it('PL-B: a known Actual carries no per-card freshness prose', () => {
    const projectMoney: ProjectMoneyRead = {
      ledgerBasis: 'erp',
      actuals: { currency: 'USD', total: '125.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '125.00' }] },
      activeBudgetAmount: '500.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
    };
    render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={projectMoney} />);
    expect(screen.getByText('125')).toBeInTheDocument();
    expect(screen.getByText('Amounts · USD')).toBeInTheDocument();
    expect(screen.queryByText('$125.00')).not.toBeInTheDocument();
    expect(screen.queryByText(/Update time unavailable|Updated/)).not.toBeInTheDocument();
  });

  it('R-003: shared partial-coverage context is not repeated in desktop money cells', () => {
    const projectMoney: ProjectMoneyRead = {
      ledgerBasis: 'erp',
      actuals: {
        currency: 'USD',
        total: '450.00',
        asOf: null,
        excludesRestrictedRows: false,
        categories: [
          { category: 'Labor', mapped: true, amount: '450.00' },
          { category: 'Materials', mapped: false, amount: null },
        ],
      },
      activeBudgetAmount: '500.00',
      activeBudgetCurrency: 'USD',
      hasActiveBudget: true,
    };
    render(<>
      <div id="coverage-note">Some source categories are unmapped or missing amounts.</div>
      <ProjectCard project={base} onOpen={vi.fn()} projectMoney={projectMoney} partialCoverageNoteId="coverage-note" />
    </>);

    const unavailable = screen.getAllByText('Unavailable');
    expect(unavailable).toHaveLength(1);
    unavailable.forEach((value) => expect(value).toHaveAttribute('aria-describedby', 'coverage-note'));
    expect(screen.queryByText('Incomplete source coverage')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Review project finances' })).not.toBeInTheDocument();
    expect(screen.getByText('Some source categories are unmapped or missing amounts.')).toBeInTheDocument();
  });

  it('AC-S02: a known zero Active budget is not mislabeled as absent', () => {
    const projectMoney: ProjectMoneyRead = {
      ledgerBasis: 'erp',
      actuals: { currency: 'USD', total: '0.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '0.00' }] },
      activeBudgetAmount: '0.00', activeBudgetCurrency: 'USD', hasActiveBudget: true,
    };
    render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={projectMoney} />);
    expect(screen.getAllByText('0')).toHaveLength(2);
    expect(screen.queryByText('No active budget')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('AC-S02-011: does not compare or total Actual and Active budget across currencies', () => {
    const projectMoney: ProjectMoneyRead = {
      ledgerBasis: 'erp',
      actuals: { currency: 'USD', total: '900.00', asOf: '2026-10-01', excludesRestrictedRows: false, categories: [] },
      activeBudgetAmount: '1000.00',
      activeBudgetCurrency: 'EUR',
      hasActiveBudget: true,
    };
    render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={projectMoney} />);
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+% of Active budget/)).not.toBeInTheDocument();
  });

  it('AC-S02-010: unknown Actual and absent Active budget never render zero-valued bars', () => {
    const projectMoney: ProjectMoneyRead = {
      ledgerBasis: 'erp',
      actuals: { currency: 'USD', total: null, asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: false, amount: null }] },
      activeBudgetAmount: null,
      activeBudgetCurrency: null,
      hasActiveBudget: false,
    };
    render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={projectMoney} />);
    expect(screen.getByText('Incomplete source coverage')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review project finances' })).toBeInTheDocument();
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.getAllByText('No active budget')).toHaveLength(1);
    expect(screen.queryByLabelText(/Actual spend: 0%/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Budget used 0%/)).not.toBeInTheDocument();
  });

  it('AC-S02/R-012: a present Active budget without a readable amount is unavailable, not absent', () => {
    const projectMoney: ProjectMoneyRead = {
      ledgerBasis: 'erp',
      actuals: { currency: 'USD', total: '125.00', asOf: null, excludesRestrictedRows: false, categories: [{ category: 'Labor', mapped: true, amount: '125.00' }] },
      activeBudgetAmount: null, activeBudgetCurrency: 'USD', hasActiveBudget: true,
    };
    render(<ProjectCard project={base} onOpen={vi.fn()} projectMoney={projectMoney} />);
    expect(screen.getAllByText('Unavailable')).toHaveLength(2);
    expect(screen.queryByText('No active budget')).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Review budget' })).toHaveLength(2);
  });
});

// ⚑ Bound at the spec review's insistence: removing the label from ProjectCard left the ENTIRE
// 7,363-test suite green. Implemented is not covered. Both polarities, because a fixture where
// every row shares one treatment cannot tell a derived label from a hardcoded one.
describe('OD-TAX-1 §2: the contract figure states its basis', () => {
  it('renders the row\'s own treatment, and nothing when the row has none', () => {
    const { unmount } = render(
      <ProjectCard project={{ ...base, tax_treatment: 'inclusive' } as typeof base} onOpen={vi.fn()} />,
    );
    expect(screen.getByTestId('tax-basis')).toHaveAttribute('data-tax-basis', 'inclusive');
    unmount();
    render(
      <ProjectCard project={{ ...base, tax_treatment: null } as unknown as typeof base} onOpen={vi.fn()} />,
    );
    expect(screen.queryByTestId('tax-basis')).not.toBeInTheDocument();
  });

  it('the card keeps the contract amount paired with its basis', () => {
    const project = {
      ...base,
      tax_rate: 12,
      tax_base_numerator: 11,
      tax_base_denominator: 12,
    } as unknown as ProjectWithRefs;
    render(<ProjectCard project={project} onOpen={vi.fn()} />);

    const card = screen.getByRole('article');
    expect(within(card).getByTestId('tax-basis')).toHaveTextContent(/^excl\. PPN$/);
    expect(within(card).getByText('5,000,000')).toBeInTheDocument();
  });
});

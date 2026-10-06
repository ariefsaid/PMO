# Plan part 4 — Expense claims (#775): list, forms, aging, lines, receipts (Tasks 26–35)

Part of `docs/plans/2026-10-06-expense-claims.md`. **Tasks 36–46** (detail page, approvals inbox, wiring, i18n,
e2e, final gate, phase-B spike) continue in `docs/plans/2026-10-06-expense-claims.part5-fe-ship.md`.
Vitest: `cd "$WT/pmo-portal" && ../scripts/with-test-lock.sh npx vitest run <files>`.
Every string is a `t(key, default)` call; Task 43 adds the keys to `en` and `id`.

### Task 26 — Labels and the caller's-advances options (support code)

`pmo-portal/pages/expenses/expenseLabels.ts`:

```ts
import type { AgingBucket, ExpenseClaimStatus, ExpenseKind, ExpenseType } from '@/src/lib/db/expenseClaims';

type Translate = (key: string, fallback: string) => string;

/** Literal `t()` calls so every label is visible to the i18n catalogue gates (the budgetCategoryLabel idiom). */
export function expenseStatusLabel(status: ExpenseClaimStatus, t: Translate): string {
  switch (status) {
    case 'Draft': return t('expenses.status.draft', 'Draft');
    case 'Submitted': return t('expenses.status.submitted', 'Submitted');
    case 'Approved': return t('expenses.status.approved', 'Approved');
    case 'Rejected': return t('expenses.status.rejected', 'Rejected');
    case 'Paid': return t('expenses.status.paid', 'Paid');
    case 'Cancelled': return t('expenses.status.cancelled', 'Cancelled');
    default: return String(status);
  }
}

export function expenseKindLabel(kind: ExpenseKind, t: Translate): string {
  return kind === 'advance' ? t('expenses.kind.advance', 'Cash advance') : t('expenses.kind.claim', 'Expense claim');
}

export function expenseTypeLabel(type: ExpenseType, t: Translate): string {
  switch (type) {
    case 'Travel': return t('expenses.type.travel', 'Travel');
    case 'Accommodation': return t('expenses.type.accommodation', 'Accommodation');
    case 'Meals': return t('expenses.type.meals', 'Meals');
    case 'Local transport': return t('expenses.type.localTransport', 'Local transport');
    case 'Other': return t('expenses.type.other', 'Other');
    default: return String(type);
  }
}

export function agingBucketLabel(bucket: AgingBucket, t: Translate): string {
  switch (bucket) {
    case '0-30': return t('expenses.aging.bucket.upTo30', '0–30 days');
    case '31-60': return t('expenses.aging.bucket.d31to60', '31–60 days');
    case '61-90': return t('expenses.aging.bucket.d61to90', '61–90 days');
    default: return t('expenses.aging.bucket.over90', 'Over 90 days');
  }
}
```

`pmo-portal/pages/expenses/useOwnAdvanceOptions.ts`:

```ts
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useExpenseAdvanceAging } from '@/src/hooks/useExpenseClaims';
import { formatCurrencyCents } from '@/src/lib/format';

/** The caller's own paid advances that still hold money (DD-EXP-6) — the claim form's "settle against" choices.
 *  Keeps an already-linked advance selectable even after it is fully settled. */
export function useOwnAdvanceOptions(currentAdvanceId: string | null = null): { value: string; label: string }[] {
  const { t } = useTranslation();
  const userId = useAuth().currentUser?.id;
  const aging = useExpenseAdvanceAging();
  return useMemo(() => {
    const own = (aging.data?.rows ?? [])
      .filter((r) => r.claimantId === userId)
      .map((r) => ({ value: r.advanceId, label: `${r.claimNumber ?? '—'} · ${formatCurrencyCents(r.outstanding, r.currency)}` }));
    if (currentAdvanceId && !own.some((o) => o.value === currentAdvanceId)) {
      own.unshift({ value: currentAdvanceId, label: t('expenses.form.advance.current', 'The advance already linked') });
    }
    return own;
  }, [aging.data, userId, currentAdvanceId, t]);
}
```

**Verify:** `cd "$WT/pmo-portal" && npm run typecheck` → 0 errors.

### Task 27 — RED: the list page (AC-EXP-060)

Create `pmo-portal/pages/ExpenseClaims.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrencyCents } from '@/src/lib/format';

const mockNavigate = vi.fn();
vi.mock('react-router', async (importOriginal) => {
  const real = await importOriginal<typeof import('react-router')>();
  return { ...real, useNavigate: () => mockNavigate };
});
const h = vi.hoisted(() => ({
  listSpy: vi.fn(),
  list: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  aging: { data: { rows: [] as unknown[], truncated: false }, isPending: false, isError: false, refetch: vi.fn() },
  create: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaims: (filters: unknown) => { h.listSpy(filters); return h.list; },
  useExpenseAdvanceAging: () => h.aging,
  useExpenseClaimMutations: () => ({ create: h.create }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [{ id: 'p1', name: 'Harbour Upgrade' }] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'u1', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Engineer', effectiveRole: 'Engineer' }) }));

import ExpenseClaims from './ExpenseClaims';

const ROW = {
  id: 'c1', claim_number: 'EXP-2610060001', kind: 'claim', title: 'Site visit', claimant: { full_name: 'Budi Field' },
  project: { name: 'Harbour Upgrade' }, budget_category: 'Special expenses', amount: 750000, currency: 'IDR', status: 'Submitted',
};
const renderPage = () => render(<MemoryRouter><ToastProvider><ExpenseClaims /></ToastProvider></MemoryRouter>);

beforeEach(() => {
  mockNavigate.mockClear();
  h.listSpy.mockClear();
  h.create.mutateAsync.mockReset();
  h.list.data = { rows: [ROW], truncated: false };
});

describe('ExpenseClaims page', () => {
  it('AC-EXP-060 lists records with number, claimant, project, amount and status', () => {
    renderPage();
    const row = screen.getByRole('row', { name: /Site visit/ });
    expect(within(row).getByText('EXP-2610060001')).toBeInTheDocument();
    expect(within(row).getByText('Budi Field')).toBeInTheDocument();
    expect(within(row).getByText('Harbour Upgrade')).toBeInTheDocument();
    expect(within(row).getByText(formatCurrencyCents(750000, 'IDR'))).toBeInTheDocument();
    expect(within(row).getByText('Submitted')).toBeInTheDocument();
  });

  it('AC-EXP-060 the Special expenses filter queries by that category', async () => {
    renderPage();
    await userEvent.selectOptions(screen.getByLabelText('Budget category'), 'Special expenses');
    expect(h.listSpy).toHaveBeenLastCalledWith({ budgetCategory: 'Special expenses' });
  });

  it('AC-EXP-060 New claim creates a claim and opens it', async () => {
    h.create.mutateAsync.mockResolvedValue({ id: 'new-1' });
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'New claim' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Site visit');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(h.create.mutateAsync).toHaveBeenCalledWith({
      kind: 'claim', title: 'Site visit', purpose: null, projectId: null, budgetCategory: null, advanceId: null,
    });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/expenses/new-1'));
  });

  it('AC-EXP-060 an advance cannot be created without an amount', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Request advance' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Title/), 'Trip float');
    expect(within(dialog).getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(h.create.mutateAsync).not.toHaveBeenCalled();
  });

  it('AC-EXP-060 says when the list is truncated instead of trimming silently', () => {
    h.list.data = { rows: [ROW], truncated: true };
    renderPage();
    expect(screen.getByText(/Showing the latest 200/)).toBeInTheDocument();
  });
});
```

**Verify (RED):** `…npx vitest run pages/ExpenseClaims.test.tsx` → cannot resolve `./ExpenseClaims`.

### Task 28 — GREEN (part): `pmo-portal/pages/expenses/ExpenseClaimFormModal.tsx`

```tsx
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  EntityFormModal, FormGrid, FormSection, SelectField, TextField, useEntityForm, type SubmitError,
} from '@/src/components/ui';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import type { BudgetCategory, ExpenseClaimInput, ExpenseKind } from '@/src/lib/db/expenseClaims';

/** Create / edit the header of a claim or an advance (#775, FR-EXP-061). A claim's amount is never entered here
 *  — the server sums its lines (0247 §3). Amounts parse in the user's number locale at 2 decimals (#468). */
export interface ExpenseClaimFormInitial {
  title: string;
  projectId: string | null;
  budgetCategory: BudgetCategory | null;
  purpose: string | null;
  amount: number;
  advanceId: string | null;
}

interface FormValues { title: string; projectId: string; budgetCategory: string; purpose: string; amount: string; advanceId: string }

export interface ExpenseClaimFormModalProps {
  kind: ExpenseKind;
  projectOptions: { value: string; label: string }[];
  advanceOptions: { value: string; label: string }[];
  initial?: ExpenseClaimFormInitial;
  onClose: () => void;
  onSubmit: (input: ExpenseClaimInput) => Promise<void>;
}

export const ExpenseClaimFormModal: React.FC<ExpenseClaimFormModalProps> = ({
  kind, projectOptions, advanceOptions, initial, onClose, onSubmit,
}) => {
  const { t } = useTranslation();
  const validate = useMemo(
    () => (v: FormValues): Partial<Record<keyof FormValues, string>> => {
      const errors: Partial<Record<keyof FormValues, string>> = {};
      if (!v.title.trim()) errors.title = t('expenses.form.errors.titleRequired', 'Give it a short title.');
      if (kind === 'advance') {
        const amount = parseMoneyInputAtScale(v.amount, 2);
        if (amount === null || !(amount > 0)) errors.amount = t('expenses.form.errors.amountPositive', 'Enter an amount greater than zero.');
      }
      return errors;
    },
    [t, kind],
  );
  const form = useEntityForm<FormValues>({
    initialValues: {
      title: initial?.title ?? '',
      projectId: initial?.projectId ?? '',
      budgetCategory: initial?.budgetCategory ?? '',
      purpose: initial?.purpose ?? '',
      amount: initial && kind === 'advance' ? formatMoneyInputValue(initial.amount) : '',
      advanceId: initial?.advanceId ?? '',
    },
    validate,
    idPrefix: 'expense-form',
    requiredFields: kind === 'advance' ? ['title', 'amount'] : ['title'],
    module: 'expenses',
  });
  const titleField = form.fieldProps('title');
  const projectField = form.fieldProps('projectId');
  const categoryField = form.fieldProps('budgetCategory');
  const purposeField = form.fieldProps('purpose');
  const amountField = form.fieldProps('amount');
  const advanceField = form.fieldProps('advanceId');
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const categoryOptions = useMemo(
    () => [
      { value: '', label: t('expenses.form.category.none', 'No category') },
      ...Constants.public.Enums.budget_category.map((c) => ({ value: c, label: budgetCategoryLabel(c, t) })),
    ],
    [t],
  );
  const errorSummary = [
    form.errors.title ? { fieldId: titleField.id, message: form.errors.title } : null,
    form.errors.amount ? { fieldId: amountField.id, message: form.errors.amount } : null,
  ].filter((item): item is { fieldId: string; message: string } => item !== null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (values) => {
      const input: ExpenseClaimInput = {
        kind,
        title: values.title.trim(),
        purpose: values.purpose.trim() || null,
        projectId: values.projectId || null,
        budgetCategory: (values.budgetCategory || null) as BudgetCategory | null,
        ...(kind === 'advance' ? { amount: parseMoneyInputAtScale(values.amount, 2) ?? 0 } : {}),
        ...(kind === 'claim' ? { advanceId: values.advanceId || null } : {}),
      };
      try {
        await onSubmit(input);
      } catch (err) {
        const { headline, detail } = classifyMutationError(err);
        setSaveError({ headline, detail });
      }
    });
  };

  const title = initial
    ? t('expenses.form.editTitle', 'Edit details')
    : kind === 'advance'
      ? t('expenses.form.advanceTitle', 'Request a cash advance')
      : t('expenses.form.claimTitle', 'New expense claim');
  const subtitle = kind === 'advance'
    ? t('expenses.form.advanceSubtitle', 'Cash you take before the work. Claims you file afterwards settle it.')
    : t('expenses.form.claimSubtitle', 'Add lines and receipts on the next screen.');

  return (
    <EntityFormModal
      open
      title={title}
      subtitle={subtitle}
      submitLabel={initial ? t('expenses.form.submitSave', 'Save') : t('expenses.form.submitCreate', 'Create')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
      submitError={saveError}
    >
      <FormSection legend={t('expenses.form.sections.details', 'Details')}>
        <FormGrid>
          <TextField id={titleField.id} label={t('expenses.form.title.label', 'Title')} required value={titleField.value}
            onChange={titleField.onChange} onBlur={titleField.onBlur} error={titleField.error}
            placeholder={t('expenses.form.title.placeholder', 'e.g. Site visit, week 41')} fullWidth />
          <SelectField id={projectField.id} label={t('expenses.form.project.label', 'Project')} value={projectField.value}
            onChange={(v) => projectField.onChange(v)} onBlur={projectField.onBlur}
            options={[{ value: '', label: t('expenses.form.project.none', 'Overhead (no project)') }, ...projectOptions]} />
          <SelectField id={categoryField.id} label={t('expenses.form.category.label', 'Budget category')} value={categoryField.value}
            onChange={(v) => categoryField.onChange(v)} onBlur={categoryField.onBlur} options={categoryOptions}
            helper={t('expenses.form.category.helper', "Decides who approves: spend within the project's budget for this category goes to the project's approver.")} />
          {kind === 'advance' && (
            <TextField id={amountField.id} label={t('expenses.form.amount.label', 'Amount')} required inputMode="decimal"
              value={amountField.value} onChange={amountField.onChange} onBlur={amountField.onBlur} error={amountField.error} />
          )}
          {kind === 'claim' && advanceOptions.length > 0 && (
            <SelectField id={advanceField.id} label={t('expenses.form.advance.label', 'Settle against advance')} value={advanceField.value}
              onChange={(v) => advanceField.onChange(v)} onBlur={advanceField.onBlur}
              options={[{ value: '', label: t('expenses.form.advance.none', 'No advance') }, ...advanceOptions]} />
          )}
          <TextField id={purposeField.id} label={t('expenses.form.purpose.label', 'Purpose')} value={purposeField.value}
            onChange={purposeField.onChange} onBlur={purposeField.onBlur}
            placeholder={t('expenses.form.purpose.placeholder', 'What the money was for')} fullWidth />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};
```

**Verify:** `npm run typecheck` → 0 errors (the page test stays RED until Task 31).

### Task 29 — RED: advance aging card (AC-EXP-063)

Create `pmo-portal/pages/expenses/AdvanceAgingCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';
import { formatCurrencyCents } from '@/src/lib/format';

const h = vi.hoisted(() => ({
  aging: { data: undefined as unknown, isPending: false, isError: false, refetch: vi.fn() },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseAdvanceAging: () => h.aging }));

import { AdvanceAgingCard } from './AdvanceAgingCard';

const row = (o: Record<string, unknown>) => ({
  advanceId: 'a1', claimNumber: 'ADV-1', claimantId: 'u1', claimantName: 'Budi Field', projectId: null, projectName: null,
  currency: 'IDR', amount: 500, settled: 0, returned: 0, outstanding: 100, paidOn: '2026-09-01', ageDays: 10, bucket: '0-30', ...o,
});
const renderCard = () => render(<MemoryRouter><AdvanceAgingCard /></MemoryRouter>);

beforeEach(() => { h.aging.isError = false; h.aging.isPending = false; });

describe('AdvanceAgingCard', () => {
  it('AC-EXP-063 shows bucket totals per currency and the rows', () => {
    h.aging.data = { rows: [row({}), row({ advanceId: 'a2', claimNumber: 'ADV-2', outstanding: 200.5, ageDays: 45, bucket: '31-60' })], truncated: false };
    renderCard();
    expect(screen.getByTestId('aging-IDR-0-30')).toHaveTextContent(formatCurrencyCents(100, 'IDR'));
    expect(screen.getByTestId('aging-IDR-31-60')).toHaveTextContent(formatCurrencyCents(200.5, 'IDR'));
    expect(screen.getByRole('link', { name: 'ADV-2' })).toHaveAttribute('href', '/expenses/a2');
  });
  it('AC-EXP-063 renders nothing when no advance is outstanding', () => {
    h.aging.data = { rows: [], truncated: false };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });
  it('AC-EXP-063 a failed read shows an error, never an empty state', () => {
    h.aging.data = undefined;
    h.aging.isError = true;
    renderCard();
    expect(screen.getByText("Couldn't load outstanding advances")).toBeInTheDocument();
  });
});
```

**Verify (RED):** cannot resolve `./AdvanceAgingCard`.

### Task 30 — GREEN: `pmo-portal/pages/expenses/AdvanceAgingCard.tsx`

```tsx
import React from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, CardPad, ListState } from '@/src/components/ui';
import { useExpenseAdvanceAging } from '@/src/hooks/useExpenseClaims';
import { formatCurrencyCents } from '@/src/lib/format';
import { AGING_BUCKETS, agingTotals } from '@/src/lib/expenses/expenseRules';
import { AGING_LIMIT } from '@/src/lib/db/expenseClaims';
import { agingBucketLabel } from './expenseLabels';

/** Advances outstanding (FR-EXP-062, DD-EXP-7). RLS scopes the rows: a claimant sees their own; approval rank sees
 *  all. Hidden when nothing is outstanding; a failed read is an error, never a fabricated empty. */
export const AdvanceAgingCard: React.FC = () => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useExpenseAdvanceAging();
  if (isPending) return null;
  if (isError || !data) {
    return (
      <div className="mb-4">
        <ListState
          variant="error"
          title={t('expenses.aging.errorTitle', "Couldn't load outstanding advances")}
          sub={t('expenses.aging.errorSub', 'The list below is unaffected. Try again.')}
          onRetry={() => void refetch()}
        />
      </div>
    );
  }
  if (data.rows.length === 0) return null;
  const totals = agingTotals(data.rows);
  return (
    <section aria-label={t('expenses.aging.title', 'Advances outstanding')} className="mb-4">
      <Card variant="bare">
        <CardHead>{t('expenses.aging.title', 'Advances outstanding')}</CardHead>
        <CardPad>
          {Object.entries(totals).map(([currency, buckets]) => (
            <dl key={currency} className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {AGING_BUCKETS.map((bucket) => (
                <div key={bucket}>
                  <dt className="text-xs text-muted-foreground">{agingBucketLabel(bucket, t)}</dt>
                  <dd className="font-semibold tabular-nums" data-testid={`aging-${currency}-${bucket}`}>
                    {formatCurrencyCents(buckets[bucket], currency)}
                  </dd>
                </div>
              ))}
            </dl>
          ))}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">{t('expenses.aging.columns.advance', 'Advance')}</th>
                <th className="py-1 font-medium">{t('expenses.aging.columns.claimant', 'Claimant')}</th>
                <th className="py-1 font-medium">{t('expenses.aging.columns.project', 'Project')}</th>
                <th className="py-1 text-right font-medium">{t('expenses.aging.columns.outstanding', 'Outstanding')}</th>
                <th className="py-1 text-right font-medium">{t('expenses.aging.columns.age', 'Age (days)')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.advanceId} className="border-t border-border">
                  <td className="py-1.5">
                    <Link to={`/expenses/${r.advanceId}`} className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      {r.claimNumber ?? '—'}
                    </Link>
                  </td>
                  <td className="py-1.5">{r.claimantName ?? '—'}</td>
                  <td className="py-1.5">{r.projectName ?? t('expenses.overhead', 'Overhead')}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCurrencyCents(r.outstanding, r.currency)}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.ageDays ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.truncated && (
            <p role="status" className="mt-2 text-sm text-muted-foreground">
              {t('expenses.aging.truncated', 'Showing the oldest {{count}} advances.', { count: AGING_LIMIT })}
            </p>
          )}
        </CardPad>
      </Card>
    </section>
  );
};
```

**Verify (GREEN):** `…npx vitest run pages/expenses/AdvanceAgingCard.test.tsx` → green.

### Task 31 — GREEN: `pmo-portal/pages/ExpenseClaims.tsx`

```tsx
import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, DataTable, Icon, ListPage, ListState, SelectField, StatusPill, useToast, type Column } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useProjects } from '@/src/hooks/useProjects';
import { useExpenseClaims, useExpenseClaimMutations } from '@/src/hooks/useExpenseClaims';
import { Constants } from '@/src/lib/supabase/database.types';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrencyCents } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import {
  EXPENSE_LIST_LIMIT, type BudgetCategory, type ExpenseClaimFilters, type ExpenseClaimStatus,
  type ExpenseClaimWithRefs, type ExpenseKind,
} from '@/src/lib/db/expenseClaims';
import { ExpenseClaimFormModal } from './expenses/ExpenseClaimFormModal';
import { AdvanceAgingCard } from './expenses/AdvanceAgingCard';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';
import { expenseKindLabel, expenseStatusLabel } from './expenses/expenseLabels';

/**
 * Expenses — claims and cash advances (#775, FR-EXP-060..062). Reads are RLS-scoped: an Engineer sees their own,
 * approval rank sees the org's. Filters are server-side; the list is bounded at 200 with a visible notice.
 */
const ExpenseClaims: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const may = usePermission();
  const { toast } = useToast();
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const filters = useMemo<ExpenseClaimFilters>(
    () => ({
      ...(status ? { status: status as ExpenseClaimStatus } : {}),
      ...(kind ? { kind: kind as ExpenseKind } : {}),
      ...(category ? { budgetCategory: category as BudgetCategory } : {}),
    }),
    [status, kind, category],
  );
  const { data, isPending, isError, refetch } = useExpenseClaims(filters);
  const { data: projects } = useProjects();
  const { create } = useExpenseClaimMutations();
  const advanceOptions = useOwnAdvanceOptions();
  const [formKind, setFormKind] = useState<ExpenseKind | null>(null);
  const canCreate = may('create', 'expenseClaim');
  const rows = data?.rows ?? [];
  const projectOptions = useMemo(() => (projects ?? []).map((p) => ({ value: p.id, label: p.name })), [projects]);

  const statusOptions = [
    { value: '', label: t('expenses.filters.allStatuses', 'All statuses') },
    ...Constants.public.Enums.expense_claim_status.map((s) => ({ value: s, label: expenseStatusLabel(s, t) })),
  ];
  const kindOptions = [
    { value: '', label: t('expenses.filters.allKinds', 'Claims and advances') },
    { value: 'claim', label: expenseKindLabel('claim', t) },
    { value: 'advance', label: expenseKindLabel('advance', t) },
  ];
  const categoryOptions = [
    { value: '', label: t('expenses.filters.allCategories', 'All categories') },
    ...Constants.public.Enums.budget_category.map((c) => ({ value: c, label: budgetCategoryLabel(c, t) })),
  ];

  const columns: Column<ExpenseClaimWithRefs>[] = [
    { key: 'claim_number', header: t('expenses.columns.number', 'Number'),
      cell: (r) => <span className="whitespace-nowrap font-medium">{r.claim_number ?? t('expenses.draftNumber', 'Draft')}</span>,
      exportValue: (r) => r.claim_number ?? '' },
    { key: 'kind', header: t('expenses.columns.kind', 'Type'), cell: (r) => expenseKindLabel(r.kind, t), exportValue: (r) => r.kind },
    { key: 'title', header: t('expenses.columns.title', 'Title'),
      cell: (r) => <span className="truncate" title={r.title}>{r.title}</span>, exportValue: (r) => r.title },
    { key: 'claimant', header: t('expenses.columns.claimant', 'Claimant'),
      cell: (r) => r.claimant?.full_name ?? '—', exportValue: (r) => r.claimant?.full_name ?? '' },
    { key: 'project', header: t('expenses.columns.project', 'Project'),
      cell: (r) => r.project?.name ?? t('expenses.overhead', 'Overhead'), exportValue: (r) => r.project?.name ?? '' },
    { key: 'budget_category', header: t('expenses.columns.category', 'Budget category'),
      cell: (r) => (r.budget_category ? budgetCategoryLabel(r.budget_category, t) : '—'), exportValue: (r) => r.budget_category ?? '' },
    { key: 'amount', header: t('expenses.columns.amount', 'Amount'), align: 'right',
      cell: (r) => <span className="tabular-nums">{formatCurrencyCents(Number(r.amount), r.currency)}</span>,
      exportValue: (r) => Number(r.amount) },
    { key: 'status', header: t('expenses.columns.status', 'Status'),
      cell: (r) => <StatusPill variant={workflowVariant(r.status)}>{expenseStatusLabel(r.status, t)}</StatusPill>,
      exportValue: (r) => r.status },
  ];

  return (
    <ListPage
      title={t('expenses.title', 'Expenses')}
      description={t('expenses.description', 'Expense claims and cash advances. You see your own; approvers see the whole team.')}
      primaryAction={
        canCreate && (
          <span className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setFormKind('advance')}>{t('expenses.actions.requestAdvance', 'Request advance')}</Button>
            <Button variant="primary" onClick={() => setFormKind('claim')}>
              <Icon name="plus" />
              {t('expenses.actions.newClaim', 'New claim')}
            </Button>
          </span>
        )
      }
      filters={
        <span className="flex flex-wrap gap-2">
          <SelectField label={t('expenses.filters.status', 'Status')} hideLabel value={status} onChange={setStatus} options={statusOptions} />
          <SelectField label={t('expenses.filters.kind', 'Type')} hideLabel value={kind} onChange={setKind} options={kindOptions} />
          <SelectField label={t('expenses.filters.category', 'Budget category')} hideLabel value={category} onChange={setCategory} options={categoryOptions} />
        </span>
      }
    >
      <AdvanceAgingCard />
      {isPending && <ListState variant="loading" rows={6} />}
      {!isPending && (isError || !data) && (
        <ListState
          variant="error"
          title={t('expenses.states.errorTitle', "Couldn't load expenses")}
          sub={t('expenses.states.errorSub', 'The request failed. Check your connection and try again.')}
          onRetry={() => void refetch()}
        />
      )}
      {!isPending && !isError && data && (
        <>
          {data.truncated && (
            <p role="status" className="mb-2 text-sm text-muted-foreground">
              {t('expenses.truncated', 'Showing the latest {{count}}. Narrow the filters to see older records.', { count: EXPENSE_LIST_LIMIT })}
            </p>
          )}
          <DataTable<ExpenseClaimWithRefs>
            rows={rows}
            columns={columns}
            rowKey={(r) => r.id}
            onActivate={(r) => navigate(`/expenses/${r.id}`)}
            rowLabel={(r) => t('expenses.table.rowLabel', 'Open {{title}}', { title: r.title })}
            state={rows.length === 0 ? 'empty' : undefined}
            emptyTitle={t('expenses.table.emptyTitle', 'No expenses here yet')}
            emptySub={t('expenses.table.emptySub', 'File a claim after the work, or request an advance before it.')}
          />
        </>
      )}
      {formKind && (
        <ExpenseClaimFormModal
          kind={formKind}
          projectOptions={projectOptions}
          advanceOptions={advanceOptions}
          onClose={() => setFormKind(null)}
          onSubmit={async (input) => {
            const created = await create.mutateAsync(input);
            toast(t('expenses.toast.created', 'Created'), input.title, 'success');
            setFormKind(null);
            navigate(`/expenses/${created.id}`);
          }}
        />
      )}
    </ListPage>
  );
};

export default ExpenseClaims;
```

**Verify (GREEN):** `…npx vitest run pages/ExpenseClaims.test.tsx pages/expenses/AdvanceAgingCard.test.tsx && npm run typecheck` → green.

### Task 32 — RED: lines card (AC-EXP-062)

Create `pmo-portal/pages/expenses/ExpenseLinesCard.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

const h = vi.hoisted(() => ({
  addLine: { mutateAsync: vi.fn(), isPending: false },
  updateLine: { mutateAsync: vi.fn(), isPending: false },
  removeLine: { mutateAsync: vi.fn(), isPending: false },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaimMutations: () => h }));

import { ExpenseLinesCard } from './ExpenseLinesCard';

const LINE = { id: 'l1', claim_id: 'c1', org_id: 'o', expense_date: '2026-10-01', expense_type: 'Travel', description: 'Taxi', amount: 150000, created_at: '' };
const renderCard = (editable: boolean, lines: unknown[] = []) =>
  render(<ToastProvider><ExpenseLinesCard claimId="c1" lines={lines as never} isPending={false} isError={false} currency="IDR" editable={editable} /></ToastProvider>);

beforeEach(() => { h.addLine.mutateAsync.mockReset().mockResolvedValue({ id: 'l2' }); });

describe('ExpenseLinesCard', () => {
  it('AC-EXP-062 adding a line sends the parsed amount', async () => {
    renderCard(true);
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Date/), { target: { value: '2026-10-01' } });
    await userEvent.type(within(dialog).getByLabelText(/Description/), 'Taxi to site');
    await userEvent.type(within(dialog).getByLabelText(/Amount/), '150000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    expect(h.addLine.mutateAsync).toHaveBeenCalledWith({
      claimId: 'c1', input: { expenseDate: '2026-10-01', expenseType: 'Travel', description: 'Taxi to site', amount: 150000 },
    });
  });
  it('AC-EXP-062 a zero amount is refused before any write', async () => {
    renderCard(true);
    await userEvent.click(screen.getByRole('button', { name: 'Add line' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Date/), { target: { value: '2026-10-01' } });
    await userEvent.type(within(dialog).getByLabelText(/Description/), 'Taxi');
    await userEvent.type(within(dialog).getByLabelText(/Amount/), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add line' }));
    expect(await within(dialog).findAllByText('Enter an amount greater than zero.')).not.toHaveLength(0);
    expect(h.addLine.mutateAsync).not.toHaveBeenCalled();
  });
  it('AC-EXP-062 read-only shows lines and no add/edit/remove', () => {
    renderCard(false, [LINE]);
    expect(screen.getByText('Taxi')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add line' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Edit line/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove line/ })).toBeNull();
  });
});
```

**Verify (RED):** cannot resolve `./ExpenseLinesCard`.

### Task 33 — GREEN: `pmo-portal/pages/expenses/ExpenseLinesCard.tsx`

```tsx
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button, Card, CardHead, CardPad, ConfirmDialog, EntityFormModal, FormGrid, FormSection, ListState, SelectField,
  TextField, useEntityForm, useToast, type SubmitError,
} from '@/src/components/ui';
import { useExpenseClaimMutations } from '@/src/hooks/useExpenseClaims';
import { Constants } from '@/src/lib/supabase/database.types';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrencyCents, formatDateOnly, formatMoneyInputValue, parseMoneyInputAtScale } from '@/src/lib/format';
import type { ExpenseClaimLineRow, ExpenseLineInput, ExpenseType } from '@/src/lib/db/expenseClaims';
import { expenseTypeLabel } from './expenseLabels';

/** A claim's lines (FR-EXP-003/063). Editable only by the claimant while Draft/Rejected (RLS is the authority);
 *  the claim total is the server's Σ lines — the footer sum here is display, in integer cents. */
export interface ExpenseLinesCardProps {
  claimId: string;
  lines: ExpenseClaimLineRow[];
  isPending: boolean;
  isError: boolean;
  currency: string;
  editable: boolean;
}

export const ExpenseLinesCard: React.FC<ExpenseLinesCardProps> = ({ claimId, lines, isPending, isError, currency, editable }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { addLine, updateLine, removeLine } = useExpenseClaimMutations();
  const [editing, setEditing] = useState<ExpenseClaimLineRow | 'new' | null>(null);
  const [removeTarget, setRemoveTarget] = useState<ExpenseClaimLineRow | null>(null);
  const totalCents = lines.reduce((sum, l) => sum + Math.round(Number(l.amount) * 100), 0);

  const confirmRemove = async () => {
    if (!removeTarget) return;
    try {
      await removeLine.mutateAsync(removeTarget.id);
      setRemoveTarget(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <Card variant="bare" className="mb-4">
      <CardHead>
        <span>{t('expenses.lines.title', 'Lines')}</span>
        {editable && (
          <span className="ml-auto">
            <Button variant="outline" size="sm" onClick={() => setEditing('new')}>{t('expenses.lines.add', 'Add line')}</Button>
          </span>
        )}
      </CardHead>
      <CardPad>
        {isPending ? (
          <ListState variant="loading" rows={2} />
        ) : isError ? (
          <p role="alert" className="text-sm text-destructive">{t('expenses.lines.error', "Couldn't load the lines.")}</p>
        ) : lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('expenses.lines.empty', 'No lines yet. Add one per receipt.')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-1 font-medium">{t('expenses.lines.columns.date', 'Date')}</th>
                <th className="py-1 font-medium">{t('expenses.lines.columns.type', 'Type')}</th>
                <th className="py-1 font-medium">{t('expenses.lines.columns.description', 'Description')}</th>
                <th className="py-1 text-right font-medium">{t('expenses.lines.columns.amount', 'Amount')}</th>
                {editable && <th className="py-1" />}
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id} className="border-t border-border">
                  <td className="whitespace-nowrap py-1.5">{formatDateOnly(l.expense_date)}</td>
                  <td className="py-1.5">{expenseTypeLabel(l.expense_type, t)}</td>
                  <td className="py-1.5">{l.description}</td>
                  <td className="py-1.5 text-right tabular-nums">{formatCurrencyCents(Number(l.amount), currency)}</td>
                  {editable && (
                    <td className="whitespace-nowrap py-1.5 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setEditing(l)}
                        aria-label={t('expenses.lines.editAria', 'Edit line {{description}}', { description: l.description })}>
                        {t('expenses.lines.edit', 'Edit')}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(l)}
                        aria-label={t('expenses.lines.removeAria', 'Remove line {{description}}', { description: l.description })}>
                        {t('expenses.lines.remove', 'Remove')}
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-1.5" colSpan={3}>{t('expenses.lines.total', 'Total')}</td>
                <td className="py-1.5 text-right tabular-nums" data-testid="lines-total">{formatCurrencyCents(totalCents / 100, currency)}</td>
                {editable && <td />}
              </tr>
            </tfoot>
          </table>
        )}
      </CardPad>
      {editing && (
        <ExpenseLineFormModal
          initial={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (input) => {
            if (editing === 'new') await addLine.mutateAsync({ claimId, input });
            else await updateLine.mutateAsync({ id: editing.id, input });
            setEditing(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removeTarget !== null}
        tone="destructive"
        title={t('expenses.lines.removeTitle', 'Remove this line?')}
        description={removeTarget?.description ?? ''}
        confirmLabel={t('expenses.lines.remove', 'Remove')}
        loading={removeLine.isPending}
        onConfirm={() => void confirmRemove()}
        onCancel={() => setRemoveTarget(null)}
      />
    </Card>
  );
};

interface LineValues { expenseDate: string; expenseType: string; description: string; amount: string }

const ExpenseLineFormModal: React.FC<{
  initial: ExpenseClaimLineRow | null;
  onClose: () => void;
  onSubmit: (input: ExpenseLineInput) => Promise<void>;
}> = ({ initial, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const validate = useMemo(
    () => (v: LineValues): Partial<Record<keyof LineValues, string>> => {
      const e: Partial<Record<keyof LineValues, string>> = {};
      if (!v.expenseDate) e.expenseDate = t('expenses.lines.errors.dateRequired', 'Enter the date of the expense.');
      if (!v.description.trim()) e.description = t('expenses.lines.errors.descriptionRequired', 'Describe the expense.');
      const amount = parseMoneyInputAtScale(v.amount, 2);
      if (amount === null || !(amount > 0)) e.amount = t('expenses.lines.errors.amountPositive', 'Enter an amount greater than zero.');
      return e;
    },
    [t],
  );
  const form = useEntityForm<LineValues>({
    initialValues: {
      expenseDate: initial?.expense_date ?? '',
      expenseType: initial?.expense_type ?? 'Travel',
      description: initial?.description ?? '',
      amount: initial ? formatMoneyInputValue(Number(initial.amount)) : '',
    },
    validate,
    idPrefix: 'expense-line',
    requiredFields: ['expenseDate', 'description', 'amount'],
    module: 'expenses',
  });
  const dateField = form.fieldProps('expenseDate');
  const typeField = form.fieldProps('expenseType');
  const descField = form.fieldProps('description');
  const amountField = form.fieldProps('amount');
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const errorSummary = [
    form.errors.expenseDate ? { fieldId: dateField.id, message: form.errors.expenseDate } : null,
    form.errors.description ? { fieldId: descField.id, message: form.errors.description } : null,
    form.errors.amount ? { fieldId: amountField.id, message: form.errors.amount } : null,
  ].filter((item): item is { fieldId: string; message: string } => item !== null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit(async (v) => {
      const input: ExpenseLineInput = {
        expenseDate: v.expenseDate,
        expenseType: v.expenseType as ExpenseType,
        description: v.description.trim(),
        amount: parseMoneyInputAtScale(v.amount, 2) as number,
      };
      try {
        await onSubmit(input);
      } catch (err) {
        const { headline, detail } = classifyMutationError(err);
        setSaveError({ headline, detail });
      }
    });
  };

  return (
    <EntityFormModal
      open
      title={initial ? t('expenses.lines.editTitle', 'Edit line') : t('expenses.lines.addTitle', 'Add a line')}
      submitLabel={initial ? t('expenses.lines.save', 'Save line') : t('expenses.lines.add', 'Add line')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={errorSummary}
      submitError={saveError}
    >
      <FormSection legend={t('expenses.lines.sectionLegend', 'Expense')}>
        <FormGrid>
          <TextField id={dateField.id} type="date" required label={t('expenses.lines.date', 'Date')} value={dateField.value}
            onChange={dateField.onChange} onBlur={dateField.onBlur} error={dateField.error} />
          <SelectField id={typeField.id} label={t('expenses.lines.type', 'Type')} value={typeField.value}
            onChange={(v) => typeField.onChange(v)} onBlur={typeField.onBlur}
            options={Constants.public.Enums.expense_type.map((x) => ({ value: x, label: expenseTypeLabel(x, t) }))} />
          <TextField id={descField.id} required label={t('expenses.lines.description', 'Description')} value={descField.value}
            onChange={descField.onChange} onBlur={descField.onBlur} error={descField.error} fullWidth />
          <TextField id={amountField.id} required inputMode="decimal" label={t('expenses.lines.amount', 'Amount')}
            value={amountField.value} onChange={amountField.onChange} onBlur={amountField.onBlur} error={amountField.error} />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};
```

**Verify (GREEN):** `…npx vitest run pages/expenses/ExpenseLinesCard.test.tsx` → green.

### Task 34 — RED: receipts card (AC-EXP-066)

Create `pmo-portal/pages/expenses/ExpenseReceiptsCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';

vi.mock('@/src/hooks/useExpenseReceipts', () => ({
  useExpenseReceipts: () => ({
    list: { data: [{ id: 'f1', file_path: 'org/c1/f/receipt.pdf', title: null }], isPending: false, isError: false },
    upload: { mutate: vi.fn(), isPending: false },
    archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(),
    progress: null,
    uploadError: null,
    clearUploadError: vi.fn(),
  }),
}));

import { ExpenseReceiptsCard } from './ExpenseReceiptsCard';

describe('ExpenseReceiptsCard', () => {
  it('AC-EXP-066 every viewer can download; only a writer can attach or remove', () => {
    const { rerender } = render(<ToastProvider><ExpenseReceiptsCard claimId="c1" canWrite={false} /></ToastProvider>);
    expect(screen.getByText('receipt.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download receipt.pdf' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach receipt' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove receipt.pdf' })).toBeNull();
    rerender(<ToastProvider><ExpenseReceiptsCard claimId="c1" canWrite /></ToastProvider>);
    expect(screen.getByRole('button', { name: 'Attach receipt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove receipt.pdf' })).toBeInTheDocument();
  });
});
```

**Verify (RED):** cannot resolve `./ExpenseReceiptsCard`.

### Task 35 — GREEN: `pmo-portal/pages/expenses/ExpenseReceiptsCard.tsx`

```tsx
import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ConfirmDialog, Icon, useToast } from '@/src/components/ui';
import { useExpenseReceipts } from '@/src/hooks/useExpenseReceipts';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { RECEIPT_INPUT_ACCEPT, type ExpenseReceiptRow } from '@/src/lib/db/expenseReceipts';

/** Receipts on a claim or advance (FR-EXP-005/063). Storage RLS (0247 §5) is the authority; `canWrite` is UX. */
export interface ExpenseReceiptsCardProps {
  claimId: string;
  canWrite: boolean;
}

const fileName = (path: string | null): string => (path ? path.split('/').pop() || 'receipt' : 'receipt');

export const ExpenseReceiptsCard: React.FC<ExpenseReceiptsCardProps> = ({ claimId, canWrite }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { list, upload, archive, download, progress, uploadError, clearUploadError } = useExpenseReceipts(claimId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingRemove, setPendingRemove] = useState<ExpenseReceiptRow | null>(null);
  const files = list.data ?? [];

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    clearUploadError();
    upload.mutate(file, {
      onSuccess: () => toast(t('expenses.receipts.attached', 'Receipt attached'), file.name, 'success'),
    });
  };

  const open = async (f: ExpenseReceiptRow) => {
    try {
      window.open(await download(f.file_path, { download: true }), '_blank', 'noopener,noreferrer');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  const confirmRemove = () => {
    if (!pendingRemove) return;
    const target = pendingRemove;
    setPendingRemove(null);
    archive.mutate(target.id, {
      onSuccess: () => toast(t('expenses.receipts.removed', 'Receipt removed'), undefined, 'success'),
      onError: (err: unknown) => {
        const { headline, detail } = classifyMutationError(err);
        toast(headline, detail, 'warning');
      },
    });
  };

  return (
    <Card variant="bare" className="mb-4">
      <CardHead>
        <span>{t('expenses.receipts.title', 'Receipts')}</span>
        {canWrite && (
          <span className="ml-auto">
            <input ref={inputRef} type="file" accept={RECEIPT_INPUT_ACCEPT} className="sr-only" tabIndex={-1}
              aria-label={t('expenses.receipts.attachAria', 'Choose a receipt file')} onChange={onPick} />
            <Button variant="outline" size="sm" disabled={progress !== null} onClick={() => inputRef.current?.click()}>
              <Icon name="upload" />
              {progress !== null
                ? t('expenses.receipts.uploading', 'Uploading {{percent}}%', { percent: progress })
                : t('expenses.receipts.attach', 'Attach receipt')}
            </Button>
          </span>
        )}
      </CardHead>
      <CardPad>
        {list.isPending ? (
          <p className="text-sm text-muted-foreground">{t('expenses.receipts.loading', 'Loading receipts…')}</p>
        ) : list.isError ? (
          <p role="alert" className="text-sm text-destructive">{t('expenses.receipts.error', "Couldn't load receipts.")}</p>
        ) : files.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('expenses.receipts.empty', 'No receipts attached.')}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {files.map((f) => {
              const name = fileName(f.file_path);
              return (
                <li key={f.id} className="flex items-center gap-2 text-sm">
                  <Icon name="file" className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate" title={name}>{name}</span>
                  <span className="ml-auto flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void open(f)}
                      aria-label={t('expenses.receipts.download', 'Download {{name}}', { name })}>
                      <Icon name="download" />
                    </Button>
                    {canWrite && (
                      <Button variant="ghost" size="sm" onClick={() => setPendingRemove(f)}
                        aria-label={t('expenses.receipts.remove', 'Remove {{name}}', { name })}>
                        <Icon name="x" />
                      </Button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {uploadError && <p role="alert" className="mt-2 text-sm text-destructive">{uploadError.message}</p>}
      </CardPad>
      <ConfirmDialog
        open={pendingRemove !== null}
        tone="destructive"
        title={t('expenses.receipts.removeTitle', 'Remove this receipt?')}
        description={t('expenses.receipts.removeDescription', 'It is removed from this claim. You can attach it again.')}
        confirmLabel={t('expenses.receipts.removeConfirm', 'Remove')}
        loading={archive.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
    </Card>
  );
};
```

**Verify (GREEN):** `…npx vitest run pages/expenses/ExpenseReceiptsCard.test.tsx && npm run typecheck` → green.

**Continue with `docs/plans/2026-10-06-expense-claims.part5-fe-ship.md`.**

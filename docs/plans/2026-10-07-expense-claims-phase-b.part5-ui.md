# Plan part 5 — #775 phase B: UI (Tasks F1–F8)

Part of [`2026-10-07-expense-claims-phase-b.md`](2026-10-07-expense-claims-phase-b.md). Conventions: §1.8 there.
Run from `pmo-portal/`; vitest as `../scripts/with-test-lock.sh npx vitest run <file>`. UX only — the server
(0263 RLS, `external-set-company`, the sweep gate) is the authority (ADR-0016). Strictly `DESIGN.md` tokens.

---

### F1 — RED: reads (AC-EXP-132)

Create `src/lib/repositories/expensePostings.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order', 'limit']) {
    chain[m] = (...args: unknown[]) => { calls.push([m, args]); return chain; };
  }
  chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return { calls, from: vi.fn((table: string) => { calls.push(['from', [table]]); return chain; }), set: (r: typeof result) => { result = r; } };
});
vi.mock('@/src/lib/supabase/client', () => ({ supabase: { from: h.from } }));

import { listExpenseAccountMap, listExpensePostings } from './expensePostings';

beforeEach(() => { h.calls.length = 0; h.set({ data: [], error: null }); });

describe('expense posting reads (AC-EXP-132)', () => {
  it('AC-EXP-132 reads a claim\'s postings oldest first and maps them', async () => {
    h.set({ data: [{ id: 'm1', posting: 'approval', push_state: 'pushed', push_error: null, erp_name: 'ACC-JV-2026-00002',
      erp_cancelled_at: null, created_at: '2026-10-07T10:00:00Z' }], error: null });
    expect(await listExpensePostings('claim-1')).toEqual([{ id: 'm1', posting: 'approval', pushState: 'pushed', pushError: null,
      erpName: 'ACC-JV-2026-00002', erpCancelledAt: null, createdAt: '2026-10-07T10:00:00Z' }]);
    expect(h.calls).toContainEqual(['from', ['expense_posting_erp_mirror']]);
    expect(h.calls).toContainEqual(['eq', ['claim_id', 'claim-1']]);
    expect(h.calls).toContainEqual(['order', ['created_at', { ascending: true }]]);
  });

  it('AC-EXP-132 reads the account map', async () => {
    h.set({ data: [{ account_key: 'employee_payable', erp_account: 'Employee Payable - PSC', updated_at: 't' }], error: null });
    expect(await listExpenseAccountMap()).toEqual([{ accountKey: 'employee_payable', erpAccount: 'Employee Payable - PSC', updatedAt: 't' }]);
    expect(h.calls).toContainEqual(['from', ['expense_account_map']]);
  });

  it('AC-EXP-132 a read error throws with its code', async () => {
    h.set({ data: null, error: { message: 'permission denied', code: '42501' } });
    await expect(listExpensePostings('claim-1')).rejects.toMatchObject({ code: '42501' });
    await expect(listExpenseAccountMap()).rejects.toMatchObject({ code: '42501' });
  });
});
```

Verify RED: cannot resolve `./expensePostings`.

### F2 — GREEN: `src/lib/repositories/expensePostings.ts` + Admin actions (FR-EXP-116/117)

```ts
/**
 * #775 phase B — client reads of the expense posting side mirror (0263 §3) and the account map (0263 §2). Both
 * are SELECT-only for clients; RLS scopes them (the claim's audience / the org). Writes to the map go through
 * `repositories.integrations.saveExpenseAccount` (the validating edge action), never a table write.
 */
import { supabase } from '@/src/lib/supabase/client';
import { AppError } from '@/src/lib/appError';
import type { ExpenseAccountKey } from '@/src/lib/adapterSeam/erpnext/expenseAccountRules';

export type ExpensePostingKind = 'approval' | 'claim-payment' | 'settlement' | 'advance-payment' | 'advance-return' | 'approval-cancel';
export type ExpensePushState = 'pending' | 'failed' | 'held' | 'pushed';

export interface ExpensePostingRow {
  id: string;
  posting: ExpensePostingKind;
  pushState: ExpensePushState;
  pushError: string | null;
  erpName: string | null;
  erpCancelledAt: string | null;
  createdAt: string;
}

export interface ExpenseAccountMapRow {
  accountKey: ExpenseAccountKey;
  erpAccount: string;
  updatedAt: string;
}

/** A claim has at most 6 postings (and an advance one per return) — 50 is a generous, bounded read. */
export async function listExpensePostings(claimId: string): Promise<ExpensePostingRow[]> {
  const { data, error } = await supabase
    .from('expense_posting_erp_mirror')
    .select('id, posting, push_state, push_error, erp_name, erp_cancelled_at, created_at')
    .eq('claim_id', claimId)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => ({
    id: r.id,
    posting: r.posting as ExpensePostingKind,
    pushState: r.push_state as ExpensePushState,
    pushError: r.push_error,
    erpName: r.erp_name,
    erpCancelledAt: r.erp_cancelled_at,
    createdAt: r.created_at,
  }));
}

export async function listExpenseAccountMap(): Promise<ExpenseAccountMapRow[]> {
  const { data, error } = await supabase
    .from('expense_account_map')
    .select('account_key, erp_account, updated_at')
    .order('account_key', { ascending: true });
  if (error) throw new AppError(error.message, error.code);
  return (data ?? []).map((r) => ({ accountKey: r.account_key as ExpenseAccountKey, erpAccount: r.erp_account, updatedAt: r.updated_at }));
}
```

`src/lib/repositories/types.ts` — in `IntegrationsRepository`, after `employErpDomain…;` add (and import
`ExpenseAccountKey` from `@/src/lib/adapterSeam/erpnext/expenseAccountRules`):

```ts
  /** #775 phase B — save one key of the expense account map (validated against ERPNext server-side, FR-EXP-112). */
  saveExpenseAccount(input: { accountKey: ExpenseAccountKey; erpAccount: string }): Promise<{ ok: true }>;
  /** #775 phase B — remove one key of the expense account map. */
  clearExpenseAccount(accountKey: ExpenseAccountKey): Promise<{ ok: true }>;
```

`src/lib/repositories/index.ts` — in `integrationsImpl`, after `employErpDomain: …,`:

```ts
  saveExpenseAccount: (input) => erpSetupRequest<{ ok: true }>('save-expense-account', input),
  clearExpenseAccount: (accountKey) => erpSetupRequest<{ ok: true }>('clear-expense-account', { accountKey }),
```

Verify GREEN: `../scripts/with-test-lock.sh npx vitest run src/lib/repositories/expensePostings.test.ts` → 3 passed;
`npm run typecheck` → 0. If typecheck names a test double typed as `IntegrationsRepository` (e.g.
`src/components/integrations/IntegrationsView.test.tsx`'s `erpSetup` object), add
`saveExpenseAccount: vi.fn(async () => ({ ok: true as const })), clearExpenseAccount: vi.fn(async () => ({ ok: true as const })),`
to that object and nothing else.

### F3 — RED: Admin › Expense account map (AC-EXP-130)

Create `pages/admin/ExpenseAccountMap.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { Role } from '@/src/auth/AuthContext';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/src/components/ui';

const { listMock, saveMock, clearMock } = vi.hoisted(() => ({ listMock: vi.fn(), saveMock: vi.fn(), clearMock: vi.fn() }));
vi.mock('@/src/lib/repositories/expensePostings', () => ({ listExpenseAccountMap: listMock }));
vi.mock('@/src/lib/repositories', () => ({ repositories: { integrations: { saveExpenseAccount: saveMock, clearExpenseAccount: clearMock } } }));
let realRole: Role = 'Admin';
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole, effectiveRole: realRole }) }));

import ExpenseAccountMap from './ExpenseAccountMap';

const renderPage = (role: Role = 'Admin') => {
  realRole = role;
  return render(
    <MemoryRouter initialEntries={['/administration/accounting']}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider><ExpenseAccountMap /></ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
};

beforeEach(() => {
  listMock.mockReset().mockResolvedValue([{ accountKey: 'employee_payable', erpAccount: 'Employee Payable - PSC', updatedAt: 't' }]);
  saveMock.mockReset().mockResolvedValue({ ok: true });
  clearMock.mockReset().mockResolvedValue({ ok: true });
});

describe('ExpenseAccountMap (AC-EXP-130)', () => {
  it('AC-EXP-130 renders all seven keys, mapped or flagged', async () => {
    renderPage();
    expect(await screen.findByText('Employee Payable - PSC')).toBeInTheDocument();
    const rows = screen.getAllByTestId('expense-account-row');
    expect(rows).toHaveLength(7);
    expect(within(rows[1]).getByText('Not mapped — expense posting stops')).toBeInTheDocument();
  });

  it('AC-EXP-130 an Admin saves a key with the trimmed account', async () => {
    renderPage();
    await screen.findByText('Employee Payable - PSC');
    await userEvent.click(screen.getByRole('button', { name: 'Map Employee advances' }));
    await userEvent.type(screen.getByLabelText(/ERP account/), '  Employee Advances - PSC  ');
    await userEvent.click(screen.getByRole('button', { name: 'Save account' }));
    await waitFor(() => expect(saveMock).toHaveBeenCalledWith({ accountKey: 'employee_advance', erpAccount: 'Employee Advances - PSC' }));
  });

  it('AC-EXP-130 the server refusal is shown in the form', async () => {
    saveMock.mockRejectedValue(Object.assign(new Error('employee_payable: Creditors - PSC is the company\'s supplier payable account; use a separate employee payable account'), { code: 'config-rejected' }));
    renderPage();
    await screen.findByText('Employee Payable - PSC');
    await userEvent.click(screen.getByRole('button', { name: 'Change Employee payable' }));
    await userEvent.clear(screen.getByLabelText(/ERP account/));
    await userEvent.type(screen.getByLabelText(/ERP account/), 'Creditors - PSC');
    await userEvent.click(screen.getByRole('button', { name: 'Save account' }));
    expect((await screen.findAllByText(/supplier payable account/)).length).toBeGreaterThan(0);
  });

  it('AC-EXP-130 a non-Admin sees the map but no actions', async () => {
    renderPage('Finance');
    expect(await screen.findByText('Employee Payable - PSC')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Map|Change|Clear) / })).toBeNull();
  });
});
```

Verify RED: cannot resolve `./ExpenseAccountMap`.

### F4 — GREEN: `pages/admin/ExpenseAccountMap.tsx` + mount (FR-EXP-116)

```tsx
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button, ConfirmDialog, EntityFormModal, FormGrid, FormSection, ListState, StatusPill, TextField, useEntityForm, useToast,
  type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { repositories } from '@/src/lib/repositories';
import { listExpenseAccountMap, type ExpenseAccountMapRow } from '@/src/lib/repositories/expensePostings';
import { EXPENSE_ACCOUNT_KEYS, type ExpenseAccountKey } from '@/src/lib/adapterSeam/erpnext/expenseAccountRules';

/**
 * Administration › Accounting › Expense account map (#775 phase B, FR-EXP-116). The 7 keys an expense posting needs.
 * Saving goes through `external-set-company`, which reads the account from ERPNext and refuses one that does not fit
 * (FR-EXP-112 — e.g. the supplier payable account, an untyped advance account); its message is shown in the form.
 * Admin-only actions via `can('manage', 'integration')`; the table and the edge action are the authority (ADR-0016).
 */
const ExpenseAccountMap: React.FC = () => {
  const { t } = useTranslation();
  const canManage = usePermission()('manage', 'integration');
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ExpenseAccountKey | null>(null);
  const [clearing, setClearing] = useState<ExpenseAccountKey | null>(null);
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const { data, isPending, isError, refetch } = useQuery<ExpenseAccountMapRow[]>({
    queryKey: ['expense-account-map'],
    queryFn: listExpenseAccountMap,
  });
  const byKey = useMemo(() => new Map((data ?? []).map((r) => [r.accountKey, r.erpAccount])), [data]);
  const label = (key: ExpenseAccountKey): string => ({
    employee_payable: t('admin.expenseMap.key.employeePayable', 'Employee payable'),
    employee_advance: t('admin.expenseMap.key.employeeAdvance', 'Employee advances'),
    Travel: t('admin.expenseMap.key.travel', 'Travel'),
    Accommodation: t('admin.expenseMap.key.accommodation', 'Accommodation'),
    Meals: t('admin.expenseMap.key.meals', 'Meals'),
    'Local transport': t('admin.expenseMap.key.localTransport', 'Local transport'),
    Other: t('admin.expenseMap.key.other', 'Other'),
  })[key];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['expense-account-map'] });
  const save = useMutation({
    mutationFn: (v: { accountKey: ExpenseAccountKey; erpAccount: string }) => repositories.integrations.saveExpenseAccount(v),
    onSuccess: invalidate,
  });
  const clear = useMutation({
    mutationFn: (key: ExpenseAccountKey) => repositories.integrations.clearExpenseAccount(key),
    onSuccess: invalidate,
  });

  if (isPending) return <ListState variant="loading" rows={EXPENSE_ACCOUNT_KEYS.length} testId="expense-account-map-loading" />;
  if (isError) {
    return (
      <ListState variant="error" title={t('admin.expenseMap.error.title', "Couldn't load the expense account map")}
        sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
        retryLabel={t('admin.retry', 'Retry')} onRetry={() => refetch()} />
    );
  }

  return (
    <section id="expense-account-map" aria-label={t('admin.expenseMap.title', 'Expense account map')}>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t('admin.expenseMap.title', 'Expense account map')}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t('admin.expenseMap.description', 'The ERPNext accounts approved expense claims and cash advances post to. A posting that needs an unmapped account stops and is reported.')}
      </p>
      <ul className="mt-3.5 flex flex-col">
        {EXPENSE_ACCOUNT_KEYS.map((key) => {
          const account = byKey.get(key);
          return (
            <li key={key} data-testid="expense-account-row"
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-[13.5px]">
              <span className="font-medium">{label(key)}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                {account
                  ? <span className="break-words">{account}</span>
                  : <StatusPill variant="warn">{t('admin.expenseMap.unmapped', 'Not mapped — expense posting stops')}</StatusPill>}
                {canManage && (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => { setSaveError(null); setEditing(key); }}>
                      {account
                        ? t('admin.expenseMap.change', { defaultValue: 'Change {{key}}', key: label(key) })
                        : t('admin.expenseMap.map', { defaultValue: 'Map {{key}}', key: label(key) })}
                    </Button>
                    {account && (
                      <Button variant="ghost" size="sm" onClick={() => setClearing(key)}>
                        {t('admin.expenseMap.clear', { defaultValue: 'Clear {{key}}', key: label(key) })}
                      </Button>
                    )}
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {editing && (
        <AccountForm
          title={label(editing)}
          initial={byKey.get(editing) ?? ''}
          submitError={saveError}
          onClose={() => setEditing(null)}
          onSubmit={async (erpAccount) => {
            try {
              await save.mutateAsync({ accountKey: editing, erpAccount });
              toast(t('admin.expenseMap.toast.saved', 'Expense account saved'), `${label(editing)} → ${erpAccount}`, 'success');
              setEditing(null);
            } catch (err) {
              const { headline } = classifyMutationError(err);
              const detail = err instanceof Error ? err.message : '';
              setSaveError({ headline, detail });
              toast(headline, detail, 'warning');
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!clearing}
        tone="destructive"
        title={clearing ? t('admin.expenseMap.confirmClear.title', { defaultValue: 'Clear {{key}}?', key: label(clearing) }) : ''}
        description={t('admin.expenseMap.confirmClear.description', 'Postings that need this account will stop until it is mapped again.')}
        confirmLabel={t('admin.expenseMap.confirmClear.confirm', 'Clear')}
        loading={clear.isPending}
        onConfirm={async () => {
          if (!clearing) return;
          try {
            await clear.mutateAsync(clearing);
            setClearing(null);
          } catch (err) {
            const { headline, detail } = classifyMutationError(err);
            toast(headline, detail, 'warning');
          }
        }}
        onCancel={() => setClearing(null)}
      />
    </section>
  );
};

const AccountForm: React.FC<{
  title: string;
  initial: string;
  submitError: SubmitError | null;
  onClose: () => void;
  onSubmit: (erpAccount: string) => Promise<void>;
}> = ({ title, initial, submitError, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const form = useEntityForm<{ erpAccount: string }>({
    initialValues: { erpAccount: initial },
    validate: (v) => (v.erpAccount.trim() ? {} : { erpAccount: t('admin.expenseMap.form.required', 'An ERP account is required.') }),
    idPrefix: 'expense-account-form',
    requiredFields: ['erpAccount'],
    module: 'expense-account-map',
  });
  const field = form.fieldProps('erpAccount');
  return (
    <EntityFormModal
      open
      title={title}
      subtitle={t('admin.expenseMap.form.subtitle', 'ERPNext checks the account before it is saved')}
      submitLabel={t('admin.expenseMap.form.save', 'Save account')}
      onSubmit={(e: React.FormEvent) => { e.preventDefault(); void form.handleSubmit(async (v) => onSubmit(v.erpAccount.trim())); }}
      submitError={submitError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={form.errors.erpAccount ? [{ fieldId: field.id, message: form.errors.erpAccount }] : undefined}
    >
      <FormSection legend={t('admin.expenseMap.form.legend', 'Account')}>
        <FormGrid>
          <TextField id={field.id} label={t('admin.expenseMap.form.account', 'ERP account')} required value={field.value}
            onChange={field.onChange} onBlur={field.onBlur} error={field.error}
            placeholder={t('admin.expenseMap.form.placeholder', 'e.g. Employee Payable - ABC')} fullWidth />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default ExpenseAccountMap;
```

`pages/Administration.tsx`: add `import ExpenseAccountMap from './admin/ExpenseAccountMap';` beside the
`BudgetAccountMap` import, and `<ExpenseAccountMap />` on the line after `<BudgetAccountMap />` in the `'accounting'` case.

Verify GREEN: `../scripts/with-test-lock.sh npx vitest run pages/admin/ExpenseAccountMap.test.tsx pages/AdministrationShell.test.tsx`
→ green. (If `AdministrationShell.test.tsx` mocks the accounting children by module, add
`vi.mock('./admin/ExpenseAccountMap', () => ({ default: () => null }));` beside its BudgetAccountMap mock.)

### F5 — RED: the record's Ledger postings section (AC-EXP-131)

Create `pages/expenses/ExpensePostingsCard.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn() }));
vi.mock('@/src/lib/repositories/expensePostings', () => ({ listExpensePostings: listMock }));

import { ExpensePostingsCard } from './ExpensePostingsCard';

const renderCard = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ExpensePostingsCard claimId="claim-1" />
  </QueryClientProvider>,
);

beforeEach(() => listMock.mockReset());

describe('ExpensePostingsCard (AC-EXP-131)', () => {
  it('AC-EXP-131 lists each posting with its label, state text and ERP document', async () => {
    listMock.mockResolvedValue([
      { id: 'm1', posting: 'approval', pushState: 'pushed', pushError: null, erpName: 'ACC-JV-2026-00002', erpCancelledAt: null, createdAt: 't1' },
      { id: 'm2', posting: 'claim-payment', pushState: 'failed', pushError: 'employee-unlinked: no confirmed link', erpName: null, erpCancelledAt: null, createdAt: 't2' },
    ]);
    renderCard();
    expect(await screen.findByRole('heading', { name: 'Ledger postings' })).toBeInTheDocument();
    expect(screen.getByText('Approval journal')).toBeInTheDocument();
    expect(screen.getByText('Posted')).toBeInTheDocument();
    expect(screen.getByText('ACC-JV-2026-00002')).toBeInTheDocument();
    expect(screen.getByText('Cash payment')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('employee-unlinked: no confirmed link')).toBeInTheDocument();
  });

  it('AC-EXP-131 a posting cancelled in ERPNext says so', async () => {
    listMock.mockResolvedValue([{ id: 'm1', posting: 'approval', pushState: 'pushed', pushError: null, erpName: 'ACC-JV-2026-00002',
      erpCancelledAt: '2026-10-08T00:00:00Z', createdAt: 't1' }]);
    renderCard();
    expect(await screen.findByText('Cancelled in ERPNext')).toBeInTheDocument();
  });

  it('AC-EXP-131 renders nothing when the claim has no postings', async () => {
    listMock.mockResolvedValue([]);
    const { container } = renderCard();
    await vi.waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('AC-EXP-131 a failed read shows the error state', async () => {
    listMock.mockRejectedValue(new Error('boom'));
    renderCard();
    expect(await screen.findByText("Couldn't load ledger postings")).toBeInTheDocument();
  });
});
```

Verify RED: cannot resolve `./ExpensePostingsCard`.

### F6 — GREEN: `pages/expenses/ExpensePostingsCard.tsx` + mount (FR-EXP-117)

```tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { ListState, StatusPill, type StatusVariant } from '@/src/components/ui';
import { listExpensePostings, type ExpensePostingKind, type ExpensePostingRow, type ExpensePushState } from '@/src/lib/repositories/expensePostings';

/**
 * #775 phase B (FR-EXP-117, ADR-0059 §6) — what this claim posted to ERPNext. Supplementary: renders NOTHING when the
 * claim has no postings (a standalone org, or an event before the org employed expenses), never blocks the page.
 * State is text plus a dot (Quiet-Status Rule), never colour alone.
 */
export const ExpensePostingsCard: React.FC<{ claimId: string }> = ({ claimId }) => {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useQuery<ExpensePostingRow[]>({
    queryKey: ['expense-postings', claimId],
    queryFn: () => listExpensePostings(claimId),
  });
  const postingLabel: Record<ExpensePostingKind, string> = {
    approval: t('expenses.postings.kind.approval', 'Approval journal'),
    'claim-payment': t('expenses.postings.kind.claimPayment', 'Cash payment'),
    settlement: t('expenses.postings.kind.settlement', 'Advance settlement'),
    'advance-payment': t('expenses.postings.kind.advancePayment', 'Advance payout'),
    'advance-return': t('expenses.postings.kind.advanceReturn', 'Cash returned'),
    'approval-cancel': t('expenses.postings.kind.approvalCancel', 'Approval cancelled'),
  };
  const stateLabel: Record<ExpensePushState, string> = {
    pending: t('expenses.postings.state.pending', 'Queued'),
    failed: t('expenses.postings.state.failed', 'Failed'),
    held: t('expenses.postings.state.held', 'Needs an operator'),
    pushed: t('expenses.postings.state.pushed', 'Posted'),
  };
  const stateVariant: Record<ExpensePushState, StatusVariant> = { pending: 'progress', failed: 'warn', held: 'overdue', pushed: 'won' };

  if (isPending) return null;
  if (isError) {
    return (
      <ListState variant="error" title={t('expenses.postings.errorTitle', "Couldn't load ledger postings")}
        sub={t('expenses.postings.errorSub', 'The claim itself is unaffected. Try again.')}
        retryLabel={t('admin.retry', 'Retry')} onRetry={() => refetch()} />
    );
  }
  if (!data || data.length === 0) return null;
  return (
    <section aria-labelledby="expense-postings-heading" className="rounded-lg border border-border bg-card p-4">
      <h2 id="expense-postings-heading" className="text-[15px] font-semibold">{t('expenses.postings.title', 'Ledger postings')}</h2>
      <ul className="mt-2 flex flex-col gap-2">
        {data.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13.5px]">
            <span className="font-medium">{postingLabel[row.posting]}</span>
            {row.erpCancelledAt
              ? <StatusPill variant="superseded">{t('expenses.postings.state.cancelledInErp', 'Cancelled in ERPNext')}</StatusPill>
              : <StatusPill variant={stateVariant[row.pushState]}>{stateLabel[row.pushState]}</StatusPill>}
            {row.erpName && <span className="break-all text-muted-foreground">{row.erpName}</span>}
            {row.pushError && row.pushState !== 'pushed' && <span className="break-words text-muted-foreground">{row.pushError}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
};
```

`pages/ExpenseClaimDetail.tsx`: add `import { ExpensePostingsCard } from './expenses/ExpensePostingsCard';` beside the
`ExpenseReceiptsCard` import and `<ExpensePostingsCard claimId={claim.id} />` on the line after
`<ExpenseReceiptsCard claimId={claim.id} canWrite={canEdit} />`.

Verify GREEN: `../scripts/with-test-lock.sh npx vitest run pages/expenses/ExpensePostingsCard.test.tsx pages/ExpenseClaimDetail.test.tsx`
→ green. (If `ExpenseClaimDetail.test.tsx` fails because the card's query is unmocked, add
`vi.mock('./expenses/ExpensePostingsCard', () => ({ ExpensePostingsCard: () => null }));` to it — the card is proven
by its own test.)

### F7 — Strings (NFR-EXP-014)

`public/locales/en/common.json`: inside the existing `"expenses"` object add (alphabetical position):

```json
"postings": {
  "errorSub": "The claim itself is unaffected. Try again.",
  "errorTitle": "Couldn't load ledger postings",
  "kind": { "advancePayment": "Advance payout", "advanceReturn": "Cash returned", "approval": "Approval journal", "approvalCancel": "Approval cancelled", "claimPayment": "Cash payment", "settlement": "Advance settlement" },
  "state": { "cancelledInErp": "Cancelled in ERPNext", "failed": "Failed", "held": "Needs an operator", "pending": "Queued", "pushed": "Posted" },
  "title": "Ledger postings"
}
```

and inside the existing `"admin"` object add:

```json
"expenseMap": {
  "change": "Change {{key}}",
  "clear": "Clear {{key}}",
  "confirmClear": { "confirm": "Clear", "description": "Postings that need this account will stop until it is mapped again.", "title": "Clear {{key}}?" },
  "description": "The ERPNext accounts approved expense claims and cash advances post to. A posting that needs an unmapped account stops and is reported.",
  "error": { "title": "Couldn't load the expense account map" },
  "form": { "account": "ERP account", "legend": "Account", "placeholder": "e.g. Employee Payable - ABC", "required": "An ERP account is required.", "save": "Save account", "subtitle": "ERPNext checks the account before it is saved" },
  "key": { "accommodation": "Accommodation", "employeeAdvance": "Employee advances", "employeePayable": "Employee payable", "localTransport": "Local transport", "meals": "Meals", "other": "Other", "travel": "Travel" },
  "map": "Map {{key}}",
  "title": "Expense account map",
  "toast": { "saved": "Expense account saved" },
  "unmapped": "Not mapped — expense posting stops"
}
```

`public/locales/id/common.json` — same keys:

```json
"postings": {
  "errorSub": "Klaim itu sendiri tidak terpengaruh. Coba lagi.",
  "errorTitle": "Tidak dapat memuat posting buku besar",
  "kind": { "advancePayment": "Pembayaran uang muka", "advanceReturn": "Pengembalian tunai", "approval": "Jurnal persetujuan", "approvalCancel": "Persetujuan dibatalkan", "claimPayment": "Pembayaran tunai", "settlement": "Penyelesaian uang muka" },
  "state": { "cancelledInErp": "Dibatalkan di ERPNext", "failed": "Gagal", "held": "Perlu operator", "pending": "Dalam antrean", "pushed": "Terposting" },
  "title": "Posting buku besar"
}
```
```json
"expenseMap": {
  "change": "Ubah {{key}}",
  "clear": "Hapus {{key}}",
  "confirmClear": { "confirm": "Hapus", "description": "Posting yang memerlukan akun ini akan berhenti sampai akun dipetakan lagi.", "title": "Hapus {{key}}?" },
  "description": "Akun ERPNext tempat klaim biaya dan uang muka yang disetujui diposting. Posting yang memerlukan akun yang belum dipetakan akan berhenti dan dilaporkan.",
  "error": { "title": "Tidak dapat memuat peta akun biaya" },
  "form": { "account": "Akun ERP", "legend": "Akun", "placeholder": "mis. Employee Payable - ABC", "required": "Akun ERP wajib diisi.", "save": "Simpan akun", "subtitle": "ERPNext memeriksa akun sebelum disimpan" },
  "key": { "accommodation": "Akomodasi", "employeeAdvance": "Uang muka karyawan", "employeePayable": "Utang karyawan", "localTransport": "Transportasi lokal", "meals": "Makan", "other": "Lainnya", "travel": "Perjalanan" },
  "map": "Petakan {{key}}",
  "title": "Peta akun biaya",
  "toast": { "saved": "Akun biaya disimpan" },
  "unmapped": "Belum dipetakan — posting biaya berhenti"
}
```

Verify: `../scripts/with-test-lock.sh npx vitest run src/lib/i18n` → green (the launch-scope catalogue gate; both
routes — `/administration/accounting`, `/expenses/:id` — are already on it).

### F8 — Part 5 gate

`npm run typecheck`; `npx eslint --max-warnings=0 pages/admin/ExpenseAccountMap.tsx pages/expenses/ExpensePostingsCard.tsx pages/Administration.tsx pages/ExpenseClaimDetail.tsx src/lib/repositories/expensePostings.ts src/lib/repositories/index.ts src/lib/repositories/types.ts`;
`../scripts/with-test-lock.sh npx vitest run --changed origin/dev`. Rendered Discover pass (design-reviewer, rich
seed): Administration › Accounting at 390 px and 1280 px (the account names wrap; no overflow), and an expense record
with postings in every state. Commit: `feat(expenses): expense account map and ledger postings UI (#775 phase B)`.

Next: [part 6 — cancel, enablement, e2e](2026-10-07-expense-claims-phase-b.part6-cancel-e2e.md).

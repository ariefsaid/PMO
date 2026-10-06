# Plan part 5 — Expense claims (#775): detail page, approvals inbox, wiring (Tasks 36–42)

Part of `docs/plans/2026-10-06-expense-claims.md`. **Tasks 43–46** (i18n catalogues, e2e, final gate, phase-B
spike) continue in `docs/plans/2026-10-06-expense-claims.part6-i18n-e2e.md`.

### Task 36 — RED: the record page (AC-EXP-061)

Create `pmo-portal/pages/ExpenseClaimDetail.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import React from 'react';
import { ToastProvider } from '@/src/components/ui';
import { formatCurrencyCents } from '@/src/lib/format';

const h = vi.hoisted(() => ({
  claim: null as unknown,
  route: null as unknown,
  outstanding: null as number | null,
  userId: 'eng',
  realRole: 'Engineer',
  m: {
    transition: { mutateAsync: vi.fn(), isPending: false }, recordReturn: { mutateAsync: vi.fn(), isPending: false },
    update: { mutateAsync: vi.fn(), isPending: false }, addLine: { mutateAsync: vi.fn(), isPending: false },
    updateLine: { mutateAsync: vi.fn(), isPending: false }, removeLine: { mutateAsync: vi.fn(), isPending: false },
  },
}));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaim: () => ({ data: h.claim, isPending: false, isError: false, refetch: vi.fn() }),
  useExpenseClaimLines: () => ({ data: [], isPending: false, isError: false }),
  useExpenseClaimRoute: () => ({ data: h.route }),
  useExpenseAdvanceOutstanding: () => ({ data: h.outstanding }),
  useExpenseAdvanceAging: () => ({ data: { rows: [], truncated: false } }),
  useExpenseClaimMutations: () => h.m,
}));
vi.mock('@/src/hooks/useExpenseReceipts', () => ({
  useExpenseReceipts: () => ({
    list: { data: [], isPending: false, isError: false }, upload: { mutate: vi.fn() }, archive: { mutate: vi.fn(), isPending: false },
    download: vi.fn(), progress: null, uploadError: null, clearUploadError: vi.fn(),
  }),
}));
vi.mock('@/src/hooks/useProjects', () => ({ useProjects: () => ({ data: [] }) }));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: h.userId, org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: h.realRole, effectiveRole: h.realRole }) }));

import ExpenseClaimDetail from './ExpenseClaimDetail';

const base = {
  id: 'c1', kind: 'claim', claim_number: 'EXP-2610060001', claimant_id: 'eng', claimant: { full_name: 'Budi Field' },
  project_id: null, project: null, budget_category: 'Special expenses', title: 'Site visit', purpose: null,
  currency: 'IDR', amount: 300, advance_id: null, advance_applied: 0, returned_amount: 0, status: 'Draft',
  approved_by_id: null, payment_reference: null, rejection_notes: null,
};
const renderAt = () =>
  render(
    <MemoryRouter initialEntries={['/expenses/c1']}>
      <ToastProvider>
        <Routes><Route path="/expenses/:claimId" element={<ExpenseClaimDetail />} /></Routes>
      </ToastProvider>
    </MemoryRouter>,
  );
const as = (userId: string, role: string) => { h.userId = userId; h.realRole = role; };

beforeEach(() => { h.route = null; h.outstanding = null; });

describe('ExpenseClaimDetail', () => {
  it('AC-EXP-061 the claimant of a Draft can add lines and submit', () => {
    h.claim = { ...base };
    as('eng', 'Engineer');
    renderAt();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add line' })).toBeInTheDocument();
  });

  it('AC-EXP-061 a PM the route does not name sees who decides and no Approve', () => {
    h.claim = { ...base, status: 'Submitted' };
    h.route = { claimId: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'pma', fullName: 'Ayu Approver' }], requestAmount: 300, lineBudget: 500, lineUsed: 0 };
    as('pm', 'Project Manager');
    renderAt();
    expect(screen.getByTestId('approval-route-note')).toHaveTextContent('Ayu Approver');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
  });

  it('AC-EXP-061 the named approver sees Approve', () => {
    h.claim = { ...base, status: 'Submitted' };
    h.route = { claimId: 'c1', route: 'project', reason: 'within_budget', approvers: [{ id: 'pma', fullName: 'Ayu Approver' }], requestAmount: 300, lineBudget: 500, lineUsed: 0 };
    as('pma', 'Project Manager');
    renderAt();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });

  it('AC-EXP-061 Finance paying an advance-linked claim sees the advance applied and the cash to pay', async () => {
    h.claim = { ...base, status: 'Approved', approved_by_id: 'pm', advance_id: 'adv-1' };
    h.outstanding = 250;
    as('f2', 'Finance');
    renderAt();
    await userEvent.click(screen.getByRole('button', { name: 'Mark paid' }));
    expect(await screen.findByTestId('pay-preview-applied')).toHaveTextContent(formatCurrencyCents(250, 'IDR'));
    expect(screen.getByTestId('pay-preview-cash')).toHaveTextContent(formatCurrencyCents(50, 'IDR'));
  });

  it('AC-EXP-061 the claimant of an Approved claim cannot pay it', () => {
    h.claim = { ...base, status: 'Approved', approved_by_id: 'pm' };
    as('eng', 'Engineer');
    renderAt();
    expect(screen.queryByRole('button', { name: 'Mark paid' })).toBeNull();
  });
});
```

**Verify (RED):** `…npx vitest run pages/ExpenseClaimDetail.test.tsx` → cannot resolve `./ExpenseClaimDetail`.

### Task 37 — GREEN (part): `pmo-portal/pages/expenses/ExpenseDecisionBar.tsx`

```tsx
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ConfirmDialog, TextArea, TextField, useToast } from '@/src/components/ui';
import { useExpenseClaimMutations } from '@/src/hooks/useExpenseClaims';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatCurrencyCents, parseMoneyInputAtScale } from '@/src/lib/format';
import { settlementPreview, type ExpenseAction } from '@/src/lib/expenses/expenseRules';
import type { ExpenseClaimStatus, ExpenseClaimWithRefs } from '@/src/lib/db/expenseClaims';

type Dialog = 'approve' | 'reject' | 'pay' | 'cancel' | 'recordReturn' | null;

/** The actions the server would allow this viewer (FR-EXP-063). `actions` comes from availableExpenseActions; the
 *  RPCs decide. `advanceOutstanding`: for a claim, its linked advance's; for an advance, its own; null = unknown. */
export interface ExpenseDecisionBarProps {
  claim: ExpenseClaimWithRefs;
  actions: ExpenseAction[];
  advanceOutstanding: number | null;
}

export const ExpenseDecisionBar: React.FC<ExpenseDecisionBarProps> = ({ claim, actions, advanceOutstanding }) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { transition, recordReturn } = useExpenseClaimMutations();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notes, setNotes] = useState('');
  const [reference, setReference] = useState('');
  const [returnAmount, setReturnAmount] = useState('');
  if (actions.length === 0) return null;

  const close = () => { setDialog(null); setNotes(''); setReference(''); setReturnAmount(''); };
  const run = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      toast(success, claim.title, 'success');
      close();
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };
  const move = (to: ExpenseClaimStatus, success: string, opts: { notes?: string | null; paymentReference?: string | null } = {}) =>
    run(() => transition.mutateAsync({ id: claim.id, to, ...opts }), success);

  // A wrong number on screen is worse than none: with a linked advance whose outstanding is not yet known, show "—".
  const previewKnown = !claim.advance_id || advanceOutstanding !== null;
  const preview = settlementPreview(Number(claim.amount), claim.advance_id ? advanceOutstanding : null);
  const parsedReturn = parseMoneyInputAtScale(returnAmount, 2);
  const returnValid = parsedReturn !== null && parsedReturn > 0 && advanceOutstanding !== null && parsedReturn <= advanceOutstanding;
  const deciding = dialog === 'approve' || dialog === 'reject';

  return (
    <div className="mb-4 flex flex-wrap gap-2" data-testid="expense-decision-bar">
      {actions.includes('submit') && (
        <Button variant="primary" disabled={transition.isPending}
          onClick={() => void move('Submitted', t('expenses.toast.submitted', 'Submitted for approval'))}>
          {t('expenses.actions.submit', 'Submit for approval')}
        </Button>
      )}
      {actions.includes('reopen') && (
        <Button variant="outline" disabled={transition.isPending}
          onClick={() => void move('Draft', t('expenses.toast.reopened', 'Back to Draft'))}>
          {t('expenses.actions.reopen', 'Edit and resubmit')}
        </Button>
      )}
      {actions.includes('approve') && <Button variant="primary" onClick={() => setDialog('approve')}>{t('expenses.actions.approve', 'Approve')}</Button>}
      {actions.includes('reject') && <Button variant="outline" onClick={() => setDialog('reject')}>{t('expenses.actions.reject', 'Reject')}</Button>}
      {actions.includes('pay') && <Button variant="primary" onClick={() => setDialog('pay')}>{t('expenses.actions.pay', 'Mark paid')}</Button>}
      {actions.includes('recordReturn') && (
        <Button variant="outline" onClick={() => setDialog('recordReturn')}>{t('expenses.actions.recordReturn', 'Record cash returned')}</Button>
      )}
      {actions.includes('cancel') && <Button variant="ghost" onClick={() => setDialog('cancel')}>{t('expenses.actions.cancel', 'Cancel')}</Button>}

      <ConfirmDialog
        open={deciding}
        tone={dialog === 'reject' ? 'destructive' : 'default'}
        title={dialog === 'reject' ? t('expenses.confirm.rejectTitle', 'Reject this?') : t('expenses.confirm.approveTitle', 'Approve this?')}
        description={<TextArea label={t('expenses.confirm.notesLabel', 'Note to the claimant (optional)')} value={notes} onChange={setNotes} />}
        confirmLabel={dialog === 'reject' ? t('expenses.actions.reject', 'Reject') : t('expenses.actions.approve', 'Approve')}
        loading={transition.isPending}
        onConfirm={() =>
          void (dialog === 'reject'
            ? move('Rejected', t('expenses.toast.rejected', 'Rejected'), { notes: notes.trim() || null })
            : move('Approved', t('expenses.toast.approved', 'Approved'), { notes: notes.trim() || null }))
        }
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog === 'pay'}
        title={t('expenses.confirm.payTitle', 'Mark as paid?')}
        description={
          <div className="space-y-3">
            {claim.advance_id && (
              <dl className="grid grid-cols-2 gap-2 text-sm">
                <dt>{t('expenses.confirm.previewApplied', 'Advance applied')}</dt>
                <dd className="text-right tabular-nums" data-testid="pay-preview-applied">
                  {previewKnown ? formatCurrencyCents(preview.applied, claim.currency) : '—'}
                </dd>
                <dt>{t('expenses.confirm.previewCash', 'Cash to pay')}</dt>
                <dd className="text-right tabular-nums" data-testid="pay-preview-cash">
                  {previewKnown ? formatCurrencyCents(preview.cash, claim.currency) : '—'}
                </dd>
              </dl>
            )}
            <TextField label={t('expenses.confirm.referenceLabel', 'Payment reference (optional)')} value={reference} onChange={setReference} />
          </div>
        }
        confirmLabel={t('expenses.actions.pay', 'Mark paid')}
        loading={transition.isPending}
        onConfirm={() => void move('Paid', t('expenses.toast.paid', 'Marked paid'), { paymentReference: reference.trim() || null })}
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog === 'recordReturn'}
        title={t('expenses.confirm.returnTitle', 'Record cash returned')}
        description={
          <div className="space-y-3">
            <TextField label={t('expenses.confirm.returnAmountLabel', 'Amount returned')} inputMode="decimal" value={returnAmount} onChange={setReturnAmount}
              helper={advanceOutstanding !== null
                ? t('expenses.confirm.returnAmountHelper', 'Up to {{amount}} is outstanding.', { amount: formatCurrencyCents(advanceOutstanding, claim.currency) })
                : undefined} />
            <TextField label={t('expenses.confirm.returnReferenceLabel', 'Reference (optional)')} value={reference} onChange={setReference} />
          </div>
        }
        confirmLabel={t('expenses.confirm.returnConfirm', 'Record return')}
        confirmDisabled={!returnValid}
        loading={recordReturn.isPending}
        onConfirm={() =>
          void run(
            () => recordReturn.mutateAsync({ id: claim.id, amount: parsedReturn as number, reference: reference.trim() || null }),
            t('expenses.toast.returned', 'Return recorded'),
          )
        }
        onCancel={close}
      />

      <ConfirmDialog
        open={dialog === 'cancel'}
        tone="destructive"
        title={t('expenses.confirm.cancelTitle', 'Cancel this?')}
        description={t('expenses.confirm.cancelDescription', 'It stays on record as Cancelled and can no longer be approved or paid.')}
        confirmLabel={t('expenses.confirm.cancelConfirm', 'Cancel it')}
        cancelLabel={t('expenses.confirm.keep', 'Keep it')}
        loading={transition.isPending}
        onConfirm={() => void move('Cancelled', t('expenses.toast.cancelled', 'Cancelled'))}
        onCancel={close}
      />
    </div>
  );
};
```

**Verify:** `npm run typecheck` → 0 errors.

### Task 38 — GREEN: `pmo-portal/pages/ExpenseClaimDetail.tsx`

```tsx
import React, { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardHead, CardPad, ListState, RecordHeader, StatusPill } from '@/src/components/ui';
import { BackBar } from '@/src/components/shell';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { usePermission } from '@/src/auth/usePermission';
import { useProjects } from '@/src/hooks/useProjects';
import {
  useExpenseAdvanceOutstanding, useExpenseClaim, useExpenseClaimLines, useExpenseClaimMutations, useExpenseClaimRoute,
} from '@/src/hooks/useExpenseClaims';
import { availableExpenseActions, settlementPreview } from '@/src/lib/expenses/expenseRules';
import { approvalRouteNote } from '@/src/lib/procurement/approvalRoute';
import { budgetCategoryLabel } from '@/src/lib/i18n/budgetCategoryLabel';
import { formatCurrencyCents } from '@/src/lib/format';
import { workflowVariant } from '@/src/lib/status/statusVariants';
import { ExpenseDecisionBar } from './expenses/ExpenseDecisionBar';
import { ExpenseLinesCard } from './expenses/ExpenseLinesCard';
import { ExpenseReceiptsCard } from './expenses/ExpenseReceiptsCard';
import { ExpenseClaimFormModal } from './expenses/ExpenseClaimFormModal';
import { useOwnAdvanceOptions } from './expenses/useOwnAdvanceOptions';
import { expenseKindLabel, expenseStatusLabel } from './expenses/expenseLabels';

/** `/expenses/:claimId` (FR-EXP-063..065). Shows only the actions the server would allow; the RPCs decide. */
const ExpenseClaimDetail: React.FC = () => {
  const { t } = useTranslation();
  const { claimId } = useParams<{ claimId: string }>();
  const navigate = useNavigate();
  const userId = useAuth().currentUser?.id ?? null;
  const { realRole } = useEffectiveRole();
  const may = usePermission();
  const query = useExpenseClaim(claimId);
  const claim = query.data ?? null;
  const linesQuery = useExpenseClaimLines(claimId);
  const routeQuery = useExpenseClaimRoute(claimId, claim?.status);
  const outstandingQuery = useExpenseAdvanceOutstanding(claim?.kind === 'advance' ? claim.id : claim?.advance_id ?? null);
  const { update } = useExpenseClaimMutations();
  const { data: projects } = useProjects();
  const advanceOptions = useOwnAdvanceOptions(claim?.advance_id ?? null);
  const projectOptions = useMemo(() => (projects ?? []).map((p) => ({ value: p.id, label: p.name })), [projects]);
  const [editOpen, setEditOpen] = useState(false);
  const backLabel = t('expenses.detail.back', 'Expenses');
  const goBack = () => navigate('/expenses');

  if (query.isPending) {
    return (<><BackBar label={backLabel} phoneOnly onBack={goBack} /><ListState variant="loading" rows={5} /></>);
  }
  if (query.isError) {
    return (
      <>
        <BackBar label={backLabel} phoneOnly onBack={goBack} />
        <ListState variant="error" title={t('expenses.detail.errorTitle', "Couldn't load this record")}
          sub={t('expenses.detail.errorSub', 'Something went wrong fetching it. Try again.')} onRetry={() => void query.refetch()} />
      </>
    );
  }
  if (!claim) {
    return (
      <>
        <BackBar label={backLabel} phoneOnly onBack={goBack} />
        <ListState variant="empty" icon="doc" title={t('expenses.detail.notFoundTitle', 'Not found')}
          sub={t('expenses.detail.notFoundSub', "It doesn't exist, or it isn't yours and you don't approve spend.")} />
      </>
    );
  }

  const route = routeQuery.data ?? null;
  const outstanding = outstandingQuery.data ?? null;
  const actions = availableExpenseActions({
    claim, userId, realRole, route, advanceOutstanding: claim.kind === 'advance' ? outstanding : null,
  });
  const canEdit = may('edit', 'expenseClaim', { currentUserId: userId, record: { claimant_id: claim.claimant_id, status: claim.status } });
  const showRouteNote = claim.status === 'Submitted' && route !== null && route.route !== 'flat'
    && claim.claimant_id !== userId && !actions.includes('approve');
  const amount = Number(claim.amount);
  const paidSplit = settlementPreview(amount, Number(claim.advance_applied));

  return (
    <div>
      <div className="hidden max-[920px]:block"><BackBar label={backLabel} onBack={goBack} /></div>
      <RecordHeader
        name={claim.title}
        icon={claim.kind === 'advance' ? 'A' : 'E'}
        status={
          <span data-testid="expense-status" data-status={claim.status}>
            <StatusPill variant={workflowVariant(claim.status)}>{expenseStatusLabel(claim.status, t)}</StatusPill>
          </span>
        }
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{claim.claim_number ?? t('expenses.draftNumber', 'Draft')}</span>
            <span>{expenseKindLabel(claim.kind, t)}</span>
            <span>{claim.claimant?.full_name ?? '—'}</span>
            {claim.project_id ? (
              <Link to={`/projects/${claim.project_id}`} className="text-primary-text hover:underline">{claim.project?.name ?? '—'}</Link>
            ) : (
              <span>{t('expenses.overhead', 'Overhead')}</span>
            )}
            {claim.budget_category && <span>{budgetCategoryLabel(claim.budget_category, t)}</span>}
          </span>
        }
        actions={canEdit ? <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>{t('expenses.detail.editDetails', 'Edit details')}</Button> : undefined}
      />

      <Card variant="bare" className="mb-4">
        <CardHead>{t('expenses.detail.summary', 'Summary')}</CardHead>
        <CardPad>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">{t('expenses.detail.amount', 'Amount')}</dt>
              <dd className="font-semibold tabular-nums" data-testid="expense-amount">{formatCurrencyCents(amount, claim.currency)}</dd>
            </div>
            {claim.kind === 'claim' && claim.status === 'Paid' && (
              <>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('expenses.detail.advanceApplied', 'Advance applied')}</dt>
                  <dd className="tabular-nums">{formatCurrencyCents(paidSplit.applied, claim.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t('expenses.detail.cashPaid', 'Cash paid')}</dt>
                  <dd className="tabular-nums">{formatCurrencyCents(paidSplit.cash, claim.currency)}</dd>
                </div>
              </>
            )}
            {claim.kind === 'advance' && claim.status === 'Paid' && (
              <div>
                <dt className="text-xs text-muted-foreground">{t('expenses.detail.outstanding', 'Outstanding')}</dt>
                <dd className="tabular-nums">{outstanding === null ? '—' : formatCurrencyCents(outstanding, claim.currency)}</dd>
              </div>
            )}
            {claim.payment_reference && (
              <div>
                <dt className="text-xs text-muted-foreground">{t('expenses.detail.reference', 'Payment reference')}</dt>
                <dd>{claim.payment_reference}</dd>
              </div>
            )}
          </dl>
          {claim.advance_id && (
            <p className="mt-3 text-sm">
              <Link to={`/expenses/${claim.advance_id}`} className="text-primary-text hover:underline">
                {t('expenses.detail.linkedAdvance', 'Settles a cash advance')}
              </Link>
            </p>
          )}
          {claim.purpose && <p className="mt-3 text-sm">{claim.purpose}</p>}
          {claim.rejection_notes && (claim.status === 'Rejected' || claim.status === 'Draft') && (
            <p role="note" className="mt-3 text-sm">
              {t('expenses.detail.rejectionNote', 'Rejected: {{note}}', { note: claim.rejection_notes })}
            </p>
          )}
        </CardPad>
      </Card>

      {showRouteNote && route && (
        <p data-testid="approval-route-note" className="mb-4 text-sm">{approvalRouteNote(route, claim.budget_category, t)}</p>
      )}

      <ExpenseDecisionBar claim={claim} actions={actions} advanceOutstanding={outstanding} />

      {claim.kind === 'claim' && (
        <ExpenseLinesCard claimId={claim.id} lines={linesQuery.data ?? []} isPending={linesQuery.isPending}
          isError={linesQuery.isError} currency={claim.currency} editable={canEdit} />
      )}
      <ExpenseReceiptsCard claimId={claim.id} canWrite={canEdit} />

      {editOpen && (
        <ExpenseClaimFormModal
          kind={claim.kind}
          projectOptions={projectOptions}
          advanceOptions={advanceOptions}
          initial={{
            title: claim.title, projectId: claim.project_id, budgetCategory: claim.budget_category,
            purpose: claim.purpose, amount, advanceId: claim.advance_id,
          }}
          onClose={() => setEditOpen(false)}
          onSubmit={async (input) => {
            await update.mutateAsync({
              id: claim.id, kind: claim.kind,
              patch: {
                title: input.title, purpose: input.purpose, projectId: input.projectId, budgetCategory: input.budgetCategory,
                amount: input.amount, advanceId: input.advanceId ?? null,
              },
            });
            setEditOpen(false);
          }}
        />
      )}
    </div>
  );
};

export default ExpenseClaimDetail;
```

**Verify (GREEN):** `…npx vitest run pages/ExpenseClaimDetail.test.tsx && npm run typecheck` → green.

### Task 39 — RED: approvals inbox section (AC-EXP-064)

Create `pmo-portal/pages/approvals/ExpenseClaimApprovalSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import React from 'react';

const h = vi.hoisted(() => ({ data: [] as unknown[] }));
vi.mock('@/src/hooks/useExpenseClaims', () => ({
  useExpenseClaimsAwaitingDecision: () => ({ data: h.data, isPending: false, isError: false, refetch: vi.fn() }),
}));
vi.mock('@/src/auth/useAuth', () => ({ useAuth: () => ({ currentUser: { id: 'pm', org_id: 'org-1' } }) }));
vi.mock('@/src/auth/impersonation', () => ({ useEffectiveRole: () => ({ realRole: 'Project Manager', effectiveRole: 'Project Manager' }) }));

import { ExpenseClaimApprovalSection } from './ExpenseClaimApprovalSection';

const item = (id: string, claimant: string, route: unknown) => ({
  claim: { id, claim_number: `EXP-${id}`, title: `Claim ${id}`, claimant_id: claimant, claimant: { full_name: 'X' }, amount: 100, currency: 'IDR', status: 'Submitted' },
  route,
});

describe('ExpenseClaimApprovalSection', () => {
  it('AC-EXP-064 lists only records awaiting the viewer, each linking to its page', () => {
    h.data = [
      item('1', 'pm', null),
      item('2', 'eng', { route: 'flat', approvers: [] }),
      item('3', 'eng', { route: 'project', approvers: [{ id: 'other', fullName: 'O' }] }),
      item('4', 'eng', { route: 'project', approvers: [{ id: 'pm', fullName: 'P' }] }),
    ];
    render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'EXP-2' })).toHaveAttribute('href', '/expenses/2');
    expect(screen.getByRole('link', { name: 'EXP-4' })).toHaveAttribute('href', '/expenses/4');
    expect(screen.queryByRole('link', { name: 'EXP-1' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'EXP-3' })).toBeNull();
  });
  it('AC-EXP-064 renders nothing when nothing awaits the viewer', () => {
    h.data = [item('1', 'pm', null)];
    const { container } = render(<MemoryRouter><ExpenseClaimApprovalSection /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
```

**Verify (RED):** cannot resolve `./ExpenseClaimApprovalSection`.

### Task 40 — GREEN: the section + mount

`pmo-portal/pages/approvals/ExpenseClaimApprovalSection.tsx`:

```tsx
import React, { useMemo } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Card, CardHead, ListState } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { useEffectiveRole } from '@/src/auth/impersonation';
import { useExpenseClaimsAwaitingDecision } from '@/src/hooks/useExpenseClaims';
import { claimsAwaitingViewer } from '@/src/lib/expenses/expenseRules';
import { formatCurrencyCents } from '@/src/lib/format';

/** "Expense claims awaiting you" on /approvals (FR-EXP-066). Decisions happen on the record page. Hidden when none;
 *  a failed read shows an error rather than a false "nothing waiting" (the AwaitingApprovalTile lesson). */
export const ExpenseClaimApprovalSection: React.FC = () => {
  const { t } = useTranslation();
  const userId = useAuth().currentUser?.id;
  const { realRole } = useEffectiveRole();
  const { data, isPending, isError, refetch } = useExpenseClaimsAwaitingDecision();
  const rows = useMemo(() => claimsAwaitingViewer(data ?? [], userId, realRole), [data, userId, realRole]);
  if (isPending) return null;
  if (isError) {
    return (
      <div className="mb-4">
        <ListState variant="error" title={t('expenses.approvals.errorTitle', "Couldn't load expense claims awaiting you")}
          sub={t('expenses.approvals.errorSub', 'Purchase requests and timesheets below are unaffected.')} onRetry={() => void refetch()} />
      </div>
    );
  }
  if (rows.length === 0) return null;
  return (
    <section aria-label={t('expenses.approvals.label', 'Expense claims awaiting you')} className="mb-4">
      <Card seam>
        <CardHead className="rounded-t-lg">{t('expenses.approvals.heading', 'Expense claims awaiting you ({{count}})', { count: rows.length })}</CardHead>
        <ul className="divide-y divide-border rounded-b-lg border-t border-border">
          {rows.map(({ claim }) => (
            <li key={claim.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <Link to={`/expenses/${claim.id}`} className="font-medium text-primary-text hover:underline">{claim.claim_number ?? claim.title}</Link>
              <span className="truncate">{claim.title}</span>
              <span className="text-muted-foreground">{claim.claimant?.full_name ?? '—'}</span>
              <span className="ml-auto tabular-nums">{formatCurrencyCents(Number(claim.amount), claim.currency)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
};
```

Mount in `pmo-portal/pages/Approvals.tsx`: add the import
`import { ExpenseClaimApprovalSection } from './approvals/ExpenseClaimApprovalSection';` next to the
`ProcurementApprovalSection` import, and directly after the line
`{canApproveTimesheets && <ReopenableApprovedSection />}` add
`{canApproveProcurement && <ExpenseClaimApprovalSection />}` (same approval-rank population: Admin·Exec·PM·Finance).

**Verify (GREEN):** `…npx vitest run pages/approvals/ExpenseClaimApprovalSection.test.tsx pages/__tests__ pages/Approvals*.test.tsx` → green
(the existing Approvals tests stay green; if one mocks no expense hook, add
`vi.mock('@/src/hooks/useExpenseClaims', () => ({ useExpenseClaimsAwaitingDecision: () => ({ data: [], isPending: false, isError: false, refetch: vi.fn() }) }))`
to that file — a missing-mock fix, not a weakened assertion).

### Task 41 — RED: a notification about a claim opens it (AC-EXP-065)

Append inside `describe('NotificationBell', …)` in `pmo-portal/src/components/shell/__tests__/NotificationBell.test.tsx`:

```tsx
  it('AC-EXP-065 selecting an expense-claim hand-off opens the claim', async () => {
    listUnreadCount.mockResolvedValue(1);
    listNotifications.mockResolvedValue([
      row({ id: 'n1', title: 'Expense claim awaiting your approval', metadata: { entity: { type: 'expense_claim', id: 'ec-7', label: 'EXP-1' } } }),
    ]);
    renderBell();
    await userEvent.click(await screen.findByRole('button', { name: /notifications/i }));
    await userEvent.click(await screen.findByRole('button', { name: /expense claim awaiting/i }));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/expenses/ec-7'));
  });
```

**Verify (RED):** `…npx vitest run src/components/shell/__tests__/NotificationBell.test.tsx` → the new test fails (no navigation).

### Task 42 — GREEN: wiring (FR-EXP-067/068)

1. `pmo-portal/src/components/shell/NotificationBell.tsx` — in `ENTITY_ROUTE_BASE` add `expense_claim: '/expenses',`.
2. `pmo-portal/App.tsx` — next to the Meetings lazy imports:
   ```tsx
   const ExpenseClaimsPage = React.lazy(() => import('./pages/ExpenseClaims'));
   const ExpenseClaimDetailPage = React.lazy(() => import('./pages/ExpenseClaimDetail'));
   ```
   and in the route table after the `/meetings/:meetingId` entry:
   ```tsx
   // #775: expense claims and cash advances.
   { path: '/expenses', element: <ExpenseClaimsPage /> },
   { path: '/expenses/:claimId', element: <ExpenseClaimDetailPage /> },
   ```
3. `pmo-portal/src/components/shell/Rail.tsx` — in `ALL_ITEMS` after the `/timesheets` item:
   ```tsx
   // #775: every member files their own claims; RLS scopes reads to own ∪ approval rank.
   { to: '/expenses', text: 'Expenses', icon: 'dollar', group: 'Workforce', roles: [UserRole.Executive, UserRole.ProjectManager, UserRole.Finance, UserRole.Engineer, UserRole.Admin] },
   ```
   and in `navLabels` add `'/expenses': t('shell.nav.expenses', 'Expenses'),`.
4. `pmo-portal/src/components/shell/routeMatch.ts` — in `MODULES` after the meetings entry:
   ```ts
   // #775: Expenses — every role (own claims); RLS scopes reads.
   { module: 'expenses', icon: 'dollar', label: 'Expenses', path: '/expenses', detail: { pattern: '/expenses/:claimId', param: 'claimId' } },
   ```

**Verify (GREEN):** `…npx vitest run src/components/shell && npm run typecheck` → green. A shell test that enumerates
the rail or module list verbatim gets `/expenses` / `'expenses'` added to its expected list — that is the deliberate
IA addition, not a weakened assertion.

**Continue with `docs/plans/2026-10-06-expense-claims.part6-i18n-e2e.md`.**

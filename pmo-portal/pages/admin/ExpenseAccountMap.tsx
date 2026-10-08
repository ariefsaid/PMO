import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  ConfirmDialog,
  EntityFormModal,
  FormGrid,
  FormSection,
  ListState,
  StatusPill,
  TextField,
  useEntityForm,
  useToast,
  type SubmitError,
} from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { repositories } from '@/src/lib/repositories';
import type { ExpenseAccountMapRow } from '@/src/lib/repositories/expensePostings';
import { EXPENSE_ACCOUNT_KEYS, type ExpenseAccountKey } from '@/src/lib/adapterSeam/erpnext/expenseAccountRules';
import { EXPENSES_EMPLOYABLE } from '@/src/lib/adapterSeam/erpnext/expenseEnablement';
import { useErpnextBinding } from '@/src/hooks/useErpnextBinding';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';

/**
 * Administration › Accounting › Expense account map (#775 phase B, FR-EXP-116). The 7 keys an expense posting needs.
 * Saving goes through `external-set-company`, which reads the account from ERPNext and refuses one that does not fit
 * (FR-EXP-112 — e.g. the supplier payable account, an untyped advance account); its message is shown in the form.
 * Admin-only actions via `can('manage', 'integration')`; the table and the edge action are the authority (ADR-0016).
 */
const QUERY_KEY = ['expense-account-map'] as const;

const ExpenseAccountMap: React.FC = () => {
  const { t } = useTranslation();
  const canManage = usePermission()('manage', 'integration');
  const navigate = useNavigate();
  const binding = useErpnextBinding();
  const ownership = useExternalDomainOwnership();
  const expensesActive = Boolean(EXPENSES_EMPLOYABLE && binding.data?.status === 'active'
    && ownership.data?.some((row) => row.externalTier === 'erpnext' && row.domain === 'expenses'));
  const readinessResolved = !binding.isPending && !ownership.isPending;
  const isReady = expensesActive && !binding.isError && !ownership.isError;
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ExpenseAccountKey | null>(null);
  const [clearing, setClearing] = useState<ExpenseAccountKey | null>(null);
  // #559 / AC-ERR-001: the form fires and forgets — this component owns the mutation and its rejection.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);
  const { data, isPending, isError, refetch } = useQuery<ExpenseAccountMapRow[]>({
    queryKey: QUERY_KEY,
    queryFn: () => repositories.expensePostings.listAccountMap(),
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
  const invalidate = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const save = useMutation({
    mutationFn: (v: { accountKey: ExpenseAccountKey; erpAccount: string }) => repositories.integrations.saveExpenseAccount(v),
    onSuccess: invalidate,
  });
  const clear = useMutation({
    mutationFn: (key: ExpenseAccountKey) => repositories.integrations.clearExpenseAccount(key),
    onSuccess: invalidate,
  });

  if (isPending) {
    return (
      <div className="rounded-lg border border-border bg-card">
        <ListState variant="loading" rows={EXPENSE_ACCOUNT_KEYS.length} testId="expense-account-map-loading" />
      </div>
    );
  }
  if (isError) {
    return (
      <ListState
        variant="error"
        title={t('admin.expenseMap.error.title', "Couldn't load the expense account map")}
        sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
        retryLabel={t('admin.retry', 'Retry')}
        onRetry={() => refetch()}
      />
    );
  }

  const onSubmit = async (key: ExpenseAccountKey, erpAccount: string) => {
    try {
      await save.mutateAsync({ accountKey: key, erpAccount });
      toast(t('admin.expenseMap.toast.saved', 'Expense account saved'), `${label(key)} → ${erpAccount}`, 'success');
      setEditing(null);
    } catch (err) {
      // The server's FR-EXP-112 refusal names the account and the rule — show it verbatim in the form.
      const code = (err as { code?: unknown } | null)?.code;
      const connectionRefusal = code === 'CONFIG_REJECTED' || code === 'ERP_NOT_CONNECTED' || code === 'integration-not-connected';
      setSaveError({
        headline: t('admin.expenseMap.error.saveHeadline', 'Couldn’t save the expense account'),
        detail: connectionRefusal
          ? t('admin.expenseMap.notReady', 'Connect ERPNext before mapping expense accounts. Expense posting is not active.')
          : code === 'config-rejected'
            ? t('admin.expenseMap.error.accountRemedy', 'Check the account name and type in ERPNext, then try again. Your entry is kept.')
            : t('admin.expenseMap.error.unknownRemedy', 'Check your connection and try again. Your entry is kept.'),
      });
    }
  };

  const onClearConfirm = async () => {
    if (!clearing) return;
    try {
      await clear.mutateAsync(clearing);
      setClearing(null);
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      toast(headline, detail, 'warning');
    }
  };

  return (
    <section id="expense-account-map" aria-label={t('admin.expenseMap.title', 'Expense account map')}>
      <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{t('admin.expenseMap.title', 'Expense account map')}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t(
          'admin.expenseMap.description',
          'The ERPNext accounts approved expense claims and cash advances post to. A posting that needs an unmapped account stops and is reported.',
        )}
      </p>
      {readinessResolved && !isReady && (
        <div role="status" className="mt-3 rounded-md bg-secondary px-3 py-2 text-[13px] text-secondary-foreground">
          <p>{t('admin.expenseMap.notReady', 'Connect ERPNext before mapping expense accounts. Expense posting is not active.')}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => navigate('/administration/integrations')}>{t('admin.expenseMap.openIntegrations', 'Open integrations')}</Button>
        </div>
      )}
      {/* AC-MOBILE-OVERFLOW-001 — each row wraps (`flex-wrap`, `break-words`), so a long account name never pushes
          past 390px. */}
      <ul className="mt-3.5 flex flex-col">
        {EXPENSE_ACCOUNT_KEYS.map((key) => {
          const account = byKey.get(key);
          return (
            <li
              key={key}
              data-testid="expense-account-row"
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-[13.5px]"
            >
              <span className="font-medium">{label(key)}</span>
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                {account
                  ? <span className="break-words">{account}</span>
                  // Until the `expenses` domain can be employed (#901, like ErpSetupChecklist), nothing posts, so an
                  // unmapped key stops nothing: say so plainly instead of warning.
                  : isReady
                    ? <StatusPill variant="warn">{t('admin.expenseMap.unmapped', 'Not mapped — expense posting stops')}</StatusPill>
                    : <span className="text-muted-foreground">{t('admin.expenseMap.unmappedIdle', 'Not mapped')}</span>}
                {canManage && (
                  <>
                    {(isReady || account) && <Button variant="ghost" size="sm" disabled={!isReady} onClick={() => { setSaveError(null); setEditing(key); }}>
                      {account
                        ? t('admin.expenseMap.change', { defaultValue: 'Change {{key}}', key: label(key) })
                        : t('admin.expenseMap.map', { defaultValue: 'Map {{key}}', key: label(key) })}
                    </Button>}
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
          onSubmit={(erpAccount) => onSubmit(editing, erpAccount)}
        />
      )}

      <ConfirmDialog
        open={!!clearing}
        tone="destructive"
        title={clearing ? t('admin.expenseMap.confirmClear.title', { defaultValue: 'Clear {{key}}?', key: label(clearing) }) : ''}
        description={t('admin.expenseMap.confirmClear.description', 'Postings that need this account will stop until it is mapped again.')}
        confirmLabel={t('admin.expenseMap.confirmClear.confirm', 'Clear')}
        loading={clear.isPending}
        onConfirm={onClearConfirm}
        onCancel={() => setClearing(null)}
      />
    </section>
  );
};

interface AccountFormProps {
  title: string;
  initial: string;
  /** #559: owned by the parent (which owns the mutation), rendered here. */
  submitError: SubmitError | null;
  onClose: () => void;
  onSubmit: (erpAccount: string) => Promise<void>;
}

const AccountForm: React.FC<AccountFormProps> = ({ title, initial, submitError, onClose, onSubmit }) => {
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
      onSubmit={(e: React.FormEvent) => {
        e.preventDefault();
        void form.handleSubmit(async (v) => onSubmit(v.erpAccount.trim()));
      }}
      submitError={submitError}
      onClose={onClose}
      loading={form.isSubmitting}
      dirty={form.isDirty}
      submitDisabled={!form.isComplete}
      errorSummary={form.errors.erpAccount ? [{ fieldId: field.id, message: form.errors.erpAccount }] : undefined}
    >
      <FormSection legend={t('admin.expenseMap.form.legend', 'Account')}>
        <FormGrid>
          <TextField
            id={field.id}
            label={t('admin.expenseMap.form.account', 'ERP account')}
            required
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={field.error}
            placeholder={t('admin.expenseMap.form.placeholder', 'e.g. Employee Payable - ABC')}
            fullWidth
          />
        </FormGrid>
      </FormSection>
    </EntityFormModal>
  );
};

export default ExpenseAccountMap;

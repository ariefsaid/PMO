import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  Button,
  EntityFormModal,
  type SubmitError,
  FormSection,
  NumberField,
  TextField,
  ListState,
  useToast,
  useEntityForm,
} from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { formatNumberExact, parseMoneyInput } from '@/src/lib/format';

/**
 * Administration › Credits section (ops-admin-surface S6, FR-CRE-002/005, AC-CRE-004 Unit shape).
 *
 * The balance readout is the org credit pool via the security-definer `org_credit_balance` RPC
 * (grants − usage). The Operator sees a "Grant credits" affordance → an `EntityFormModal` with
 * amount (numeric, required, > 0) + note; it calls `operator_grant_credits` through the repository
 * seam. A non-Operator org-Admin sees the read-only balance only. A grant of `amount <= 0` is
 * rejected server-side with errcode `23514` → "Grant amount must be positive" toast.
 *
 * UX-only projection (ADR-0016/0019): the FE gates the Grant button on `useIsOperator`; the RPC
 * re-asserts Operator authority (NFR-SEC-002 — non-Operator INSERT is denied at `42501`).
 */

export interface AdministrationCreditsProps {
  /** Clarity projection only — the RPC re-asserts Operator server-side. */
  isOperator: boolean;
  /** The org whose balance is shown / granted into (own org, or the Operator's selected org). */
  orgId: string;
}

interface GrantFormValues {
  amount: string;
  note: string;
}

/**
 * #684 (AC-PLC-009): the grant amount is read in the viewer's number convention by the ONE strict
 * parse that also produces the granted number. Credits are stored as unrestricted `numeric`, so no
 * decimal-scale limit applies — only a finite value greater than zero is accepted.
 */
function parseGrantAmount(raw: string): number | null {
  const n = parseMoneyInput(raw);
  return n !== null && n > 0 ? n : null;
}

const makeValidateGrant =
  (t: TFunction) =>
  (v: GrantFormValues): Partial<Record<keyof GrantFormValues, string>> => {
    const errors: Partial<Record<keyof GrantFormValues, string>> = {};
    if (!v.amount.trim()) {
      errors.amount = t('admin.credits.amountRequired', 'Amount is required.');
    } else if (parseGrantAmount(v.amount) === null) {
      errors.amount = t('admin.credits.amountPositive', 'Grant amount must be positive.');
    }
    return errors;
  };

export const AdministrationCredits: React.FC<AdministrationCreditsProps> = ({
  isOperator,
  orgId,
}) => {
  const { t } = useTranslation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [grantOpen, setGrantOpen] = useState(false);
  // #559: a rejected save must leave PERSISTENT evidence in the dialog. The toast auto-dismisses
  // after 4s, ~700px from where the user is looking, after which the modal is indistinguishable
  // from a pristine form with data in it — so the user believes the save succeeded.
  const [saveError, setSaveError] = useState<SubmitError | null>(null);

  const balanceQuery = useQuery({
    queryKey: ['orgCreditBalance', orgId],
    queryFn: () => repositories.credits.getOrgBalance(orgId),
    enabled: Boolean(orgId),
  });

  const grantMutation = useMutation({
    mutationFn: (args: { orgId: string; amount: number; note: string }) =>
      repositories.credits.grant(args),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orgCreditBalance', orgId] });
      toast(
        t('admin.credits.toast.granted', 'Credits granted'),
        t('admin.credits.toast.grantedDetail', 'The org balance has been updated.'),
        'success',
      );
      setGrantOpen(false);
    },
    onError: (err: unknown) => {
      const { headline, detail } = classifyMutationError(err, {
        '23514': t('admin.credits.amountPositive', 'Grant amount must be positive.'),
      });
      setSaveError({ headline, detail });
      toast(headline, detail, 'warning');
    },
  });

  return (
    <section aria-label={t('admin.nav.credits', 'Credits')} className="min-w-0">
      {balanceQuery.isPending && (
        <ListState variant="loading" rows={1} />
      )}
      {balanceQuery.isError && (
        <ListState
          variant="error"
          title={t('admin.credits.error.title', 'Balance unavailable')}
          sub={t('admin.loadErrorSub', 'The request failed. Check your connection and try again.')}
          retryLabel={t('admin.retry', 'Retry')}
          onRetry={() => void balanceQuery.refetch()}
        />
      )}
      {balanceQuery.data !== undefined && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
          <p className="min-w-0 text-sm">
            <span className="text-muted-foreground">{t('admin.credits.balanceLabel', 'Available balance')}</span>
            <span className="ml-3 text-xl font-bold tabular" data-testid="org-credit-balance">
              {formatNumberExact(balanceQuery.data)}{' '}
              <span className="text-sm font-semibold text-muted-foreground">
                {t('admin.credits.unit', 'credits')}
              </span>
            </span>
          </p>
          {isOperator && <Button variant="primary" className="min-h-11" onClick={() => setGrantOpen(true)}>
            {t('admin.credits.grant', 'Grant credits')}
          </Button>}
        </div>
      )}

      {grantOpen && (
        <GrantFormModal
          loading={grantMutation.isPending}
          submitError={saveError}
          onClose={() => setGrantOpen(false)}
          onSubmit={(amount, note) =>
            grantMutation.mutate({ orgId, amount, note })
          }
        />
      )}
    </section>
  );
};

const GrantFormModal: React.FC<{
  loading: boolean;
  /** #559: the rejected-save error, owned by the page (which owns the mutation) and rendered here. */
  submitError: SubmitError | null;
  onClose: () => void;
  onSubmit: (amount: number, note: string) => void;
}> = ({ loading, submitError, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const validate = useMemo(() => makeValidateGrant(t), [t]);
  const form = useEntityForm<GrantFormValues>({
    initialValues: { amount: '', note: '' },
    validate,
    idPrefix: 'grant-credits-form',
    requiredFields: ['amount'],
    module: 'administration',
  });
  const amountField = form.fieldProps('amount');
  const noteField = form.fieldProps('note');

  const errorSummary = form.errors.amount
    ? [{ fieldId: amountField.id, message: form.errors.amount }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((values) => {
      const amount = parseGrantAmount(values.amount);
      // Unreachable after `validateGrant`, which applies the same parse.
      if (amount === null) return;
      onSubmit(amount, values.note.trim());
    });
  };

  return (
    <EntityFormModal
      open
      title={t('admin.credits.grant', 'Grant credits')}
      subtitle={t('admin.credits.form.subtitle', 'Add credits to the org pool. Takes effect immediately.')}
      submitLabel={t('admin.credits.grant', 'Grant credits')}
      onSubmit={handleSubmit}
      submitError={submitError}
      onClose={onClose}
      loading={loading}
      dirty={form.isDirty}
      errorSummary={errorSummary}
    >
      <FormSection legend={t('admin.credits.form.legend', 'Grant details')}>
        <NumberField
          id={amountField.id}
          label={t('admin.credits.form.amount', 'Amount')}
          localeAware
          required
          value={amountField.value}
          onChange={amountField.onChange}
          onBlur={amountField.onBlur}
          error={form.errors.amount}
          helper={t('admin.credits.form.amountHelper', 'Must be greater than zero.')}
          fullWidth
        />
        <TextField
          id={noteField.id}
          label={t('admin.credits.form.note', 'Note')}
          value={noteField.value}
          onChange={noteField.onChange}
          onBlur={noteField.onBlur}
          helper={t('admin.credits.form.noteHelper', 'Optional context recorded against the grant.')}
          fullWidth
        />
      </FormSection>
    </EntityFormModal>
  );
};

export default AdministrationCredits;

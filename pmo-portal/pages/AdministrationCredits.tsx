import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Icon,
  EntityFormModal,
  FormSection,
  TextField,
  ListState,
  useToast,
  useEntityForm,
} from '@/src/components/ui';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

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

const validateGrant = (v: GrantFormValues): Partial<Record<keyof GrantFormValues, string>> => {
  const errors: Partial<Record<keyof GrantFormValues, string>> = {};
  const amount = v.amount.trim();
  if (!amount) {
    errors.amount = 'Amount is required.';
  } else {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) errors.amount = 'Grant amount must be positive.';
  }
  return errors;
};

const numberFormatter = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });

export const AdministrationCredits: React.FC<AdministrationCreditsProps> = ({
  isOperator,
  orgId,
}) => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [grantOpen, setGrantOpen] = useState(false);

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
      toast('Credits granted', 'The org balance has been updated.', 'success');
      setGrantOpen(false);
    },
    onError: (err: unknown) => {
      const { headline, detail } = classifyMutationError(err, {
        '23514': 'Grant amount must be positive.',
      });
      toast(headline, detail, 'warning');
    },
  });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold">Credits</h2>
        {isOperator && (
          <Button variant="primary" onClick={() => setGrantOpen(true)}>
            <Icon name="plus" />
            Grant credits
          </Button>
        )}
      </div>

      {balanceQuery.isPending && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={1} />
        </div>
      )}
      {balanceQuery.isError && (
        <ListState
          variant="error"
          title="Couldn't load balance"
          sub="The request failed. Check your connection and try again."
          onRetry={() => void balanceQuery.refetch()}
        />
      )}
      {balanceQuery.data !== undefined && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
          <span className="text-[13px] text-muted-foreground">Org balance</span>
          <span className="text-[20px] font-bold tabular" data-testid="org-credit-balance">
            {numberFormatter.format(balanceQuery.data)}
          </span>
        </div>
      )}

      {grantOpen && (
        <GrantFormModal
          loading={grantMutation.isPending}
          onClose={() => setGrantOpen(false)}
          onSubmit={(amount, note) =>
            grantMutation.mutate({ orgId, amount, note })
          }
        />
      )}
    </div>
  );
};

const GrantFormModal: React.FC<{
  loading: boolean;
  onClose: () => void;
  onSubmit: (amount: number, note: string) => void;
}> = ({ loading, onClose, onSubmit }) => {
  const form = useEntityForm<GrantFormValues>({
    initialValues: { amount: '', note: '' },
    validate: validateGrant,
    idPrefix: 'grant-credits-form',
    requiredFields: ['amount'],
  });
  const amountField = form.fieldProps('amount');
  const noteField = form.fieldProps('note');

  const errorSummary = form.errors.amount
    ? [{ fieldId: amountField.id, message: form.errors.amount }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((values) => {
      onSubmit(Number(values.amount.trim()), values.note.trim());
    });
  };

  return (
    <EntityFormModal
      open
      title="Grant credits"
      subtitle="Add credits to the org pool. Takes effect immediately."
      submitLabel="Grant credits"
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={loading}
      dirty={form.isDirty}
      errorSummary={errorSummary}
    >
      <FormSection legend="Grant details">
        <TextField
          id={amountField.id}
          label="Amount"
          type="number"
          inputMode="decimal"
          required
          value={amountField.value}
          onChange={amountField.onChange}
          onBlur={amountField.onBlur}
          error={form.errors.amount}
          helper="Must be greater than zero."
          fullWidth
        />
        <TextField
          id={noteField.id}
          label="Note"
          value={noteField.value}
          onChange={noteField.onChange}
          onBlur={noteField.onBlur}
          helper="Optional context recorded against the grant."
          fullWidth
        />
      </FormSection>
    </EntityFormModal>
  );
};

export default AdministrationCredits;

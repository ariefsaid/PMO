import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, TextField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useOrgCurrency } from '@/src/hooks/useOrgCurrency';
import { useSetWorkInHandCapacity, useWorkInHandCapacity } from '@/src/hooks/useWorkInHand';
import { monthlyCapacityIssue } from '@/src/lib/db/workInHand';
import { classifyMutationError } from '@/src/lib/classifyMutationError';

/**
 * Administration › Project setup › Monthly work capacity (M8, FR-M8-001).
 *
 * One organisation monthly production capacity in the organisation's currency. `null` (empty) is the default and
 * means months of work in hand is not computed until an Admin enters a positive capacity. Enforced in Postgres by
 * `organizations_update_work_in_hand_capacity` and the column grant (2530); this control mirrors that and is UX only.
 */
const OrgWorkInHandCapacity: React.FC = () => {
  const { t } = useTranslation('workInHand');
  const may = usePermission();
  const canManage = may('manage', 'workInHandCapacity');
  const orgCurrency = useOrgCurrency();
  const { toast } = useToast();
  const query = useWorkInHandCapacity();
  const mutation = useSetWorkInHandCapacity();
  const saved = query.data ?? null;
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = draft ?? (saved === null ? '' : String(saved));

  useEffect(() => {
    if (query.isSuccess) setDraft(null);
  }, [query.isSuccess, saved]);

  if (!canManage) return null;

  const trimmed = shown.trim();
  const draftIssue = trimmed === '' ? null : monthlyCapacityIssue(trimmed);
  const parsedValue: number | null | 'invalid' = trimmed === '' ? null : (draftIssue === null ? Number(trimmed) : 'invalid');

  const submit = async (raw: string | null) => {
    setError(null);
    const issue = monthlyCapacityIssue(raw);
    if (issue === 'invalid') {
      setError(t('capacitySetting.invalid', 'Enter a valid amount.'));
      return;
    }
    if (issue === 'positive') {
      setError(t('capacitySetting.positive', 'Monthly capacity must be greater than zero.'));
      return;
    }
    if (issue === 'precision') {
      setError(t('capacitySetting.precision', 'Give monthly capacity at most two decimals.'));
      return;
    }
    const clean = raw === null ? '' : raw.trim();
    const nextValue = clean === '' ? null : Number(clean);
    try {
      await mutation.mutateAsync(nextValue);
      toast(t('capacitySetting.saved', 'Monthly work capacity saved'), undefined, 'success');
    } catch (err) {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    }
  };

  return (
    <section id="work-in-hand-capacity" tabIndex={-1} className="scroll-mt-4" aria-labelledby="work-in-hand-capacity-heading">
      <h2 id="work-in-hand-capacity-heading" className="text-group font-semibold tracking-[-0.01em]">
        {t('capacitySetting.title', 'Monthly work capacity')}
      </h2>
      <p className="mt-1 max-w-prose text-control text-muted-foreground">
        {t(
          'capacitySetting.helper',
          'Monthly production capacity in {{currency}}, used to divide work in hand into months. Leave it empty if no capacity is set yet.',
          { currency: orgCurrency },
        )}
      </p>
      {query.isError && query.data === undefined ? (
        <div className="mt-3">
          <ListState
            variant="error"
            title={t('capacitySetting.loadError', "Couldn't load monthly work capacity")}
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(event) => { event.preventDefault(); void submit(trimmed); }}
        >
          <TextField
            label={t('capacitySetting.label', 'Monthly capacity ({{currency}})', { currency: orgCurrency })}
            value={shown}
            inputMode="decimal"
            onChange={(value) => { setDraft(value); setError(null); }}
            disabled={mutation.isPending}
          />
          <Button type="submit" variant="primary" disabled={mutation.isPending || parsedValue === saved}>
            {t('capacitySetting.save', 'Save capacity')}
          </Button>
          {saved !== null && (
            <Button
              type="button"
              variant="outline"
              disabled={mutation.isPending}
              onClick={() => { setDraft(''); void submit(null); }}
            >
              {t('capacitySetting.clear', 'Clear capacity')}
            </Button>
          )}
        </form>
      )}
      {error && <FieldError id="work-in-hand-capacity-error">{error}</FieldError>}
      <p className="mt-2 text-control text-muted-foreground" role="status">
        {saved === null
          ? t('capacitySetting.empty', 'Not set: months of work in hand is not calculated until a monthly capacity is entered.')
          : t('capacitySetting.active', 'Months of work in hand divides {{currency}} work in hand by this monthly capacity.', { currency: orgCurrency })}
      </p>
    </section>
  );
};

export default OrgWorkInHandCapacity;

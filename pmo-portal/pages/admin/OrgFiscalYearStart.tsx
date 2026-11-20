import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, SelectField, useToast } from '@/src/components/ui';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { repositories } from '@/src/lib/repositories';
import { SESSION_QUERY_OPTIONS } from '@/src/lib/queryPolicies';
import { formatUtcMonthLong } from '@/src/lib/format';

export const ORG_FISCAL_YEAR_KEY = 'org-fiscal-year-setting';

/**
 * Administration › Accounting › Fiscal year (#2329, migration 1018).
 *
 * An organization with no accounting system states the month its fiscal year starts; PMO places each payment in a
 * fiscal year by its date and the Budget tab cuts recorded spending by those years. Where an accounting system is read
 * it keeps its own calendar, so this section only says so. Admin-only via `can('manage', 'orgAccounting')` (UX); the
 * server setter enforces the same rule (ADR-0016).
 */
const OrgFiscalYearStart: React.FC = () => {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const queryKey = [ORG_FISCAL_YEAR_KEY, currentUser?.org_id];
  const query = useQuery({
    queryKey,
    queryFn: () => repositories.orgSettings.getFiscalYearSetting(),
    enabled: Boolean(currentUser),
    ...SESSION_QUERY_OPTIONS,
  });
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const saved = query.data?.startMonth == null ? '' : String(query.data.startMonth);
  const value = draft ?? saved;

  // Month names in the viewer's date locale (the format seam caches the formatter).
  const monthNames = Array.from({ length: 12 }, (_, index) => formatUtcMonthLong(new Date(Date.UTC(2001, index, 1))));
  const options = [
    { value: '', label: t('admin.fiscalYear.notSet', 'Not set') },
    ...monthNames.map((name, index) => ({ value: String(index + 1), label: name })),
  ];

  const mutation = useMutation({
    mutationFn: (month: number | null) => repositories.orgSettings.setFiscalYearStartMonth(month),
    onSuccess: async () => {
      setDraft(null);
      // Every fiscal-year cut reads this setting: refresh the calendar and the comparisons built on it.
      await Promise.all([
        qc.invalidateQueries({ queryKey }),
        qc.invalidateQueries({ queryKey: ['budget-project-calendar'] }),
        qc.invalidateQueries({ queryKey: ['budget-comparison'] }),
      ]);
      toast(t('admin.fiscalYear.saved', 'Fiscal year saved'), undefined, 'success');
    },
    onError: (err) => {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    },
  });

  const heading = t('admin.fiscalYear.title', 'Fiscal year');
  const monthLabel = query.data?.startMonth ? monthNames[query.data.startMonth - 1] : t('admin.fiscalYear.notSet', 'Not set');

  return (
    <section id="org-fiscal-year" tabIndex={-1} className="scroll-mt-4" aria-labelledby="org-fiscal-year-heading">
      <h2 id="org-fiscal-year-heading" className="text-group font-semibold tracking-[-0.01em]">{heading}</h2>
      <div className="mt-3 max-w-md">
        {query.isError && !query.data ? (
          <ListState
            variant="error"
            title={t('admin.fiscalYear.loadError', "Couldn't load the fiscal year")}
            onRetry={() => void query.refetch()}
          />
        ) : !query.data ? (
          <ListState variant="loading" rows={1} />
        ) : query.data.source === 'accounting_system' ? (
          <p className="text-control text-muted-foreground">
            {t('admin.fiscalYear.accountingSystem', 'Your accounting system sets the fiscal year.')}
          </p>
        ) : canManage ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError(undefined);
              mutation.mutate(value === '' ? null : Number(value));
            }}
          >
            <SelectField
              id="org-fiscal-year-select"
              label={t('admin.fiscalYear.label', 'Fiscal year starts in')}
              value={value}
              onChange={(next) => { setDraft(next); setError(undefined); }}
              options={options}
              disabled={mutation.isPending}
              helper={t('admin.fiscalYear.helper', 'PMO places each payment in a fiscal year by its date, and the Budget tab shows spending per year. Changing the month re-sorts every past payment.')}
            />
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" variant="primary" disabled={mutation.isPending || value === saved}>
              {t('admin.fiscalYear.save', 'Save fiscal year')}
            </Button>
          </form>
        ) : (
          <p className="text-control">
            <span className="font-semibold">{monthLabel}</span>
            <span className="ml-2 text-muted-foreground">{t('admin.fiscalYear.adminOnly', 'Only an Admin can change this.')}</span>
          </p>
        )}
      </div>
    </section>
  );
};

export default OrgFiscalYearStart;

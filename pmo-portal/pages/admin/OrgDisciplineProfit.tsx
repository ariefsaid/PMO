import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, SelectField, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { useDisciplineProfitEnabled, useSetDisciplineProfitEnabled } from '@/src/hooks/useDisciplineProfit';

/**
 * Administration > Accounting > Profit per discipline (#2669). One organisation setting, off by default: while off,
 * no screen shows revenue per discipline. Admin-only via `can('manage', 'orgAccounting')` (UX); the setter enforces
 * the same rule in the database (ADR-0016).
 */
const OrgDisciplineProfit: React.FC = () => {
  const { t } = useTranslation('workOrderPva');
  const canManage = usePermission()('manage', 'orgAccounting');
  const { toast } = useToast();
  const query = useDisciplineProfitEnabled();
  const mutation = useSetDisciplineProfitEnabled();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string>();
  const saved = query.data ? 'on' : 'off';
  const value = draft ?? saved;
  const options = [{ value: 'off', label: t('profit.setting.off', 'Off') }, { value: 'on', label: t('profit.setting.on', 'On') }];

  return (
    <section id="org-discipline-profit" tabIndex={-1} className="scroll-mt-4" aria-labelledby="org-discipline-profit-heading">
      <h2 id="org-discipline-profit-heading" className="text-group font-semibold tracking-[-0.01em]">{t('profit.setting.title', 'Profit per discipline')}</h2>
      <div className="mt-3 max-w-md">
        {query.isError && query.data === undefined ? (
          <ListState variant="error" title={t('profit.setting.loadError', 'Couldn\'t load the setting')} onRetry={() => void query.refetch()} />
        ) : query.data === undefined ? (
          <ListState variant="loading" rows={1} />
        ) : canManage ? (
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              setError(undefined);
              mutation.mutate(value === 'on', {
                onSuccess: () => { setDraft(null); toast(t('profit.setting.saved', 'Setting saved'), undefined, 'success'); },
                onError: (err) => { const { headline, detail } = classifyMutationError(err); setError(detail || headline); },
              });
            }}
          >
            <SelectField
              id="org-discipline-profit-select"
              label={t('profit.setting.label', 'Show revenue next to cost per discipline')}
              value={value}
              onChange={(next) => { setDraft(next); setError(undefined); }}
              options={options}
              disabled={mutation.isPending}
              helper={t('profit.setting.helper', 'Adds a table to the project\'s plan-vs-actual section and a discipline field on contract lines. Off by default.')}
            />
            {error && <FieldError>{error}</FieldError>}
            <Button type="submit" variant="primary" disabled={mutation.isPending || value === saved}>{t('profit.setting.save', 'Save')}</Button>
          </form>
        ) : (
          <p className="text-control">
            <span className="font-semibold">{query.data ? t('profit.setting.on', 'On') : t('profit.setting.off', 'Off')}</span>
            <span className="ml-2 text-muted-foreground">{t('profit.setting.adminOnly', 'Only an Admin can change this.')}</span>
          </p>
        )}
      </div>
    </section>
  );
};

export default OrgDisciplineProfit;

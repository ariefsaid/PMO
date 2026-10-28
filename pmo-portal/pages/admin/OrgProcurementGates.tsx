import React, { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { FieldError, ListState, Switch } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import type { ProcurementGates } from '@/src/lib/db/orgs';
import { PROCUREMENT_GATES_KEY } from '@/src/hooks/useProcurementGates';

const RULES: { key: keyof ProcurementGates; label: string; help: string }[] = [
  { key: 'request_before_order', label: 'Request required before order', help: 'When on, an order needs a purchase request first.' },
  { key: 'approval_before_order', label: 'Approval required before order', help: 'When on, an order needs an approved request first.' },
  { key: 'receipt_before_invoice', label: 'Receipt required before invoice', help: 'When on, a supplier invoice needs a goods receipt first.' },
  { key: 'approval_before_payment', label: 'Approval required before payment', help: 'When on, a payment needs an approved amount first.' },
];

/** One rule: a switch named by its visible text, with what it does when on; the whole row is the click target. */
const RuleSwitch: React.FC<{ label: string; help: string; on: boolean; disabled: boolean; onToggle: (next: boolean) => void }> = ({ label, help, on, disabled, onToggle }) => {
  const labelId = useId();
  const helpId = useId();
  return (
    <li>
      <label className={cn('flex min-h-11 items-start gap-3 py-1.5 text-[13px]', disabled ? 'cursor-default' : 'cursor-pointer')}>
        <Switch checked={on} onChange={onToggle} labelledBy={labelId} describedBy={helpId} disabled={disabled} className="mt-0.5" />
        <span className="min-w-0">
          <span id={labelId} className="block font-medium">{label}</span>
          <span id={helpId} className="block text-muted-foreground">{help}</span>
        </span>
      </label>
    </li>
  );
};

/**
 * FR-PFE-011 — the org's four purchase rules, all off by default (a purchase can start at any step). Anyone who can open
 * Administration sees them; only an Admin changes them. UX gate only — `set_procurement_gates` is the authority.
 */
export default function OrgProcurementGates() {
  const { t } = useTranslation();
  const orgId = useAuth().currentUser?.org_id;
  const canManage = usePermission()('manage', 'orgAccounting');
  const qc = useQueryClient();
  const queryKey = [PROCUREMENT_GATES_KEY, orgId];
  const query = useQuery({ queryKey, queryFn: () => repositories.orgSettings.getProcurementGates(), enabled: Boolean(orgId) });
  const mutation = useMutation({
    mutationFn: (patch: Partial<ProcurementGates>) => repositories.orgSettings.setProcurementGates(patch),
    onSuccess: (gates) => qc.setQueryData(queryKey, gates),
  });
  const saveError = mutation.isError ? classifyMutationError(mutation.error) : null;

  return (
    <section aria-labelledby="procurement-gates-heading">
      <h2 id="procurement-gates-heading" tabIndex={-1} className="scroll-mt-4 text-[15px] font-semibold">
        {t('procurement:gates.heading', 'Purchase rules')}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {t('procurement:gates.intro', 'All off: a purchase can start at any step. Turn a rule on only when your accounting needs it.')}
      </p>
      <div className="mt-3 max-w-md">
        {query.isError ? <ListState variant="error" title={t('procurement:gates.loadError', 'Couldn’t load purchase rules')} onRetry={() => void query.refetch()} />
          : query.isPending ? <ListState variant="loading" rows={4} />
          : (
            <ul className="space-y-1">
              {RULES.map(({ key, label, help }) => (
                <RuleSwitch
                  key={key}
                  label={t(`procurement:gates.${key}`, label)}
                  help={t(`procurement:gates.${key}Help`, help)}
                  on={query.data[key]}
                  disabled={!canManage || mutation.isPending}
                  onToggle={(next) => { mutation.reset(); mutation.mutate({ [key]: next }); }}
                />
              ))}
            </ul>
          )}
        {!canManage && <p className="mt-2 text-[13px] text-muted-foreground">{t('procurement:gates.onlyAdmin', 'Only an Admin can change this.')}</p>}
        <p role="status" className="mt-1 min-h-5 text-[13px] text-muted-foreground">
          {mutation.isPending ? t('procurement:gates.saving', 'Saving…') : mutation.isSuccess ? t('procurement:gates.saved', 'Saved') : ''}
        </p>
        {saveError && <FieldError>{saveError.detail || saveError.headline}</FieldError>}
      </div>
    </section>
  );
}

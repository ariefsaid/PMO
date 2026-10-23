import React, { useId } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { usePermission } from '@/src/auth/usePermission';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { FieldError, ListState } from '@/src/components/ui';
import { cn } from '@/src/components/ui/cn';
import type { ProcurementGates } from '@/src/lib/db/orgs';

const RULES: { key: keyof ProcurementGates; label: string }[] = [
  { key: 'request_before_order', label: 'Request required before order' },
  { key: 'approval_before_order', label: 'Approval required before order' },
  { key: 'receipt_before_invoice', label: 'Receipt required before invoice' },
  { key: 'approval_before_payment', label: 'Approval required before payment' },
];

const QUERY_KEY = 'org-procurement-gates';

/** One rule: a switch named by its visible text; the whole row is the click target. */
const RuleSwitch: React.FC<{ label: string; on: boolean; disabled: boolean; onToggle: () => void }> = ({ label, on, disabled, onToggle }) => {
  const labelId = useId();
  return (
    <li>
      <label className={cn('flex min-h-8 items-center gap-3 text-[13px]', disabled ? 'cursor-default' : 'cursor-pointer')}>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={labelId}
          disabled={disabled}
          onClick={onToggle}
          className={cn(
            'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-border transition-colors disabled:opacity-60',
            on ? 'bg-primary' : 'bg-muted',
          )}
        >
          <span aria-hidden className={cn('pointer-events-none size-4 rounded-full bg-background shadow-sm transition-transform', on ? 'translate-x-4' : 'translate-x-0.5')} />
        </button>
        <span id={labelId}>{label}</span>
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
  const queryKey = [QUERY_KEY, orgId];
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
              {RULES.map(({ key, label }) => (
                <RuleSwitch
                  key={key}
                  label={t(`procurement:gates.${key}`, label)}
                  on={query.data[key]}
                  disabled={!canManage || mutation.isPending}
                  onToggle={() => { mutation.reset(); mutation.mutate({ [key]: !query.data[key] }); }}
                />
              ))}
            </ul>
          )}
        {!canManage && <p className="mt-2 text-[13px] text-muted-foreground">{t('procurement:gates.onlyAdmin', 'Only an Admin can change this.')}</p>}
        {saveError && <FieldError>{saveError.detail || saveError.headline}</FieldError>}
      </div>
    </section>
  );
}

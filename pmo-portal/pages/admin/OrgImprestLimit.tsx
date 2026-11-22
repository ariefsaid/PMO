import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/src/auth/useAuth';
import { useFeature } from '@/src/auth/useFeature';
import { useOptionalRealRole } from '@/src/auth/impersonation';
import { repositories } from '@/src/lib/repositories';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { Button, FieldError, TextField } from '@/src/components/ui';
import { useOrgCurrencyState } from '@/src/hooks/useOrgCurrency';
import { formatCurrency, parseMoneyInputAtScale } from '@/src/lib/format';

/**
 * The organisation's site-cash limit: the largest single spend site cash covers. Site cash cannot be set up until it exists.
 * Admin sets it (`set_imprest_procurement_limit` is the authority); everyone else sees the value. Shown only when Site cash is on.
 */
export default function OrgImprestLimit() {
  const { t } = useTranslation();
  const on = useFeature('imprest');
  const orgId = useAuth().currentUser?.org_id;
  // Admin only, as `set_imprest_procurement_limit` is: the real role, not the role being viewed as.
  const canManage = useOptionalRealRole() === 'Admin';
  const orgCurrency = useOrgCurrencyState();
  const qc = useQueryClient();
  const queryKey = ['imprest-limit', orgId];
  const query = useQuery({ queryKey, queryFn: () => repositories.imprest.getProcurementLimit(), enabled: Boolean(orgId) && on });
  const [draft, setDraft] = useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (amount: number) => repositories.imprest.setProcurementLimit(amount),
    onSuccess: () => { setDraft(null); void qc.invalidateQueries({ queryKey }); },
  });
  if (!on) return null;
  const current = query.data ?? null;
  const shown = draft ?? (current === null ? '' : String(current));
  const parsed = parseMoneyInputAtScale(shown, 2);
  const valid = parsed !== null && parsed > 0;
  const saveError = mutation.isError ? classifyMutationError(mutation.error) : null;
  return (
    <div className="mt-6 max-w-md" data-testid="org-imprest-limit">
      <h3 className="text-control font-semibold">{t('procurement:gates.imprestLimit.heading', 'Site cash limit')}</h3>
      <p className="mt-1 text-control text-muted-foreground">
        {t('procurement:gates.imprestLimit.help', 'The largest single spend site cash covers. Set it before setting up site cash. Only an Admin can set it.')}
      </p>
      {current === null && query.isSuccess && (
        <p className="mt-1 text-control text-muted-foreground">{t('procurement:gates.imprestLimit.notSet', 'Not set yet. Site cash cannot be set up until it is.')}</p>
      )}
      {current !== null && orgCurrency.isResolved && (
        <p className="mt-1 text-control">{t('procurement:gates.imprestLimit.current', 'Current limit: {{amount}}', { amount: formatCurrency(current, orgCurrency.currency) })}</p>
      )}
      <div className="mt-2 flex items-end gap-2">
        <TextField label={t('procurement:gates.imprestLimit.label', 'Limit per spend')} inputMode="decimal" value={shown}
          onChange={(v: string) => setDraft(v)} disabled={!canManage} />
        {canManage && (
          <Button variant="primary" size="sm" disabled={!valid || draft === null} loading={mutation.isPending}
            onClick={() => { if (parsed !== null) { mutation.reset(); mutation.mutate(parsed); } }}>
            {t('procurement:gates.imprestLimit.save', 'Save limit')}
          </Button>
        )}
      </div>
      {mutation.isSuccess && <p role="status" className="mt-1 text-control text-muted-foreground">{t('procurement:gates.saved', 'Saved')}</p>}
      {saveError && <FieldError>{saveError.detail || saveError.headline}</FieldError>}
    </div>
  );
}

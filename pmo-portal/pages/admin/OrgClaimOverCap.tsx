import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { useAuth } from '@/src/auth/useAuth';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { claimOverCapRepository } from '@/src/lib/repositories/claimOverCap';
import { CLAIM_OVER_CAP_KEY, useClaimOverCap } from '@/src/hooks/useClaimOverCap';

/**
 * Administration › Accounting › Claims over the claimable quantity (survey-cap-stop). One organization setting: warn only (default,
 * today's behaviour) or refuse. Admin-only via `can('manage', 'orgAccounting')` (UX); RLS and an Admin-only column grant enforce it (ADR-0016).
 */
const OrgClaimOverCap: React.FC = () => {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const { currentUser } = useAuth();
  const orgId = currentUser?.org_id as string;
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useClaimOverCap();
  const [error, setError] = useState<string>();
  const blocking = query.data === 'block';

  const mutation = useMutation({
    mutationFn: (next: 'warn' | 'block') => claimOverCapRepository.set(orgId, next),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [CLAIM_OVER_CAP_KEY] });
      toast(t('admin.claimOverCap.saved', 'Claim quantity setting saved'), undefined, 'success');
    },
    onError: (err) => {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    },
  });

  return (
    <section id="org-claim-over-cap" tabIndex={-1} className="scroll-mt-4" aria-labelledby="org-claim-over-cap-heading">
      <h2 id="org-claim-over-cap-heading" className="text-group font-semibold tracking-[-0.01em]">
        {t('admin.claimOverCap.title', 'Claims over the claimable quantity')}
      </h2>
      <div className="mt-3 max-w-md space-y-3">
        {query.isError && !query.data ? (
          <ListState variant="error" title={t('admin.claimOverCap.loadError', "Couldn't load the claim quantity setting")} onRetry={() => void query.refetch()} />
        ) : query.data === undefined ? (
          <ListState variant="loading" rows={1} />
        ) : (
          <>
            <p className="text-control text-muted-foreground">
              {t('admin.claimOverCap.helper', 'A claim line is measured against the quantity still claimable on its work order line: the surveyed quantity when there is one, otherwise the accepted (BAST) quantity, otherwise the ordered quantity, less what live claims already took. Warn only lets the claim through with a warning on the form. Refuse stops the claim until the quantity is lowered or the next acceptance is confirmed.')}
            </p>
            <p className="text-control">
              <span className="font-semibold">{blocking ? t('admin.claimOverCap.block', 'Refuse') : t('admin.claimOverCap.warn', 'Warn only')}</span>
              {!canManage && <span className="ml-2 text-muted-foreground">{t('admin.claimOverCap.adminOnly', 'Only an Admin can change this.')}</span>}
            </p>
            {error && <FieldError>{error}</FieldError>}
            {canManage && (
              <Button
                variant={blocking ? 'outline' : 'primary'}
                disabled={mutation.isPending}
                onClick={() => { setError(undefined); mutation.mutate(blocking ? 'warn' : 'block'); }}
              >
                {blocking ? t('admin.claimOverCap.turnOff', 'Only warn on claims over the claimable quantity') : t('admin.claimOverCap.turnOn', 'Refuse claims over the claimable quantity')}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default OrgClaimOverCap;

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, FieldError, ListState, useToast } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { classifyMutationError } from '@/src/lib/classifyMutationError';
import { hidePricesRepository } from '@/src/lib/repositories/hidePrices';
import { HIDE_PRICES_ENABLED_KEY, useHidePricesEnabled } from '@/src/hooks/useHidePrices';

/**
 * Administration › People › Hide prices from requesters (#2699). One organization setting, off by default: while off, every screen is
 * what it was. Admin-only via `can('manage', 'orgAccounting')` (UX); the server setter enforces it (ADR-0016).
 */
const OrgHidePrices: React.FC = () => {
  const { t } = useTranslation('administration');
  const may = usePermission();
  const canManage = may('manage', 'orgAccounting');
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useHidePricesEnabled();
  const [error, setError] = useState<string>();
  const enabled = query.data === true;

  const mutation = useMutation({
    mutationFn: (next: boolean) => hidePricesRepository.setEnabled(next),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: [HIDE_PRICES_ENABLED_KEY] });
      toast(t('admin.hidePrices.saved', 'Hide prices setting saved'), undefined, 'success');
    },
    onError: (err) => {
      const { headline, detail } = classifyMutationError(err);
      setError(detail || headline);
    },
  });

  return (
    <section id="org-hide-prices" tabIndex={-1} className="scroll-mt-4 mt-8 border-t border-border pt-6" aria-labelledby="org-hide-prices-heading">
      <h2 id="org-hide-prices-heading" className="text-group font-semibold tracking-[-0.01em]">
        {t('admin.hidePrices.title', 'Hide prices from requesters')}
      </h2>
      <div className="mt-3 max-w-md space-y-3">
        {query.isError && !query.data ? (
          <ListState variant="error" title={t('admin.hidePrices.loadError', "Couldn't load the hide prices setting")} onRetry={() => void query.refetch()} />
        ) : query.data === undefined ? (
          <ListState variant="loading" rows={1} />
        ) : (
          <>
            <p className="text-control text-muted-foreground">
              {t('admin.hidePrices.helper', 'Hide unit prices and amounts from people who only request items: field and officer roles outside purchasing and finance, and Engineers without a built-in role. Quantities and statuses stay visible. Everyone else sees prices as before.')}
            </p>
            <p className="text-control">
              <span className="font-semibold">{enabled ? t('admin.hidePrices.on', 'On') : t('admin.hidePrices.off', 'Off')}</span>
              {!canManage && <span className="ml-2 text-muted-foreground">{t('admin.hidePrices.adminOnly', 'Only an Admin can change this.')}</span>}
            </p>
            {error && <FieldError>{error}</FieldError>}
            {canManage && (
              <Button
                variant={enabled ? 'outline' : 'primary'}
                disabled={mutation.isPending}
                onClick={() => { setError(undefined); mutation.mutate(!enabled); }}
              >
                {enabled ? t('admin.hidePrices.turnOff', 'Show prices to requesters again') : t('admin.hidePrices.turnOn', 'Hide prices from requesters')}
              </Button>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default OrgHidePrices;

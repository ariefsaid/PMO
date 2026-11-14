import React from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Icon, ListState } from '@/src/components/ui';
import { tierLabel, domainLabel } from './integrationLabels';
import type { ExternalTier } from '@/src/lib/repositories/types';

/**
 * The "Information updated from connected services" panel of the organization integrations
 * surface (extracted from IntegrationsView, #1941) — the read-only employed-domains view
 * (AC-IRUX-007). One card per connectable tier lists the domains that tier keeps current.
 *
 * The ownership query lives in the view; the panel renders its states (pending / error /
 * empty / rows) and derives the per-tier domain grouping itself.
 */
interface OwnershipDomainsPanelProps {
  query: {
    isPending?: boolean;
    isError?: boolean;
    refetch: () => void;
    data: ReadonlyArray<{ externalTier: string; domain: string }> | undefined;
  };
  /** Connectable tiers, in display order (odoo never employs ownership domains). */
  tiers: ReadonlyArray<ExternalTier>;
}

export const OwnershipDomainsPanel: React.FC<OwnershipDomainsPanelProps> = ({ query, tiers }) => {
  const { t } = useTranslation();
  const ownershipRows = query?.data ?? [];
  // Group employed domains by tier (from external_domain_ownership)
  const domainsByTier: Record<ExternalTier, string[]> = {
    clickup: [],
    erpnext: [],
    odoo: [],
  };
  ownershipRows.forEach((r) => {
    if (r.externalTier === 'clickup' || r.externalTier === 'erpnext') {
      domainsByTier[r.externalTier].push(r.domain);
    }
  });

  return (
    <div className="mt-6">
      <h4 className="mb-3 text-sm font-semibold text-foreground">
        {t('uxs07.ownershipTitle', 'Information updated from connected services')}
      </h4>
      <div data-testid="integrations-tier-list">
      {query?.isPending ? (
        <div className="rounded-lg border border-border bg-card">
          <p className="px-4 pt-4 text-sm text-muted-foreground" role="status">
            {t('uxs07.ownershipLoading', 'Checking which information is updated automatically…')}
          </p>
          <ListState variant="loading" rows={2} />
        </div>
      ) : query?.isError ? (
        <div data-testid="ownership-error">
          <ListState
            variant="error"
            title={t('uxs07.ownershipUnavailable', 'Automatic updates unavailable')}
            sub={t('uxs07.ownershipUnavailableHelp', 'PMO could not check which information updates automatically. Try again.')}
            onRetry={query.refetch}
            retryLabel={t('integrations.organization.readiness.retry', 'Retry')}
          />
        </div>
      ) : ownershipRows.length === 0 ? (
        <div className="flex flex-col gap-3.5">
          <div className="rounded-lg border border-border bg-card" data-testid="ownership-empty">
            <ListState
              variant="empty"
              title={t('uxs07.ownershipEmpty', 'No information is set to update automatically')}
            />
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          {tiers.map((tier) => {
            const domains = domainsByTier[tier] ?? [];
            if (domains.length === 0) return null;
            return (
              <Card key={tier} className="p-4" data-tier={tier}>
                <div className="flex items-center gap-2">
                  <Icon name="plug" />
                  <h3 className="text-group text-foreground font-semibold">{tierLabel(tier)}</h3>
                </div>
                <ul className="mt-2.5 flex flex-wrap gap-1.5">
                  {domains.map((d) => (
                    <li key={d} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground">
                      {domainLabel(d)}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm text-muted-foreground">
                    {t('uxs07.ownershipDomains', '{{service}} updates {{count}} information areas here.', { count: domains.length, service: tierLabel(tier) })}
                </p>
                {tier === 'clickup' && (
                  <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                    <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
                    <span>{t('integrations.organization.readiness.clickupLocation', 'Data resides with ClickUp (US-hosted).')}</span>
                  </p>
                )}
                {tier === 'erpnext' && (
                  <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                    <Icon name="info" className="size-3.55 shrink-0" aria-hidden="true" />
                    <span>{t('integrations.organization.readiness.erpLocation', 'Data resides on your ERPNext instance.')}</span>
                  </p>
                )}
              </Card>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
};

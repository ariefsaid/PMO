import React from 'react';
import { ListState, Card, Icon } from '@/src/components/ui';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';
import { tierLabel, domainLabel } from './integrationLabels';

/**
 * Read-only Integrations view (FR-EAS-007, AC-EAS-015). Shows the caller's org's employed external
 * tiers + the consequently externally-owned domains; an explicit empty state when none are employed.
 * NO write affordances — writes are Operator-provisioned (FR-EAS-006, OD-1).
 *
 * A section of the Administration page (the Usage/Credits/Features pattern) — the host page
 * provides the `SectionHeader`; this component renders only the section body.
 */
export const IntegrationsView: React.FC = () => {
  const { data, isPending, isError } = useExternalDomainOwnership();
  const rows = data ?? [];

  // Group by tier: tier → owned domains (ordered).
  const byTier = rows.reduce<Record<string, string[]>>((acc, r) => {
    (acc[r.externalTier] ??= []).push(r.domain);
    return acc;
  }, {});
  const tiers = Object.keys(byTier).sort();
  const isEmpty = !isPending && !isError && rows.length === 0;

  return (
    <div>
      {isPending && (
        <div className="rounded-lg border border-border bg-card">
          <ListState variant="loading" rows={3} />
        </div>
      )}
      {isError && (
        <ListState
          variant="error"
          title="Couldn't load integrations"
          sub="The request failed. Check your connection and try again."
        />
      )}
      {isEmpty && (
        <ListState
          variant="empty"
          icon="plug"
          title="No external systems employed"
          sub="Employing an external system (an ERP or task platform) makes it the source of truth for the domains it owns. Your platform operator sets this up."
        />
      )}
      {rows.length > 0 && (
        <div className="flex flex-col gap-3.5" data-testid="integrations-tier-list">
          {tiers.map((tier) => (
            <Card key={tier} className="p-4">
              <div className="flex items-center gap-2">
                <Icon name="plug" />
                <h3 className="text-[15px] text-foreground font-semibold">{tierLabel(tier)}</h3>
              </div>
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {byTier[tier].map((d) => (
                  <li key={d} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground">
                    {domainLabel(d)}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-muted-foreground">
                Owns {byTier[tier].length} {byTier[tier].length === 1 ? 'domain' : 'domains'} as source of truth.
              </p>
              {tier === 'clickup' && (
                <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  <Icon name="info" className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>ClickUp is US-hosted SaaS — task-domain data resides with ClickUp</span>
                </p>
              )}
              {/* task FIX-3 (Discover IMPORTANT) — the parallel self-hosted residency note (ADR-0048/0055). */}
              {tier === 'erpnext' && (
                <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                  <Icon name="info" className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>Self-hosted ERP — data resides on your ERPNext instance</span>
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default IntegrationsView;

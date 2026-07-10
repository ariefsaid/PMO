import React from 'react';
import { ListPage, ListState, Card, Icon } from '@/src/components/ui';
import { useExternalDomainOwnership } from '@/src/hooks/useExternalDomainOwnership';

/**
 * Read-only Integrations view (FR-EAS-007, AC-EAS-015). Shows the caller's org's employed external
 * tiers + the consequently externally-owned domains; an explicit empty state when none are employed.
 * NO write affordances — writes are Operator-provisioned (FR-EAS-006, OD-1).
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
    <ListPage
      title="Integrations"
      description="External systems employed by your organisation and the domains they own as source of truth."
    >
      {isPending && <ListState variant="loading" rows={3} />}
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
          sub="Every domain is owned by this PMO workspace. Employing an external system (an ERP or task platform) flips the domains it natively owns to it as source of truth — provisioned by your platform operator."
        />
      )}
      {rows.length > 0 && (
        <div className="flex flex-col gap-3.5" data-testid="integrations-tier-list">
          {tiers.map((tier) => (
            <Card key={tier} className="p-4">
              <div className="flex items-center gap-2">
                <Icon name="plug" />
                <h3 className="text-foreground font-semibold">{tier}</h3>
              </div>
              <ul className="mt-2.5 flex flex-wrap gap-1.5">
                {byTier[tier].map((d) => (
                  <li key={d} className="rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground">
                    {d}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-muted-foreground">
                Owns {byTier[tier].length} {byTier[tier].length === 1 ? 'domain' : 'domains'} as source of truth.
              </p>
            </Card>
          ))}
        </div>
      )}
    </ListPage>
  );
};

export default IntegrationsView;

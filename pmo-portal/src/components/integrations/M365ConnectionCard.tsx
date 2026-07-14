import React from 'react';
import { Card, Icon } from '@/src/components/ui';
import { useFeature } from '@/src/auth/useFeature';

/**
 * M365ConnectionCard — the org-Admin ACTIVATION surface for the Microsoft 365 integration
 * (m365-phase0-foundation, FR-M365-012/013; ADR-0058 two-switch model, ADR-0060 token custody).
 *
 * Rendered ONLY when the org is ENTITLED (`useFeature('m365_integration')`, the Operator switch)
 * AND the viewer is an Admin (`isAdmin`, the real-JWT-role gate — ADR-0016; RLS is the real
 * authority). Live OAuth connect is HELD in Phase 0 (owner sub-decisions D1/D2 + a security-auditor
 * gate, ADR-0060 Phase-0 follow-ups), so the connect affordance is a DISABLED "available soon" stub
 * that initiates no OAuth flow and no navigation.
 */
export const M365ConnectionCard: React.FC<{ isAdmin: boolean }> = ({ isAdmin }) => {
  const entitled = useFeature('m365_integration');
  if (!entitled || !isAdmin) return null;
  return (
    <Card className="mb-3.5 p-4" data-testid="m365-connection-card">
      <div className="flex items-center gap-2">
        <Icon name="plug" />
        <h3 className="text-[15px] text-foreground font-semibold">Microsoft 365</h3>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Not connected. Link your Microsoft 365 tenant to bring OneDrive documents, Teams, and
        calendar into your projects.
      </p>
      <button
        type="button"
        disabled
        aria-disabled="true"
        className="mt-3 inline-flex h-8 items-center rounded-md border border-border bg-secondary px-3 text-sm font-semibold text-muted-foreground"
      >
        Connect Microsoft 365 — available soon
      </button>
    </Card>
  );
};

export default M365ConnectionCard;

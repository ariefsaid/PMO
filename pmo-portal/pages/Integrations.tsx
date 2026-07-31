import React from 'react';
import { M365ConnectionCard } from '@/src/components/integrations/M365ConnectionCard';

/**
 * Integrations — the PERSONAL connect surface (m365-operator-client-separation, D2 / OQ-A).
 *
 * The Microsoft 365 connection card is per-user in substance (`connection_status` is own-row
 * scoped) but used to live ONLY on the Admin-only `/administration` route (AdminUsers.tsx), so a
 * Project Manager — entitled by the edge fn's data-access gate — passed the gate and still never
 * saw the card. FR-M365SEP-016: the personal connect affordance shall be reachable by ANY active
 * member. This route is that home, and it is the route the token-custody callback redirects to
 * (Phase A — `/integrations?m365_connected=true` / `?m365_error=<msg>`).
 *
 * Renders the card and nothing else. The card gates itself on the `m365_integration` entitlement
 * (UX-only — ADR-0016; the edge fn's `authorizeMemberEntitled` is the enforcement authority). When
 * a second personal integration appears, extend here; until then one card, one route, one nav entry.
 */
const IntegrationsPage: React.FC = () => (
  <div>
    {/* C-MIN-3: page-level h1 so screen readers + document.querySelector('h1') find a level-1
        heading. Token: DESIGN.md page-title (24px / 700 / –0.02em), matching every other page. */}
    <h1 className="text-[24px] font-bold tracking-[-0.02em]">Integrations</h1>
    {/* max-width prose column (DESIGN.md content rhythm) — a single personal-connect card. */}
    <div className="mt-4 max-w-xl">
      <M365ConnectionCard />
    </div>
  </div>
);

export default IntegrationsPage;

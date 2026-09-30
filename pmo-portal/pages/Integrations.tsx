import React from 'react';
import { useTranslation } from 'react-i18next';
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
 * AC-ADMIA-006: this route is the PERSONAL surface. Its heading and copy identify it as "My
 * integrations" and explicitly separate it from the ORGANIZATION-owned surface at
 * `/administration/integrations` — a personal connection never implies organization readiness.
 *
 * Renders the card and nothing else. The card gates itself on the `m365_integration` entitlement
 * (UX-only — ADR-0016; the edge fn's `authorizeMemberEntitled` is the enforcement authority). When
 * a second personal integration appears, extend here; until then one card, one route, one nav entry.
 */
const IntegrationsPage: React.FC = () => {
  const { t } = useTranslation();
  return (
    <div>
      {/* C-MIN-3: page-level h1 so screen readers + document.querySelector('h1') find a level-1
          heading. Token: DESIGN.md page-title (24px / 700 / –0.02em), matching every other page. */}
      <h1 className="text-[24px] font-bold tracking-[-0.02em]">
        {t('integrations.personal.title', 'My integrations')}
      </h1>
      {/* max-width prose column (DESIGN.md content rhythm) — a single personal-connect card. */}
      <p className="mt-1 max-w-xl text-sm text-muted-foreground">
        {t(
          'integrations.personal.description',
          'Connect your personal Microsoft 365 account so PMO Portal can reach the content your account has access to. This is separate from your organization’s Administration integrations.',
        )}
      </p>
      <div className="mt-4 max-w-xl">
        <M365ConnectionCard />
      </div>
    </div>
  );
};

export default IntegrationsPage;
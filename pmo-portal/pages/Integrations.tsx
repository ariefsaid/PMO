import React from 'react';
import { useTranslation } from 'react-i18next';
import { PageHeader } from '@/src/components/ui';
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
      <PageHeader
        title={t('integrations.personal.title', 'My integrations')}
        help={t('integrations.personal.description', 'Your own Microsoft 365 account, so PMO Portal can reach the content it has access to. Separate from the organization setup under Administration.')}
        helpSubject={t('integrations.personal.title', 'My integrations')}
      />
      <div className="mt-4 max-w-xl">
        <M365ConnectionCard showUnavailable />
      </div>
    </div>
  );
};

export default IntegrationsPage;
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Icon } from '@/src/components/ui';
import { usePermission } from '@/src/auth/usePermission';
import { initiateM365OrgApproval } from '@/src/lib/m365/connectClient';
import { m365ErrorReason } from '@/src/lib/m365/errorCopy';

/**
 * M365OrgApprovalCard — step 2 of the three-step M365 connection model (ADR-0063 §3, spec
 * m365-operator-client-separation §1.1). The client's OWN admin approves the PMO app for their
 * whole Microsoft organisation — a one-time org-level administrative act at Microsoft, distinct from
 * the operator turning the feature on (step 1) and from each user connecting their own account
 * (step 3). Step 2 lives on the admin integrations surface BESIDE ClickUp and ERPNext.
 *
 * Two gates, never one decision (NFR-M365SEP-001): this card is the ACTIVATION gate (Admin-of-org OR
 * Operator, FR-M365SEP-004 — the same shape ADR-0065 applies to ClickUp/ERPNext connect). Step 3's
 * data-access gate (`authorizeMemberEntitled`) is a different question answered elsewhere. The two
 * may share code; they must not share one decision.
 *
 * FE gate is Admin-only (`can('manage','integration')`), matching the ClickUp/ERPNext connect cards
 * — ADR-0016 (FE authz is UX-only): the edge fn re-enforces Admin-of-org OR platform Operator
 * service-side, so a hidden button is never the whole story. The FE cannot detect Operator status
 * (a server-side table), so it is stricter (Admin-only) — permitted, never looser than the edge fn.
 *
 * Persists nothing (NFR-M365SEP-005, spec §1.5): the card sends the admin to Microsoft's admin-
 * consent URL and records no approval state — Microsoft is the authority; a stored flag would drift
 * the moment an admin revokes consent in Entra. On success the FE top-level-navigates to the consent
 * page (FR-M365SEP-005 — never in an iframe).
 *
 * Localized (#690, AC-M365LOC-006): every string goes through `t()` with its English default, and a
 * failure retains only the stable wire CODE — the message is derived at render from the SAME
 * code→copy table the personal card uses (`errorCopy`), so a language change updates a visible
 * error in place and a raw server message is never echoed.
 */
type OrgApprovalPhase = 'idle' | 'approving' | 'error';

export const M365OrgApprovalCard: React.FC = () => {
  const may = usePermission();
  // FE gate (UX-only, ADR-0016): Admin. Edge fn re-enforces Admin-of-org OR Operator.
  const canApprove = may('manage', 'integration');
  const [phase, setPhase] = useState<OrgApprovalPhase>('idle');
  const { t } = useTranslation();
  // Only the stable code is kept (never the message) — see the header note.
  const [error, setError] = useState<{ code?: string } | null>(null);
  // In-flight guard — a second synchronous click before React flushes stays a no-op.
  const approvingRef = useRef(false);

  const onApprove = useCallback(async () => {
    if (approvingRef.current) return;
    approvingRef.current = true;
    setPhase('approving');
    setError(null);
    try {
      const { adminConsentUrl } = await initiateM365OrgApproval();
      // Top-level navigation — Microsoft's consent page must be user-visible (FR-M365SEP-005).
      window.location.assign(adminConsentUrl);
      // Leave approvingRef set: the browser is navigating away; a stray second click stays a no-op.
    } catch (err) {
      approvingRef.current = false; // allow a retry after the failure surfaces
      setPhase('error');
      const code = (err as { code?: unknown } | null | undefined)?.code;
      setError({ code: typeof code === 'string' ? code : undefined });
    }
  }, []);

  if (!canApprove) return null;

  return (
    <Card className="mb-3.5 p-4" data-testid="m365-org-approval">
      <div className="flex items-center gap-2">
        <Icon name="plug" aria-hidden="true" />
        <h3 className="text-[15px] text-foreground font-semibold">
          {t('integrations.m365OrgApproval.heading', 'Microsoft 365')}
        </h3>
        <span className="rounded-full border border-border bg-muted/40 px-2 py-0.5 text-xs text-muted-foreground">
          {t('integrations.m365OrgApproval.badge', 'Organization approval')}
        </span>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {t(
          'integrations.m365OrgApproval.description',
          'Approve the PMO Portal app for your organization in Microsoft 365. This one-time step lets your team connect their own Microsoft 365 accounts to PMO Portal.',
        )}
      </p>

      {phase === 'error' && error && (
        <p
          className="mt-2 flex items-start gap-1.5 text-sm text-destructive"
          data-testid="m365-org-approval-error"
          role="alert"
        >
          <Icon name="alert" className="mt-[3px] size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {m365ErrorReason(
              t,
              error.code,
              t(
                'integrations.m365OrgApproval.errorFallback',
                'Could not start Microsoft 365 organization approval.',
              ),
            )}
          </span>
        </p>
      )}

      <div className="mt-3">
        <Button
          variant="outline"
          size="sm"
          onClick={onApprove}
          loading={phase === 'approving'}
          data-testid="m365-org-approval-btn"
        >
          <Icon name="export" className="size-3.5" aria-hidden="true" />
          {phase === 'approving'
            ? t('integrations.m365OrgApproval.approving', 'Opening Microsoft 365…')
            : t('integrations.m365OrgApproval.approve', 'Approve in Microsoft 365')}
        </Button>
      </div>
    </Card>
  );
};

export default M365OrgApprovalCard;

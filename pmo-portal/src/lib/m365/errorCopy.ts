// errorCopy.ts — the ONE M365 error-code → user-copy table (#690, AC-M365LOC-006), shared by the
// personal connect card and the organization-approval card. Before this, the personal card carried
// the table privately and the org card echoed the server's message; a code added on one side
// silently reached users as English or as the generic fallback.
//
// Keys live under `integrations.personalM365.errors.*` (the namespace the localization spec names);
// the org card reads the same keys — renaming them would only churn both catalogues.
//
// LITERAL keys only: the i18n completeness gate proves a key is referenced by scanning literal
// `t('key', …)` call sites, so a computed key would read as an orphan. English defaults come from
// `M365_ERROR_ENGLISH` (also `describeM365Error`'s source), so an empty catalogue still shows
// reviewed English rather than a raw key.
//
// NFR-M365-101/108: the raw server message, oid or token never reach the DOM — only these strings.
import type { TFunction } from 'i18next';

/** Reviewed English for the wire taxonomy (supabase/functions/m365-token-custody/types.ts `ERROR_STATUS`). */
export const M365_ERROR_ENGLISH = {
  NOT_ENTITLED: "Your organization isn't enabled for the Microsoft 365 integration yet.",
  // Connection-model (2026-07-30): membership-status and org-approval rejections are their OWN
  // outcomes, distinct from an entitlement rejection (NFR-M365SEP-006).
  DISABLED_MEMBER: 'Your account access has been disabled. Please contact your administrator.',
  BANNED_MEMBER: 'Your account is suspended. Please contact your administrator.',
  ORG_APPROVAL_REQUIRED:
    "Your organization hasn't approved the PMO Portal app yet. Ask your administrator to approve it in Microsoft 365.",
  FORBIDDEN:
    'Approving the PMO Portal app in Microsoft 365 is restricted to organization administrators and platform operators.',
  UNAUTHORIZED: 'Your session expired. Refresh the page and try again.',
  CONNECTION_STALE: 'The Microsoft 365 connection expired. Please reconnect.',
  CONNECTION_REVOKED: 'The Microsoft 365 connection was revoked. Connect again to continue.',
  NOT_CONNECTED: "Microsoft 365 isn't connected.",
  TOKEN_EXCHANGE_FAILED: 'Microsoft declined the connection. Please try again.',
  INVALID_STATE: 'The connection request expired. Please try again.',
  // The card's button reads "Connect Microsoft 365" in this state (not "Reconnect"), so the copy names it (#692).
  SCOPE_INSUFFICIENT: 'The connection needs additional permissions. Connect again to grant them.',
  BAD_REQUEST: 'The request was invalid. Please try again.',
  GRAPH_ERROR: 'Microsoft Graph is unavailable right now. Please try again shortly.',
  INTERNAL_ERROR: 'Something went wrong on our end. Please try again.',
} as const;

export type M365KnownCode = keyof typeof M365_ERROR_ENGLISH;

export const M365_ERROR_CODES = Object.keys(M365_ERROR_ENGLISH) as M365KnownCode[];

/** The localized reason for a known wire code, or `null` for an absent/unrecognized code. */
export function knownM365ErrorReason(t: TFunction, code: string | undefined): string | null {
  const en = M365_ERROR_ENGLISH;
  switch (code as M365KnownCode | undefined) {
    case 'NOT_ENTITLED':
      return t('integrations.personalM365.errors.notEntitled', en.NOT_ENTITLED);
    case 'DISABLED_MEMBER':
      return t('integrations.personalM365.errors.disabledMember', en.DISABLED_MEMBER);
    case 'BANNED_MEMBER':
      return t('integrations.personalM365.errors.bannedMember', en.BANNED_MEMBER);
    case 'ORG_APPROVAL_REQUIRED':
      return t('integrations.personalM365.errors.organizationApprovalRequired', en.ORG_APPROVAL_REQUIRED);
    case 'FORBIDDEN':
      return t('integrations.personalM365.errors.forbidden', en.FORBIDDEN);
    case 'UNAUTHORIZED':
      return t('integrations.personalM365.errors.unauthorized', en.UNAUTHORIZED);
    case 'CONNECTION_STALE':
      return t('integrations.personalM365.errors.connectionStale', en.CONNECTION_STALE);
    case 'CONNECTION_REVOKED':
      return t('integrations.personalM365.errors.connectionRevoked', en.CONNECTION_REVOKED);
    case 'NOT_CONNECTED':
      return t('integrations.personalM365.errors.notConnected', en.NOT_CONNECTED);
    case 'TOKEN_EXCHANGE_FAILED':
      return t('integrations.personalM365.errors.tokenExchangeFailed', en.TOKEN_EXCHANGE_FAILED);
    case 'INVALID_STATE':
      return t('integrations.personalM365.errors.invalidState', en.INVALID_STATE);
    case 'SCOPE_INSUFFICIENT':
      return t('integrations.personalM365.errors.scopeInsufficient', en.SCOPE_INSUFFICIENT);
    case 'BAD_REQUEST':
      return t('integrations.personalM365.errors.badRequest', en.BAD_REQUEST);
    case 'GRAPH_ERROR':
      return t('integrations.personalM365.errors.graphError', en.GRAPH_ERROR);
    case 'INTERNAL_ERROR':
      return t('integrations.personalM365.errors.internalError', en.INTERNAL_ERROR);
    default:
      return null;
  }
}

/** The reason for `code`, or the caller's already-localized context fallback for an unknown code. */
export function m365ErrorReason(t: TFunction, code: string | undefined, fallback: string): string {
  return knownM365ErrorReason(t, code) ?? fallback;
}

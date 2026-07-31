// pkce.ts — re-export of the shared graphPkce module (RFC 7636 PKCE + Microsoft authorize/admin-
// consent URL construction). Pure + Deno-global-free; imported cross-tree (ADR-0060 §1 D2).
export {
  generateCodeVerifier,
  codeChallengeS256,
  buildAuthorizeUrl,
  buildAdminConsentUrl,
  type AuthorizeUrlParams,
  type AdminConsentUrlParams,
} from '../../../pmo-portal/src/lib/m365/graphPkce.ts';

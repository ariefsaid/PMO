// pkce.ts — re-export of Phase-0 graphPkce (RFC 7636 PKCE + Microsoft authorize-URL construction).
// Pure + Deno-global-free; imported cross-tree (ADR-0060 §1 D2). MUST NOT be edited.
export {
  generateCodeVerifier,
  codeChallengeS256,
  buildAuthorizeUrl,
  type AuthorizeUrlParams,
} from '../../../pmo-portal/src/lib/m365/graphPkce.ts';

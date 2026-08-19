# Entra Option-B ceremony documentation

Added a public-safe, end-to-end runbook for registering PMO Portal in a client’s own Microsoft tenant under the Option-B, single-tenant topology.

## What changed

- `docs/runbooks/entra-option-b-setup.md` is the operator-facing ceremony guide for the client tenant administrator and PMO operator. It covers:
  - prerequisites, roles, private handoffs, app name, single-tenant selection, Web callbacks, and the rule to use deployment-specific values privately;
  - the three delegated Microsoft Graph permissions requested by the shipped M365 token-custody flow (`Files.Read`, `Files.Read.All`, and `Sites.Read.All`) with code-derived reasons, plus the distinction between runtime OAuth/OIDC protocol scopes and portal API permissions;
  - confidential-client credential handoff using the approved `scripts/op-get.sh` procedure without publishing identifiers, credentials, storage coordinates, or environment-specific values;
  - organisation-wide admin consent and its visible Integrations success state, explicitly distinguishing approval from a personal connection;
  - the smallest personal-connect proof, an optional conditional SharePoint data check, stop conditions, and private evidence recording;
  - Option-B secret rotation ownership: client IT initiates and tracks expiry, while PMO coordinates receipt and deployment configuration.
- `docs/plans/2026-08-20-entra-option-b-setup-48798f9b.md` records the documentation plan, source evidence, task breakdown, issue-coverage traceability, and safety/verification checks. It confirms this was documentation-only and that no wizard, ADR, code, migration, test, or configuration change was introduced.

## How to use or verify

Run the ceremony from `docs/runbooks/entra-option-b-setup.md`. Supply exact callback and registration values only through the approved private process. The session is complete when organisation approval is visible and a non-administrator client member’s personal Microsoft 365 connection returns to PMO as connected; SharePoint data verification is separately marked passed or blocked by licensing/access.

For document QA, the recorded checks are:

```bash
git diff --check && test -s docs/runbooks/entra-option-b-setup.md
```

The plan also specifies targeted `rg` checks for the permission/protocol scopes and ceremony terms.

# Signed-in self-service password change

> **Status:** Proposed for Director / owner sign-off, 2026-11-13. Spec only; no build authorization.
> **Scope:** A signed-in person changes their own existing PMO password.
> **Related:** [Auth foundation](auth.spec.md), [auth production floor](auth-production-floor.spec.md),
> [ADR-0010](../adr/0010-test-strategy-pyramid.md), [ADR-0008](../adr/0008-client-side-admin-impersonation.md).
> This is a desired future contract. Deployment settings and provider compatibility require separate
> verification; this document does not certify any deployed environment. Current-state assessment is private.

## 1. Job story and boundary

**When** I am signed in and want to replace my password, **I want to** change it from my account
settings after proving I know my current password, **so I can** secure my account and sign in with
the replacement without requesting administrator help.

The entry is **Change password** under `/settings/profile`, opening the distinct protected route
`/settings/security/password`. It is available to every provisioned role for the real signed-in
identity, independent of business write permissions. Recovery and invite acceptance remain distinct
contracts on their existing public routes; navigating to an account page is not proof of password
ownership. No target account selector is accepted.

This is new behavior, not a port or replacement of the recovery flow. Shared form primitives and
validation may be reused; recovery-session detection and its mutation method must not be relabeled
as the signed-in authorization contract.

## 2. Decisions proposed for sign-off

| Decision | Default and reason |
| --- | --- |
| D-1: proof | **Current password on every submission**, including immediately after login. No recent-session exemption, browser timestamp, stored proof flag, or passwordless reauthentication alternative. |
| D-2: authority | An authenticated application service verifies the caller with the provider and proves the supplied current password through the provider password grant, checks that both subjects match, then updates through a user-scoped provider session. The provider's Require current password option is also required. No admin password-update API. |
| D-3: sessions | Successful completion ends **all PMO refreshable sessions, including this one**, and returns to sign-in. Existing bearer access tokens may remain usable until expiry, at most 3,600 seconds after issuance. No claim of instant bearer revocation. |
| D-4: strength | Preserve the auth-floor minimum: 10 characters with lowercase, uppercase and digits; maximum 72 UTF-8 bytes, rejected rather than silently truncated. New must differ from current. No forced periodic rotation. |
| D-5: abuse | Five admitted attempts per account per fixed 900-second window, plus 30 per trusted source IP per fixed 300-second window; shared server counters, fail closed. Provider throttles apply in addition. |
| D-6: account methods | Existing local passwords can be changed regardless of whether this browser signed in with password, magic link or Microsoft. This feature does not create a first local password or change a Microsoft password. |
| D-7: audit | Provider password-mutation audit is canonical; application security events contain only allowlisted identifiers and codes. Retain application security records 90 days, restricted to authorized security operators; no ordinary tenant-wide password activity feed. |

D-3's logout disruption, D-5's shared-office IP tradeoff and D-7's retention/access policy require
Director / owner sign-off. These are concrete proposed choices, not unresolved implementation defaults.
An ADR for the auth-service/session boundary is required from the planner after sign-off; glossary
maintenance belongs to that planning/build change. This spec does not amend the existing auth specs.

## 3. Account and authentication states

The server's live provider identity and account status decide eligibility; a profile, role preview,
email identity listing or browser metadata alone does not establish that a password exists.

| State at entry / submission | Required behavior | Owning AC |
| --- | --- | --- |
| Provisioned active person with local password, password sign-in | Current / new / confirmation form; server proof required even for a newly issued session | AC-PWC-001, AC-PWC-003 |
| Same account signed in with magic link | Same current-password requirement; Forgot password opens the recovery request flow | AC-PWC-003 |
| Microsoft sign-in with an existing linked local password | Can change only the local PMO password using its current password; explanatory copy distinguishes Microsoft | AC-PWC-001, AC-PWC-003 |
| Magic-link-only account without a local password | No first-password creation here; show recovery guidance, and reject a change attempt without a valid password grant | AC-PWC-004 |
| Microsoft-only account without a local password | Explain that Microsoft credentials are managed by Microsoft; no local password creation here | AC-PWC-004 |
| Provider method / local password capability unknown | Loading or retryable unavailable state; never infer password capability from an email address or `email` identity alone | AC-PWC-001 |
| Pending invite / first-password setup | Continue the existing invite acceptance route, not this form | AC-PWC-002, AC-PWC-010 |
| Recovery session | Continue recovery on `/update-password`; a session alone never substitutes for current-password proof in the new service | AC-PWC-004, AC-PWC-010 |
| Unconfirmed, disabled/banned, not provisioned, or profile resolution failed | Respect existing account gates; no password service mutation; confirmation/retry/sign-out guidance as appropriate | AC-PWC-002, AC-PWC-004 |
| Loading, signed out, expired/revoked session | Wait for auth resolution, or return to login without carrying passwords | AC-PWC-002, AC-PWC-008 |
| Admin viewing another role | Exit view-as before enabling the form; identity remains the real Admin, never the displayed role | AC-PWC-002 |
| MFA-enrolled account encountered | Preserve the provider assurance requirement; require completion of supported MFA before mutation, otherwise show unavailable guidance; no downgrade or factor reset | AC-PWC-004 |

A proposed authenticated capability response may expose only the caller's eligibility and supported
methods. Planner must establish its server authority without returning hashes or relying on a
nonexistent SDK `hasPassword` API. The successful password grant remains the mandatory mutation proof,
including when capability information is stale. If capability discovery is unavailable, fail closed
at entry with retry guidance; do not offer an unverified first-password path.

## 4. Functional requirements (EARS)

### Entry, validation and proof

- **FR-PWC-001:** While a provisioned person is signed in, the system shall offer the protected entry
  and state behavior in §3 and shall operate only on that person's real provider subject.
- **FR-PWC-002:** When the person submits a change, the system shall collect current password, new
  password and confirmation, require nonempty matching new fields, apply D-4, and show field errors
  before sending a mutation. Confirmation shall remain browser-local. Passwords shall not be trimmed,
  normalized, copied to URLs, persisted, or repopulated after navigation.
- **FR-PWC-003:** When the service receives a change, it shall verify the incoming bearer with the
  provider, verify the initiating session is still live using its server-side session record, resolve
  the canonical account and active membership server-side, admit the request through
  D-5, and authenticate the current password against the canonical provider email. It shall reject
  target identifiers supplied by the caller. It shall require the password-grant subject to equal the
  incoming subject before any update. Re-authentication shall not auto-create or link an account.
- **FR-PWC-004:** When current-password proof succeeds, the service shall update the password through
  that fresh user-scoped session with `updateUser({ password, current_password })`, with provider
  current-password enforcement enabled. The proof and update shall occur in one request; proof shall
  not be reusable across requests. When the provider rejects stale current-password proof, the service shall stop without replaying
  the mutation or using a cached proof result. No profile edit, client assertion or privileged admin update shall
  replace this check.
- **FR-PWC-005:** When the current password is wrong, a password does not exist, or the provider refuses
  account/assurance eligibility, the service shall perform no password update and return an allowlisted
  failure. The form shall clear current-password fields, explain how to retry or recover,
  and neither sign out an otherwise valid browser session nor claim success.
- **FR-PWC-006:** When a session expires or is revoked before authorization, the service shall reject
  the request without mutation. When the person cancels or leaves before submission, the form shall
  discard sensitive state and perform no password authentication or mutation. Cancellation after
  dispatch shall not be described as undoing a provider write.

### Sessions and outcomes

- **FR-PWC-007:** When the provider accepts the update, the service shall revoke all provider sessions
  using the fresh user-scoped session's global sign-out and shall acknowledge full success only after
  revocation is acknowledged. Temporary verification sessions shall never be returned to the browser
  and shall receive a revocation attempt on every exit path. Before a successful write, cleanup
  shall use local scope on the temporary session only, preserving the initiating session on refusal.
  Cleanup failure shall return unavailable and alert monitoring; it shall never be reported as full
  completion. Full success requires acknowledged global revocation with no remaining proof session.
- **FR-PWC-008:** When full success is received, the browser shall clear its session and all
  identity-scoped query data, clear password fields, replace navigation with `/login`, and announce
  "Password changed. Sign in again." Same-browser tabs shall converge to signed-out state. A password
  change shall not revoke the Microsoft identity provider's sessions or change its password.
- **FR-PWC-009:** When a password write is acknowledged but revocation or response delivery is
  incomplete, the system shall preserve the distinction between changed and failed: return
  `changed_signout_incomplete` when known, clear local sensitive/session state, show "Password changed;
  sign in again. Other sessions could not be confirmed signed out", and offer sign-in, not another
  password submission. The service shall attempt revocation at most three times within this request.
  When no write acknowledgement is available, show an unknown-outcome message advising sign-in with
  the intended new password or recovery; never automatically replay a password mutation.
- **FR-PWC-010:** While any password request is in flight, the form shall announce progress, prevent
  duplicate submissions and remain recoverable on thrown/network/provider errors. Same-user token
  refresh shall not reset typed fields or submit them. Identity change, sign-out, unmount or successful
  completion shall clear them, and an old request's completion shall not affect a newer identity.

### Audit, abuse and compatibility

- **FR-PWC-011:** When the provider commits a password update, it shall produce its durable password
  audit event. The application shall record server-originated attempt outcomes under D-7 with
  allowlisted reason codes and shall never take a browser success event as the mutation audit.
  Partial revocation shall be recorded distinctly and raised to operational monitoring without
  recording the bearer or any password. Audit failure after a committed write shall not cause a
  second password write or a false "unchanged" response.
- **FR-PWC-012:** When a request exceeds either D-5 counter, the service shall reject it before password
  verification with HTTP 429 and `Retry-After` for the remaining fixed window. Windows shall be aligned
  to server epoch time; every admitted attempt, successful or not, consumes one slot and successes
  do not reset counters. Concurrent requests and multiple service instances shall share atomic
  counters, with keyed hashes for IP counter keys rather than raw IP storage. Unavailable counters
  shall return a sanitized 503 without verification or mutation.
- **FR-PWC-013:** While throttled, the UI shall announce when retry becomes possible and enable it after
  the indicated interval; reload, another tab and browser clock changes shall not bypass server
  enforcement. No permanent account lock or administrator unlock shall be introduced. Recovery and
  sign-in remain available under their own independent limits.
- **FR-PWC-014:** When recovery or invite acceptance is used, the system shall preserve their existing
  token handling, URL cleanup, first-password handling and completion navigation contracts. The new
  signed-in service shall neither clear invite state nor treat recovery flags/parameters as password
  proof. Sharing field primitives shall not merge these authorization contracts.

## 5. Non-functional requirements (EARS)

- **NFR-PWC-001:** While processing a change, the system shall transmit credentials only over TLS to
  the authenticated service and auth provider; use no-store responses, bounded bodies and no request
  body logging. Isolated verification clients shall disable persistent session storage and auto-refresh.
  Temporary sessions/tokens shall exist only in request memory and be cleaned up in `finally`.
- **NFR-PWC-002:** While producing application logs, analytics, traces, errors or replay, the system
  shall exclude current/new/confirmation passwords, OTPs, tokens, authorization headers, email,
  names and raw provider error bodies. Application audit fields shall be limited to event ID, UTC
  time, server-resolved actor/subject and org identifiers, outcome/reason code and non-secret request
  correlation ID. Audit identifiers are restricted internal records, never public examples.
  Provider-native audit stays restricted; any exported projection shall use the same allowlist.
- **NFR-PWC-003:** While stored, application security events shall be append-only to callers, readable
  only by authorized security operators, retained for 90 days and then purged; limiter state shall
  expire after its window. No password hash or password history shall be stored by PMO.
- **NFR-PWC-004:** While rendered, all states shall meet WCAG AA: visible labels, keyboard operation,
  first-invalid-field focus, associated errors, status/alert announcements, visible focus, responsive
  layout and password-manager/paste support. Current field uses `current-password`, new/confirmation
  use `new-password`; optional reveal toggles have distinct accessible names. Use DESIGN.md tokens,
  shared form primitives and English/Indonesian feature-namespace messages.
- **NFR-PWC-005:** Before release, the implementation shall prove §6's configuration/capability gates
  on a disposable provider environment and record sanitized read-back evidence for each target
  environment. A dashboard intention or client test shall not count as enforced provider settings.
- **NFR-PWC-006:** When tested, server authorization, subject matching, rate-limit refusal and cleanup
  rules shall be mutation-tested against the shipped handler; the owning proof shall fail when the
  corresponding rule is deliberately removed. No copied test-only handler or validator is acceptable.

## 6. Provider authority and deployment prerequisites

Primary sources checked 2026-11-13; these document capabilities, not the deployed provider version.

1. Supabase documents `current_password` on `updateUser` for supabase-js **2.102.0+** and a separate
   **Require current password** provider setting. The implementation must verify installed SDK types,
   provider support and enabled setting through direct rejection tests. Existing password accounts
   require proof even in fresh sessions. [Password API](https://supabase.com/docs/guides/auth/passwords),
   [password security](https://supabase.com/docs/guides/auth/password-security).
2. Keep the auth-floor **Secure password change** setting enabled. Its documented recent-session
   threshold is **24 hours**; it is not a five-minute reauthentication guarantee. D-1 never uses that
   exemption: this service authenticates the password on every request and uses the fresh session.
   Therefore this feature needs no reauthentication-email/nonce UI. A rejected fresh-session update
   fails closed; it must not silently fall back to a recovery or admin API. Same [password-security
   documentation](https://supabase.com/docs/guides/auth/password-security).
3. Enforce D-4 at provider/service boundary, JWT lifetime **3,600 seconds maximum**, and refresh-token
   rotation. Global sign-out invalidates refreshable sessions; already-issued access JWTs may live to
   expiry. Test current and other sessions, rather than inferring revocation from navigation.
   [Sessions](https://supabase.com/docs/guides/auth/sessions),
   [sign-out scopes](https://supabase.com/docs/reference/javascript/auth-signout).
4. D-5 is an application-service limit, **not a claimed Supabase per-account quota**. Provider limits
   also apply, including direct provider user-update traffic, with its documented baseline of 30
   requests per five minutes per IP and burst capacity 30. This token-bucket behavior is different from
   D-5's fixed windows. Server-mediated traffic may share a provider-observed IP; do not trust a browser
   forwarding header to identify an end user. Verify ingress-supplied trusted IP derivation, shared
   counter enforcement, actual provider quotas and expected office traffic before enabling the feature.
   No claim that the application's account counter governs independent provider APIs.
   [Auth rate limits](https://supabase.com/docs/guides/auth/rate-limits).
5. Enable/verify provider password-change audit and restricted retention/export controls. Provider-native
   password events establish the write result; service failure events and sanitized projections need
   separate implementation and access tests. The provider audit records password-change events; it
   does not promise the application's retention or redaction policy.
   [Auth audit logs](https://supabase.com/docs/guides/auth/audit-logs).
6. Run recovery and invite regression journeys with these exact settings. Provider recovery exceptions
   and first-password rules are distinct from signed-in changes; the server's password grant is still
   mandatory here. Keep invite-only enrollment and existing allowed-origin redirect policy intact.

Planner must verify how canonical method capability, account status, trusted IP and audit access are
obtained at the server boundary. Verifying only JWT signature/expiry or calling `getUser` is not
  proof that a refreshable session still exists: the planner must specify an authorized server-only
  session-registry check keyed to the verified session claim, without exposing that registry to clients.
  Do not invent provider attributes or configuration names. If required
capabilities cannot be proven on the selected provider version, stop release and return to the Director
with an amended design; neither a hidden button nor a browser-only timestamp satisfies this spec.
Leaked-password protection may be enabled where the provider plan supports it; it is not a substitute
for D-4 and no paid-plan purchase is authorized by this spec.

## 7. Acceptance criteria (Given / When / Then)

Each `AC-PWC-###` owns one layer in §8. Parameterized cases remain one canonical owning test.

- **AC-PWC-001 — Entry and eligibility.** Given each eligible role/method combination and each unresolved
  capability state in §3, when account settings opens, then the protected Change password entry and
  local-versus-Microsoft explanation are correct, and unresolved eligibility shows loading/retry without
  a usable mutation form.
- **AC-PWC-002 — Auth and view-as gates.** Given loading, signed-out, unprovisioned, failed profile,
  pending invite or view-as state, when the new route is entered, then §3's gate applies and no change
  is dispatched; exiting view-as enables only the real person's form.
- **AC-PWC-003 — Current-password authority.** Given a real password account signed in by password,
  magic link or linked Microsoft, with both fresh and old initiating sessions, when the service is
  called with missing, wrong, and then correct current password, then only correct proof permits the
  update; old credentials fail subsequent sign-in and new credentials work. Direct provider updates
  omitting/wrongly supplying current password are also refused in a normal non-recovery session;
  direct weak, overlong and same-password updates are rejected at the server/provider boundary.
- **AC-PWC-004 — Subject and method refusal.** Given no bearer, an expired/revoked initiating session, another subject's credentials, caller
  target fields, a passwordless account, recovery session without current proof, disabled/unconfirmed
  account, or insufficient MFA assurance, when the service is called directly, then it rejects without
  password mutation, first-password creation, enrollment, factor reset or another account's update.
- **AC-PWC-005 — Field validation and strength.** Given the form, when passwords mismatch, are empty,
  repeat current, fail D-4 or exceed 72 UTF-8 bytes, then submission shows associated errors without a
  service call; provider/service strength refusal is also safely displayed. Paste and password-manager
  fill work and input is not normalized.
- **AC-PWC-006 — All sessions and fresh sign-in.** Given the initiating session and a second independent
  session, when a valid settings change completes, then the browser and same-browser tabs sign out,
  both old refresh tokens and every temporary proof session fail refresh, old-password login fails,
  new-password login succeeds, and the new login survives a reload under the same identity.
- **AC-PWC-007 — Access-token reality.** Given pre-change bearer tokens and acknowledged refresh
  revocation, when those tokens are used before and after their expiry, then tests allow their bounded
  remaining validity and reject them after expiry, and confirm configured lifetime is at most 3,600
  seconds; the UI makes no instant-access-revocation claim.
- **AC-PWC-008 — Expiry and cancellation.** Given an expired/revoked session or a typed but unsubmitted
  form, when submit authorization fails or the person cancels/leaves, then no password change occurs,
  sensitive fields are discarded and the appropriate login/settings destination appears. A dispatched
  request whose response is lost shows unknown outcome rather than promising cancellation.
- **AC-PWC-009 — In-flight and auth transitions.** Given an in-flight change, when double submit,
  same-user refresh, sign-out, identity replacement or unmount occurs, then only one request is sent,
  refresh does not submit/reset input, sensitive state clears on identity loss and late completion
  cannot clear or navigate a replacement user's session.
- **AC-PWC-010 — Recovery/invite compatibility.** Given the deployment settings in §6, when the existing
  reset and invite acceptance journeys run, then token URLs are cleaned, recovery and first-password
  completion work and invite state clears without a redirect loop; these flows do not invoke the new
  signed-in service or gain its label.
- **AC-PWC-011 — Durable audit and privacy.** Given successful and refused real changes, when audit and
  monitoring records are inspected through privileged test fixtures, then success has the provider's
  durable password event, service outcomes are correctly distinguished, and only allowlisted fields
  appear in application audit/log/analytics/error/replay sinks; audit export and read access comply
  with D-7 and no password, token, email or raw error is emitted by application instrumentation.
- **AC-PWC-012 — Atomic account and IP limits.** Given five admitted account attempts or 30 admitted
  source-IP attempts in their window, when further concurrent requests arrive across instances/tabs,
  then the next is 429 before verification with correct remaining Retry-After; boundary reset permits
  a new window, failure/success do not reset counters, forged forwarding headers do not evade limits,
  and counter outage yields 503 without upstream credential calls.
- **AC-PWC-013 — Partial write and cleanup.** Given provider write success followed by sign-out failure,
  audit projection failure or response loss, when the shipped handler finishes, then it follows
  FR-PWC-009/011, attempts only bounded cleanup, never repeats the password write and never asserts that
  the old password remains valid; verification sessions are revoked on every pre-write failure too.
- **AC-PWC-014 — Accessible error and retry states.** Given initial, loading, validation, wrong-password,
  unavailable, throttled, partial and success states in both supported languages, when operated by
  keyboard and assistive technology, then labels, focus, live announcements, cooldown expiry, reveal
  controls and retry/recovery navigation work without leaking sensitive state.
- **AC-PWC-015 — Storage and audit access.** Given application audit, rate-limit state and their lifecycle
  rules, when ordinary caller roles attempt read/write and expiry is evaluated, then audit is immutable
  and restricted as D-7 specifies, 90-day purge and window expiry apply, and org scope is not taken from
  caller input.

## 8. Traceability and suggested proof files

All paths below are suggestions for the later implementation, not claims that new tests exist.
Provider calls cannot be proven by mocked RTL or pgTAP; those ACs use real Auth in the e2e runner,
using request fixtures when a browser is unnecessary. SQL permissions/retention belong to pgTAP;
handler orchestration belongs to Deno tests importing the shipped handler and mocking `globalThis.fetch`.

| AC | Requirements / decisions | Single owning layer | Exact suggested test file |
| --- | --- | --- | --- |
| AC-PWC-001 | FR-001, D-6 | Unit / RTL | `pmo-portal/pages/ProfileSettings.test.tsx` |
| AC-PWC-002 | FR-001, FR-006 | Unit / router | `pmo-portal/src/auth/ChangePasswordPage.test.tsx` |
| AC-PWC-003 | FR-003..005, NFR-005, D-1/2/4 | E2E / real provider | `pmo-portal/e2e/AC-PWC-003-current-password.spec.ts` |
| AC-PWC-004 | FR-003..006, D-6 | E2E / real service + provider | `pmo-portal/e2e/AC-PWC-004-own-account.spec.ts` |
| AC-PWC-005 | FR-002, FR-005, D-4 | Unit / RTL | `pmo-portal/src/auth/ChangePasswordPage.test.tsx` |
| AC-PWC-006 | FR-007/008, NFR-005, D-3 | E2E / two sessions | `pmo-portal/e2e/AC-PWC-006-session-replacement.spec.ts` |
| AC-PWC-007 | FR-007, NFR-005, D-3 | E2E / real provider requests | `pmo-portal/e2e/AC-PWC-007-token-expiry.spec.ts` |
| AC-PWC-008 | FR-006, FR-009 | Unit / RTL | `pmo-portal/src/auth/ChangePasswordPage.test.tsx` |
| AC-PWC-009 | FR-008/010, NFR-001 | Unit / auth state | `pmo-portal/src/auth/AuthProvider.test.tsx` |
| AC-PWC-010 | FR-014, NFR-005 | E2E / compatibility | `pmo-portal/e2e/serial/AC-PWC-010-recovery-invite-compatibility.spec.ts` |
| AC-PWC-011 | FR-011, NFR-002/005, D-7 | E2E / audit inspection | `pmo-portal/e2e/AC-PWC-011-audit-privacy.spec.ts` |
| AC-PWC-012 | FR-012/013, NFR-006, D-5 | Unit / shipped server handler | `supabase/functions/change-own-password/index.test.ts` |
| AC-PWC-013 | FR-007/009/011, NFR-001/006 | Unit / shipped server handler | `supabase/functions/change-own-password/index.test.ts` |
| AC-PWC-014 | FR-002/005/010/013, NFR-004 | Unit / RTL + axe | `pmo-portal/src/auth/ChangePasswordPage.test.tsx` |
| AC-PWC-015 | FR-011/012, NFR-003, D-5/7 | Integration / pgTAP | `supabase/tests/self_service_password_security.test.sql` |

`FR-###` / `NFR-###` shorthand in this table means the `PWC` namespace above. Server tests also
reference AC-PWC-003/004 as defense in depth, and mutation-check missing proof/subject/eligibility,
limiter fail-closed and session cleanup; provider-owned ACs must not be downgraded to those mocks.
Real atomic counter concurrency is supplementary pgTAP coverage under AC-PWC-012, not a second owner.

Use unique disposable identities and cleanup in `finally`; never rotate a shared seeded password.
Default e2e class is `self-isolated`. The compatibility file uses `serial` only because it exercises
the shared-mailbox contracts; reuse existing AUTHF helpers/journeys rather than weakening their goals.
Token expiry tests use an isolated provider instance with short test TTL, not an hour-long shared
machine wait or a forged token; target-environment lifetime is separately read back before release.

## 9. Source boundaries and explicit exclusions

Read-first surfaces for planning are `pmo-portal/src/auth/{AuthContext.ts,AuthProvider.tsx,
UpdatePasswordPage.tsx,ResetPasswordPage.tsx,LoginPage.tsx,RequireAuth.tsx,RequireInviteAccepted.tsx}`,
`pmo-portal/App.tsx`, `pmo-portal/pages/ProfileSettings.tsx` and their adjacent tests. Existing curated
recovery/invite proofs are `pmo-portal/e2e/serial/AC-AUTHF-005-password-reset.spec.ts` and
`pmo-portal/e2e/serial/AC-AUTHF-020-invite-acceptance.spec.ts`. These are planning references, not a
public current-state security assessment. Read `docs/environments.md` before any configuration action.

Out of scope: administrators changing another person's password; first-password creation from
settings; Microsoft/SSO password changes; identity linking/unlinking; new auth methods; MFA enrollment
or recovery; changing email; bypassing account gates; recovery/invite redesign; personal access-token
or external integration credential rotation; revoking IdP sessions; forced periodic password expiry;
instant revocation of all issued JWTs; implementation, PR, merge, deployment or provider-setting changes
in this spec task. Provider global settings, audit access and account capability choices must receive
planner/security review before build. Owner spec sign-off remains the next milestone.

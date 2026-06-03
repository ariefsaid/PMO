# ADR-0008: Admin "view as role" is client-side, view-only impersonation (MVP)

- **Status:** Accepted
- **Date:** 2026-06-03
- **Relates to:** `docs/specs/auth.spec.md` D-7, FR-AUTH-033..035; `target-architecture.spec.md §7.1` (`[ASSUMPTION]`);
  `baseline.spec.md §10` (Admin role semantics open question); `OBS-AUTH-002/003`.

## Context
The prototype's Header had a role-simulation dropdown (`OBS-AUTH-002/003`) that swapped the entire mock identity.
With real Supabase Auth the identity is a signed-in GoTrue user; we cannot freely swap it. The Director nonetheless
wants to retain a role-switch affordance, re-cast as an **Admin-only** "view as role" control, to let an administrator
preview how the UI gates for each role. The open question (`baseline §10`): is Admin a real role with screens, or an
internal super-user? Either way, true cross-user data preview would require assuming another user's RLS identity —
which is a server-side, audited capability we do not need (or want to build) for MVP.

## Decision
Implement Admin "view as role" as **client-side, view-only impersonation**:
- It changes only the **displayed role** in React state, which drives nav gating and any role-branched UI.
- It does **not** alter the Supabase session, JWT, `auth.uid()`, or RLS evaluation. Any data fetch (now via mockData,
  later via `src/lib/db/*`) still runs under the real Admin identity.
- The control is rendered only when the real `profiles.role` is `Admin`; non-Admins never see it.

## Consequences
- **Positive:** Simple, no backend work, no new attack surface (it grants nothing — it can only *hide* nav the Admin
  already had access to). Lets Admins sanity-check role-gated UX. Cleanly replaces the prototype dropdown.
- **Negative / limitation:** It previews **role-gated UI only**, not another user's row-level data. An Admin "viewing
  as Engineer" still sees Admin-scoped data once real data lands (Issue #4), because RLS is unchanged. This must be
  documented in the UI/spec so it is not mistaken for true impersonation. (`auth.spec.md` FR-AUTH-035.)
- **Future:** If audited, RLS-aware server-side impersonation is ever required, it becomes its own issue (Supabase
  admin API / a dedicated edge function), out of MVP scope.
- **Rejected:** (a) re-authenticating as the target user — unsafe, no shared passwords in prod; (b) server-side
  identity assumption via service-role — never in the browser (ADR-0002); (c) removing the control entirely — Director
  wants the affordance retained for Admins.

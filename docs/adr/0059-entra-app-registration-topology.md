# ADR-0059 — Entra app-registration topology for siloed clients (one-app vs per-client, vendor-tenant vs client-tenant)

- **Status:** Accepted (owner grill 2026-07-14; owner ratified Option C as standing default, escape hatch B)
- **Date:** 2026-07-14
- **Deciders:** Owner, Director
- **Related:** ADR-0058 (M365 integration architecture), ADR-0047 (per-client siloed topology + vault-`AS`
  per-client secrets), ADR-0001 (org_id seam). **Vision:** `docs/microsoft-365-integration.md`.
- **Scope:** how many Microsoft Entra app registrations back "Sign in with Microsoft" (and Graph access)
  across clients, and in whose tenant they live. NOT the integration architecture (ADR-0058).

## Context

PMO deploys **one Supabase project per client** (siloed, ADR-0047). Supabase's `azure` OAuth provider
takes **exactly one** client id + secret **per project** — but because each client has their *own*
project, siloed uniquely allows a *different* Entra app per client (pooled could not — one project, one
slot). Two variables define the option space: **how many apps** (one shared vs one per client) and **in
whose tenant** they are registered (vendor `gordi.id` vs the client's tenant). Publisher verification —
required for smooth cross-tenant consent to a *multi-tenant* app — has weeks of business lead time and has
been an active blocker; a **single-tenant app used inside its home tenant is exempt** from it entirely.

## Options

| | # apps | registered in | secret blast radius | publisher verification | who registers | tenant lock |
|---|---|---|---|---|---|---|
| **A** | 1 | vendor tenant | **shared across all clients** (same secret in every project) | once, required | vendor, once | via per-project Supabase tenant-URL or a `tid` check |
| **C** | one per client | **vendor** tenant | isolated per client | once (business) + trivial per-app MPN stamp | **vendor**, per client | via per-project tenant-URL |
| **B** | one per client | **client's** tenant (single-tenant app) | isolated per client | **none, ever** (home-tenant exemption) | client IT (or vendor w/ delegated access) | automatic (single-tenant) |

Key facts that shaped the ranking:
- Publisher verification is **per-publisher, done once**; the MPN ID is then a trivial per-app field. So
  Option C's N apps ≠ N verifications — it's one business verification + N stamps.
- A single Entra app carries one identity (client id + secret); in Option A that secret is copied into
  every client's Supabase project → one leak authenticates against all clients' logins.
- Per-client secrets already fit the ADR-0047 vault-`AS`-per-client pattern (C and B extend it naturally).

## Decision (proposed)

**Option C is the standing default** (per-client app in the vendor tenant) for siloed rollout from
client #2 onward (owner-ratified 2026-07-14): per-client secret isolation, vendor stays in control (no
dependency on client IT), and verification cost is one-time. **Option B is the sanctioned escape hatch**
when avoiding publisher verification entirely is preferred and the client will register (or delegate
registration of) an app in their own tenant — B also gives automatic tenant lockdown (dissolving the
`tid`-binding gap). **Option A** is retained only for the **current first client / demo** (the existing
multi-tenant app in `gordi.id`, client id `9bdc901a…`, already wired) and is the **forced** choice if PMO
ever goes pooled.

## Consequences

- **Positive:** decouples the M365 auth rollout from publisher-verification lead time (C makes it a
  one-time background task; B removes it). Per-client secret isolation is a clean answer to enterprise
  "is our SSO isolated from other customers?". Reversible: switching a client-facing surface between A/B/C
  is Supabase provider config (client id, secret, tenant URL) + Entra redirect URIs, not a code change —
  and going pooled later (→ A) is likewise a config move the org_id seam already anticipates.
- **Cost / negative:** C and B multiply Entra registrations and secrets to track and rotate (per-client),
  and B adds a per-client app-registration onboarding step. A is operationally simplest but weakest on
  isolation and still needs verification.
- **Provisioning impact:** the per-client "add org" runbook (ADR-0047) gains an Entra step — register (C)
  or obtain (B) the app, add the project callback as a redirect URI, store the secret in vault-`AS`,
  set the Supabase Azure provider tenant URL (`/common` for A; the client's tenant id for B, per-client
  app for C).

## Follow-ups

- ~~Owner ratifies C-vs-B as the standing default.~~ **Done 2026-07-14 — C default, B escape hatch.**
- Sequence publisher verification (needed for C; business task; see session history + `docs/environments.md`).
- Update the ADR-0047 new-client provisioning runbook with the C Entra step (register per-client app in
  `gordi.id`, add project callback as redirect URI, secret → vault-`AS`, set per-client Supabase tenant URL).

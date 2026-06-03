# ADR-0002: Supabase as the backend (over a custom API server) for MVP

- **Status:** Accepted
- **Date:** 2026-06-03
- **Relates to:** `docs/specs/target-architecture.spec.md` §2, §6; baseline `F-2`, `NFR-001/002`.

## Context
The prototype is frontend-only with no persistence, no auth, no authorization (`baseline.spec.md F-2`).
We need durable storage, real authentication, and non-bypassable authorization for a production MVP that
must scale, built by a small team optimizing for speed-to-value (charter: "minimal viable, scalable to
millions"). Options considered: (a) custom API server (Node/Express + Postgres + own auth), (b)
Supabase (managed Postgres + Auth + RLS + Storage + auto REST), (c) Firebase.

## Decision
Use **Supabase** (managed Postgres + GoTrue Auth + PostgREST + Storage). The **Vite + React 19 SPA talks
to Supabase directly** via a typed data-access layer; authorization is enforced by **Postgres RLS**, not
by a hand-written API tier. No separate application server for MVP. The anon key is public by design;
security rests on RLS. A **Supabase Edge Function layer is the documented future seam** for secrets,
webhooks, and multi-step transactions (spec §2.4); for MVP, transitions use Postgres RPC.

## Consequences
- **Positive:** Eliminates building/operating an API server, auth system, and ORM; RLS gives
  defense-in-depth that can't be bypassed from the client; real Postgres means no NoSQL modeling
  compromises and a clean path to advanced SQL (views/RPC for KPIs). Generated TypeScript types keep the
  client honest.
- **Negative / lock-in:** Coupling to Supabase/PostgREST conventions and RLS as the authorization model
  (mitigated: it is standard Postgres underneath, portable to self-hosted Supabase or raw Postgres + an
  API later). Complex server-side logic must wait for Edge Functions/RPC rather than living in a familiar
  app server. Public anon key demands rigorous RLS (security-auditor gate before exposing auth).
- **Rejected:** custom API (more code, slower, more to secure for no MVP benefit); Firebase (NoSQL
  data-model mismatch for relational PMO data + weaker SQL aggregation).

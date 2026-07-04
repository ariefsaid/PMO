# ADR-0047 — GTM production topology: per-client Supabase Cloud Pro projects + Cloudflare Pages

- **Status:** Accepted (owner-directed 2026-07-04)
- **Date:** 2026-07-04
- **Deciders:** Owner, Director
- **Related:** ADR-0042 (versioning/release), `docs/environments.md` (registry + runbooks),
  ADR-0001 (org_id seam — whose multi-org proof this topology defers).
- **Scope:** where paying clients run for the first ~5–10 clients of manual (no-Stripe) GTM.

## Context

The existing Supabase Cloud project (`prwccpsiumjzvnwjlkwq`) was reclassified by the owner
(2026-07-04) as **staging/demo** — no paying client will live on it. Real production needed a
topology decision. The GTM shape (grill session 2026-07-04): "B-shaped start" — **one isolated
environment per client**, where a client = one org = a whole client *group* (subsidiaries are an
Entity dimension inside the org, never separate orgs). 2–5 clients expected in the first 6 months;
Indonesian clients, but **data residency is not a current requirement** (owner). The scarce
resource at this stage is founder/operator time, not hosting dollars.

Alternatives considered:

1. **One shared Supabase project, multiple orgs** — the `org_id` architecture's eventual
   destination. Rejected for now: cross-org isolation is only spot-proven (open MED-1/MED-2 seam
   items); onboarding a second unrelated client onto one DB without a full org-seam audit + pgTAP
   cross-org sweep would be a cross-*customer* tenancy risk.
2. **Self-hosted VPS (Hetzner Singapore), one compose stack per client** — cheaper at ~$50–60/mo
   for 3–4 clients and equally well-isolated, but the operator inherits patching, upgrades,
   uptime, disk, and the entire backup/restore-verification regimen. Untested edge-runtime
   self-hosting wrinkles. Rejected while residency is not demanded and client count is small.

## Decision

- **Backend:** one **Supabase Cloud Pro project per client** (~$25/mo org + ~$10/mo compute per
  project ⇒ ~$75/mo @ 5 clients, ~$125/mo @ 10). Managed daily backups (7-day retention; PITR is
  an add-on if a client contracts a tighter RPO). Per-project isolation gives each client a hard
  boundary — the multi-org RLS seam proof stays deferred until two unrelated clients deliberately
  share a project.
- **Frontend:** stays on **Cloudflare Pages** (free, CDN, already wired) under every scenario;
  one Pages project (or branch/env) per client pointing at that client's Supabase project.
- **VPS is the documented exit path, not a parallel option.** Trigger to revisit: Supabase bill
  sustained past ~$200/mo, or a client contract demanding onshore/self-hosted data. The sized
  VPS playbook (one 8 GB Hetzner-SG box, trimmed compose stack per client, nightly `pg_dump` +
  restic to object storage, 7/4/3 retention, weekly automated restore-verify) is recorded in the
  2026-07-04 grill notes and moves into `docs/environments.md` when triggered.

## Consequences

- The promote runbook becomes a **loop over a client registry** (db-push + `functions deploy` +
  secrets + FE env per client). Fine by hand at 2–3 clients; wants a small iterating deploy
  script before ~5. New-client provisioning (create project, apply migrations, deploy functions,
  set secrets, create org + first Admin user, wire FE env) becomes a runbook/script — this *is*
  the "add org" operation for the Operator persona; no in-app UI needed at this scale.
- `docs/environments.md` env labels: the legacy `prod` label now means the staging/demo cloud
  project (script names kept for continuity); real client environments get their own registry
  rows as they are created.
- Per-client projects multiply secrets (OpenRouter key, service-role, SMTP) — the 1Password
  vault-`AS` pattern extends per client.

# Milestone brief — M365 promote-and-finish

**Status: SIGNED (owner, 2026-08-16).** First brief under the `docs/factory-workflow.md`
model: once signed, the Director chains issues inside each milestone without per-issue pauses;
the owner reviews at milestone boundaries. `main` stays the autonomous ceiling; **nothing in this
brief authorizes any deploy or production action — those remain per-instance owner instructions.**

## Objective

The M365 integration is *finished for its current scope*: the use leg proven against real
Microsoft, SharePoint doc-linking specced+built on the three-step model (#428), the owed e2e paid,
and everything promoted to `main`.

State it builds on (verified 2026-08-16, `docs/backlog.md` "M365 INTEGRATION" + #428): connect leg
proven live (2026-07-24); token custody shipped + 4-round audited; three-step model + operator/
client split ON `main` (#428, `AC-M365SEP-*`, pgTAP `0178`); **`graph_proxy` has never decrypted a
real token** — no Graph data has ever reached PMO.

## Milestones

### M0 — Baseline verify (Director, no code)
Deployed `m365-token-custody` is at/past `#365` (ideally `#428`) via `supabase functions list`;
the four baseline commands green (locked pgTAP chain, both concurrency probes, full verify);
locate the security-pass record for #428's boundary widening — if none exists, run that audit
before M1.
**AC-M0:** a dated note in the backlog M365 section recording all four results + the deploy state.

### M1 — Live use-leg proof (Director drives; owner in the loop by nature)

> **STATUS 2026-08-18 — PARKED ON TENANT LICENSING (owner: "wait until RIS").** The live probes ran
> and proved the custody chain end to end, including the first live auto-refresh; Graph accepts our
> token. The vendor tenant has **no SharePoint Online license**, so a data-200 is impossible there —
> `docs/spikes/2026-08-18-m365-use-leg-live-probe.md` is the record. AC-M1's data-200 closes at the
> first SPO-licensed tenant (RIS). M2 proceeds with flagged assumptions; M3's build waits for the
> live Graph shapes per the original build-follows-proof gate; M4's e2e (connect journey, no SPO
> dependency) can proceed.
1. Scope slice: `M365_PHASE1_SCOPES` gains `Sites.Read.All` + `Files.Read.All` (delegated,
   admin-consent class) — small code change, Director-dispatched with security review (custody
   surface).
2. Owner actions (wizard-guided): **CLIENT-tenant** admin consent, per the two-tenant topology
   (app registered vendor-side per ADR-0064; consent + users live in the customer tenant — the
   owner-confirmed model, 2026-08-16). Vendor-on-vendor runs may be used mid-milestone for
   mechanics but do not satisfy the AC.
3. ONE reconnect as a **non-Operator user in the client tenant** + ONE `graph_proxy` GET against
   that tenant's real SharePoint library + `GET …/versions` on a real item (answers ADR-0071 §9's
   data-model question).
**AC-M1 (amended by owner 2026-08-18 — Gordi-only):** a spike doc records the real, data-only 200s
from the **vendor tenant** (Gordi as both publisher and first tenant) and the versions answer; no
secrets/tenant GUIDs in the doc. The cross-tenant proof (client consent + client user) moves OUT of
this milestone to actual client onboarding — first client tenant will be RIS, gated then, not here.
*The first real Graph response is expected to surprise — that is what this milestone buys before
any doc-linking code exists.*
**Known risk:** cross-tenant consent to a vendor-tenant app requires **publisher verification**
(weeks of lead time historically). If blocked, the ADR-0064 **Option B escape hatch** (app
registered in the client's own tenant, no verification needed) is the sanctioned fallback — an
owner call at that gate, not a Director improvisation.

### M2 — Doc-linking spec revision (owner-heavy front)
Revise `docs/specs/m365-onedrive-doc-linking.spec.md` to SharePoint-primary: site/library browse,
ADR-0071 drift model, version pinning, project↔library binding (client PM binds,
`can('edit','project')`, no approval step). Grounded in M1's real responses.
**AC-M2:** revised spec in EARS + `AC-###`, owner sign-off recorded in the spec header.

### M3 — Doc-linking build (factory-heavy)
Decompose the signed spec via `/to-tickets` into GitHub issues (public-repo hygiene on every
title/label). Routing per `docs/factory-workflow.md`: FE slices → ADW FE roster
(`--builder fe_builder --reviewer fe_reviewer`); ordinary schema/read-model slices → ADW (pgTAP
gate fires on `supabase/` diffs); anything touching `graph_proxy`, custody, or the gate chain →
Director-dispatched with the full review battery.
**AC-M3:** every spec `AC-###` green at its owning layer (ADR-0010); rendered Discover pass clean;
battery records on custody-adjacent slices.

### M4 — Coverage debt + promote
The owed M365 e2e (entitle → client-admin approve → connect journey, post-#428 actors) — ADW
candidate; migration-number dupe check before merge; promote `dev`→`main` via the worktree's
`scripts/verify-main-pr.sh`, `--merge` not `--squash`.
**AC-M4:** M365 e2e exists and is green in the integration lane; `main` carries all of the above;
`production` untouched.

## Scope fences (do-NOT list)

- **No deploy, no prod, no Entra config changes** beyond M1's explicitly-listed owner actions.
- **Write-guard / cascade / lock order:** any touch requires BOTH probes re-run — pgTAP cannot
  express two-session races.
- Later vision items (Teams, Outlook/Calendar, in-app preview, Entra-group provisioning) are OUT.
- ADRs cited by filename (0058/0059 numbering is ambiguous); `AC-M365SEP-*` supersedes
  `AC-M365-131`-era assertions.
- Public repo: issues/PRs carry neutral wording; live-run details go in the spike doc only after
  scrubbing identifiers.

## Evals

No LLM surface in scope — ADR-0052 evals n/a. (If any slice touches the assistant surface, it
exits this brief and takes the agent-surface rules.)

## Checkpoints

Owner: sign this brief → review at each milestone boundary (M1 additionally needs your consent
actions and per-test tenant calls — flagged when reached) → M4 promote review. Director:
everything else, at `main` ceiling.

**Owner signature:** signed — owner, 2026-08-16 (in-session reply "signed").

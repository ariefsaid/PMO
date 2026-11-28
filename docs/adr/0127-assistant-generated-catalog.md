# ADR-0127 — The assistant's record types and actions come from one catalog generated at build time

- **Status:** Proposed (Design+Plan for #3084, 2026-11-28)
- **Deciders:** Director, under the owner's rulings on #3084 (2026-11-28)
- **Related:** DD-API-1/2/3 (`docs/decisions.md`), ADR-0016 (RLS is the authority), ADR-0019 (server-enforced SoD), ADR-0036 (deputy), ADR-0050 (layered prompt), ADR-0051 (approval materiality), ADR-0052 (eval harness). **Spec:** [`docs/specs/assistant-catalog.spec.md`](../specs/assistant-catalog.spec.md). **Plan:** [`docs/plans/2026-11-28-assistant-catalog.md`](../plans/2026-11-28-assistant-catalog.md).

## Context

The assistant reads 27 record types through hand-written tool definitions, a hand-curated column list per type
(`readEntities.ts`), a hand-kept map from type to plan switch (`featureSwitches.ts`), hand-written prompt map lines
and 6,000 characters of hand-written help text. The app has since grown to about 242 tables read by its data layer
and 614 RPCs. Each new feature would need an assistant change in four places, and the fixed context sent every
round (9,707 characters of tool definitions plus 27,419 of prompt, ≈ 9,300 tokens) grows with every addition.

The owner decided on three model tools, `find`, `read` and `act`, over a catalog generated from the DD-API-1
allow-list so that a new feature appears without assistant work. This ADR records how the catalog is produced,
because the choice fixes where security rules live and how a feature joins.

## Decision

1. **The catalog is generated at build time and committed.** A script (`scripts/gen-assistant-catalog.mjs`)
   writes `supabase/functions/agent-chat/catalog/catalog.generated.ts` (a plain TypeScript module, like
   `helpCorpus.ts` was: no JSON import, no runtime file read, no network) from two inputs:
   - **database facts** read from the local database after reset: tables, views, columns and types, primary keys,
     the columns the signed-in role may SELECT, `COMMENT ON` text, function argument names and types;
   - **curated fragments** in `supabase/functions/agent-chat/catalog.d/*.json` (one file per area, the shape
     already used by `scripts/isolation-probe-denominator.d/`): description in English and Indonesian, search
     aliases, plan-switch key, preflight roles, hidden columns, and for actions the target, argument schema, fixed
     arguments and the confirm-card template.
     The database facts are committed as `catalog/db-facts.generated.json`, so the everyday check (`check:guards`)
     needs no database; a database-backed check (`--check-db`, run where migrations are tested) regenerates the
     facts and fails if they differ from the committed file.
2. **Reads are default-deny and the gate makes the decision unavoidable.** A table the DAL reads and the
   signed-in role may SELECT must be classified in a fragment (`entity`, `recipe-source` or `skip` with a reason);
   CI (`check:guards`) fails on an unclassified one. This is the DD-API-1 allow-list as a check: a new feature
   cannot reach the data layer without a decision about the assistant, and the common decision is a five-line
   fragment, not code.
3. **Actions are explicit opt-in.** An RPC or insert is an action only when a fragment names it; the generator
   checks the function exists with the same argument names and is executable by the signed-in role, refuses closed
   targets (approvals, money, deletes, closed transitions, settings), and pins fixed arguments (for example
   `p_to = Submitted`) that the model cannot override. Nothing is inferred from a name.
4. **Columns come from the database's own grant, narrowed, never widened.** An entity's columns are the columns
   the signed-in role may SELECT minus global deny patterns and the fragment's hidden list; an entity names the
   table or masked **view** the app reads, so price hiding stays in the database. The 27 current entities are held
   to a committed golden snapshot of today's curated lists, roles and money rules (the parity test) until a change
   is made deliberately.
5. **The catalog carries hints, not authority.** Preflight roles and plan keys decide what `find` offers and give
   early, typed refusals; RLS, column grants, masked views and the RPCs' own checks decide what actually runs, under
   the caller's session (ADR-0016). A wrong hint can degrade an answer; it cannot widen access.
6. **Search is in-process lexical search** over entries and guide chunks in the user's language (English
   fallback). No embeddings and no new infrastructure: the catalog is a few hundred entries and the guide a few
   hundred chunks, in memory.
7. **The user guide is indexed the same way:** `docs/user-guide` is the source of truth; a generated module holds
   its chunks; CI fails when it drifts.
8. **No migration.** Descriptions come from fragments (a database `COMMENT ON` text may stand in for English only);
   the feature does not touch the schema.

## Consequences

**Good.** Fixed context stops growing with the app (target ≤ 12,000 characters against 37,126). A new feature
joins with one fragment and is hidden by its plan switch automatically. Every column rule is a reviewable file
plus a parity test, not prose in a prompt. The same catalog and runners back an MCP server without change (they
are transport-free modules). Changes are deterministic and diffable.

**Costs and risks accepted.**
- The generator needs the local database, so catalog regeneration is a developer and CI step, not a deploy step;
  CI checks the committed output is current.
- About 215 tables need a one-time classification (`skip` reasons); a script drafts the file from grants and
  naming, a worker confirms it.
- One more search round for record types not named in the prompt's short key list (find, then read); mitigated by
  that list and by `read` returning suggestions for an unknown key. The eval gate (spec RG-1/RG-2) decides whether
  the deployed model copes.
- Fragment descriptions in two languages are curated by hand; a missing one fails the build rather than shipping
  English-only.

## Alternatives considered

- **Runtime introspection from the function** (read `information_schema` per request or at cold start). Rejected:
  a column added by any migration would become readable by the model without review; the function's session
  cannot read the catalog views it would need without extra grants; startup and per-turn cost; non-deterministic
  and untestable offline; no place for descriptions, roles or fixed arguments.
- **Generate only from `COMMENT ON`.** Rejected: only a minority of tables carry comments (59 table comments and
  149 function comments across 1,133 migrations), and a comment cannot hold a Bahasa description, a role hint, a
  plan key or an argument schema. Comments remain a fallback and can be added in later migrations without a
  catalog change.
- **Auto-include every table and RPC the DAL touches.** Rejected: 614 RPCs include approvals, payments, posting and
  settings; default-allow on writes is the wrong default, and for reads it would put audit and PII columns in front
  of a small model. Reads are default-deny with a forced decision; writes are explicit opt-in.
- **A hand-maintained registry (status quo, widened).** Rejected: it is the cost this feature removes; every
  feature would again touch the prompt, the schema and the switch map.
- **Cloudflare-style code execution.** Rejected by the owner: the deployed model is small, and `read` already
  filters, groups and sums.
- **Embedding search.** Rejected for 15 Dec: new infrastructure and a cold-start cost for a corpus that fits in
  memory; revisit if recall on the eval cases is poor.

## Reversibility

The three-way switch (`legacy`, `both`, `new`) in the spec (FR-ACG-080) restores the old tool set without a
release until the old code is deleted after the gate; after deletion, reverting the cutover commit restores it.
The generated files are removable; no data or schema is affected.

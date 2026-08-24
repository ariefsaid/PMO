# Issue tracker: GitHub

Issues for this repo live as GitHub issues in `ariefsaid/PMO`, driven by the `gh` CLI.

> **⚠️ The repo — and therefore every issue, label, and comment — is PUBLIC.** The CLAUDE.md banner
> binds here with full force: no unpatched-weakness detail, no PII, no secret coordinates. An open
> weakness gets a **neutral stub** issue at most; detail goes to a private security advisory
> (`Security → Advisories`) or the Director's private memory until the fix ships. The sibling repo
> learned this the hard way — filing titled, labelled, searchable issues makes content far more
> discoverable than it was in a docs file.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."` (heredoc for multi-line bodies).
- **Read an issue**: `gh issue view <number> --comments`.
- **List issues**: `gh issue list --state open --json number,title,body,labels --jq ...` with `--label` / `--state` filters.
- **Comment / label / close**: `gh issue comment` · `gh issue edit --add-label`/`--remove-label` · `gh issue close --comment`.

Infer the repo from `git remote -v` — `gh` does this automatically inside a clone.

## Wayfinding operations

- **The map** = a GitHub issue labelled `wayfinder:map`; its **decision tickets** = issues carrying a
  **resolver** label (`wayfinder:owner` / `:director` / `:factory`), the `wayfinder:ticket` label, a
  body whose first line names the map (`Map: #<n>`), and the native sub-issue link to it. Blocking
  edges are stated in the ticket body (`Blocked-by: #<a> #<b>`).
- **Frontier query** (tickets ready to work): **key on the RESOLVER label**, and keep those whose
  `Blocked-by` ids are all closed.

  ⚑ **This used to say "open `wayfinder:ticket` issues", and that is the 2026-08-21 bug at its source.**
  Everything downstream inherited it — the SessionStart hook and the wayfinder skill both ANDed
  `wayfinder:ticket` with the resolver label — so when #527, #523 and #518 were parked with the resolver
  label alone they vanished from the frontier, were counted as ordinary *build* issues, and the hook
  announced "wayfinder frontier drained" for a whole day while four owner questions waited. A session
  then spent ~150K tokens on director work without asking one.

  The resolver is what a session actually branches on. Requiring a second label to agree adds a way to
  be silently wrong and buys nothing — and an empty frontier is indistinguishable from a correct one,
  which is what makes this class expensive. **A ticket still wants all four fields above** (the hook
  warns when `wayfinder:ticket` is missing); the query just must not depend on them to find it.
- Refer to maps and tickets **by title, never by bare number** — the number rides inside the
  markdown link.

## Relationship to `docs/backlog.md`

`docs/backlog.md` stays the **live status doc** (what is shipped, what is in flight, owner
decisions). GitHub issues are the **work-item tracker** (wayfinder maps/tickets, triaged inbound
work, decomposed tickets from `/to-tickets`). A backlog entry may link an issue; an issue never
replaces the backlog's status role.

## Pull requests as a triage surface

**PRs as a request surface: no.** External PRs are not treated as feature requests. (`/triage`
reads this flag; flip to `yes` only by owner decision.)

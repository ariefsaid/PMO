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

- **The map** = a GitHub issue labelled `wayfinder:map`; its **decision tickets** = issues labelled
  `wayfinder:ticket` whose body's first line names the map issue (`Map: #<n>`). Blocking edges are
  stated in the ticket body (`Blocked-by: #<a> #<b>`).
- **Frontier query** (tickets ready to work): open `wayfinder:ticket` issues whose `Blocked-by`
  issues are all closed — list open tickets, resolve their `Blocked-by` refs with
  `gh issue view <n> --json state`, keep those with none open.
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

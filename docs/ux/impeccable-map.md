# Impeccable and taste: which command at which step (#806 lane)

Detector (59 rules, `.claude/skills/impeccable/scripts/impeccable detect`) runs at every step: static on touched source dirs, and on rendered routes at 390×844 and 1440×900 through `scripts/ux-proof.sh`. Advisory findings are listed, not blocking. `ui-ux-pro-max` `scripts/search.py` runs for every pattern touched. Taste v1 lenses (hierarchy, repetition, truncated identity, anti-slop) apply at spec and review.

| Step | Impeccable commands (in order) | Why |
|---|---|---|
| Area spec (Sol) | `/shape` (one discovery round from PRODUCT + routes), `/critique`, `/layout`, `/distill`, `/onboard` for empty/first-run states | decide composition from the job before code |
| Build (Luna) | `/harden` (overflow, i18n, error states), `/adapt` (390/1440), `/clarify` (labels, actions), `/polish` last | production-ready recomposition, not a restyle |
| Rendered review (Sol first, Argon fallback, GLM backup) | detector both viewports, `/audit` (a11y, theming, overflow), `/critique` on the shots, `/distill` check (each fact once), taste lenses | the unknown-unknown net on pixels; **one pass, exhaustive**: every route, state, width, theme; numbered findings with counts, never a top-N (impeccable's prioritise-the-few guidance is overridden) |
| Any step, when the task warrants | `/polish` after every fix round, `/harden`, `/clarify`, `/adapt`, `/optimize` (slow route), `/animate` only for state feedback, `/quieter` when a screen shouts | the step column is the minimum, not the ceiling; name the command used in the PR or review |
| Never in this lane | `/colorize`, `/bolder`, `/typeset`, `/overdrive`, `/delight`, `/document` | ADR-0068 look is fixed; OD-REDESIGN-SCOPE |

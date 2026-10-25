# Impeccable and taste: which command at which step (#806 lane)

Detector (59 rules, `.claude/skills/impeccable/scripts/impeccable detect`) runs at every step: static on touched source dirs, and on rendered routes at 390×844 and 1440×900 through `scripts/ux-proof.sh`. Advisory findings are listed, not blocking. `ui-ux-pro-max` `scripts/search.py` runs for every pattern touched. Taste v1 lenses (hierarchy, repetition, truncated identity, anti-slop) apply at spec and review.

| Step | Impeccable commands (in order) | Why |
|---|---|---|
| Area spec (Sol) | `/shape` (one discovery round from PRODUCT + routes), `/critique`, `/layout`, `/distill`, `/onboard` for empty/first-run states | decide composition from the job before code |
| Build (Luna) | `/harden` (overflow, i18n, error states), `/adapt` (390/1440), `/clarify` (labels, actions), `/polish` last | production-ready recomposition, not a restyle |
| Rendered review (Argon / Sol / GLM) | detector both viewports, `/audit` (a11y, theming, overflow), `/critique` on the shots, `/distill` check (each fact once), taste lenses | the unknown-unknown net on pixels |
| Never in this lane | `/colorize`, `/bolder`, `/typeset`, `/overdrive`, `/delight`, `/document` | ADR-0068 look is fixed; OD-REDESIGN-SCOPE |

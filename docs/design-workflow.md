# UI/UX workflow

For screen composition and rendered judgement, read and follow [restructure](../.claude/skill-overrides/restructure/SKILL.md); it is the single screen-design method for the Director and workers.

## Foundation

- `DESIGN.md` owns shared tokens; `design-architect` maintains them against shipped primitives, and the owner approves identity changes.
- `docs/ux/screen-rules.md` governs screens; external design skills supply craft inside that identity.
- `docs/orca-dispatch.md` owns executor routing; role names describe worker contracts rather than authorization to build in the main session.

## Engineering and acceptance

- Keep the signed business spec, repository/permission patterns and code-side gates in `CLAUDE.md`; visual acceptance does not replace them.
- `docs/qa-portfolio.md` owns the review-mode switch; its `4-lens`/`3-lens` fallback remains runnable in [the archived lens battery](archive/design-workflow-lens-battery.md) §1a/§2.3.
- `docs/qa-portfolio.md` owns the QA portfolio and deterministic correctness layers; retain behaviour, money, dates, permissions and a11y proofs through a recompose.
- Tests encode the user's natural journey and goal at the lowest sufficient layer. For an approved UX change, update the steps while preserving the goal oracle.
- Remove obsolete look-pinning assertions when recomposing; distinguish them from assertions that protect an action, a figure or retained work.
- CI and release ceilings remain in `CLAUDE.md`; the owner judges composition on rendered artifacts.

## Shared components

When the component-library extraction reaches its planned phase, add Storybook stories covering each component's loading, empty, error, edge and variant states plus a11y. Until then, use the existing rendered component and route proofs.

## Tool caveats

- Impeccable's update phone-home remains disabled by vendoring.
- The generative sub-skills excluded by `scripts/vendor-skills.sh` remain excluded.
- Generated third-party skills are edited only through tracked overrides; upstream examples and their assets remain untracked.

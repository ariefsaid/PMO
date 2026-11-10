# Assistant panel rebuild plan

## Goal

Recompose the existing assistant panel around source-inspected BeautifulUI interaction patterns and render model answers through a local OpenUI Lang component library. Keep the current panel host, runtime, scoped tool reads, approval handshake, keyboard/focus behavior, responsive presentation, and accessibility contracts. Use only `DESIGN.md` tokens for product styling. OpenUI components receive static values from the assistant's existing turn output; they do not query, mutate, or call a remote renderer.

## Compatibility decisions

The compatibility audit is in `/Users/ariefsaid/Coding/PMO/docs/private/reviews/q12/2047-compat.md`. BeautifulUI's examples are source patterns to adapt, not a drop-in package: demo timers, fake data, external media, and sample actions must not enter the product. OpenUI Lang 1.1.0 supports the installed React 19 and Zod 4 types; keep its parser and renderer local. The server prompt must describe the same constrained component language because `agent-chat` is the only model path and cannot import a React renderer.

## Exact file scope

- `docs/plans/2026-11-10-assistant-panel-rebuild.md` — this plan.
- `pmo-portal/src/components/panel/AssistantPanel.tsx` — preserve host semantics; apply BeautifulUI-derived structure and tokens.
- `pmo-portal/src/components/panel/Composer.tsx` — adapt Prompt Bar composition while preserving real attachment, submit, stop, approval, and keyboard behavior.
- `pmo-portal/src/components/panel/Transcript.tsx`, `TranscriptItem.tsx`, `ChatBubble.tsx`, `ThinkingBubble.tsx`, `ActivityTrail.tsx`, `ToolCallCard.tsx`, `ApprovalChip.tsx`, `ArtifactSlot.tsx`, `Markdown.tsx`, `EmptyState.tsx`, `QuestionChips.tsx`, `StuckRunBanner.tsx`, `FeedbackControl.tsx`, `ThreadList.tsx` — recompose around the inspected Chat, Streaming Text, Thinking, Tool Chips, Approval Card, Context Cards, and Loading State patterns; keep product-owned data and actions.
- `pmo-portal/src/components/panel/widgets/WidgetSlot.tsx`, `registry.tsx`, `DataTableWidget.tsx` — expose current table/chart/insight data through the OpenUI rendering path and preserve existing safe widget renderers.
- `pmo-portal/src/components/panel/openui/assistantLibrary.tsx` — register `KPITile`, `StatTiles`, Recharts chart components, `DataTable`, record links, and a text-only answer component; define strict Zod schemas and local renderers.
- `pmo-portal/src/components/panel/openui/OpenUIAnswer.tsx` — parse/stream/render OpenUI output, reject unknown or malformed programs, and fall back to safe Markdown text on every failure.
- `pmo-portal/src/components/panel/openui/OpenUIAnswer.test.tsx` and `assistantLibrary.test.tsx` — cover valid rendering, streaming, malformed/unknown component fallback, static-only props, and component registration.
- `pmo-portal/src/components/panel/Composer.behavior.test.tsx`, `AssistantPanel.behavior.test.tsx`, `Transcript.openui.test.tsx` — add behavior assertions and retain all existing behavior, role, and accessibility tests; remove only assertions that pin replaced visual details.
- `supabase/functions/agent-chat/prompt.ts` — add the constrained OpenUI answer contract and grounding rules to the existing system prompt.
- `pmo-portal/src/lib/agent/agentPrompt.openui.test.ts` — prove the prompt documents the registered names, data-only rule, and prose response format.
- `pmo-portal/evals/cases/openui-render.eval.ts` — add render cases for a KPI/stat answer, a chart answer, and a requested table answer, scoring `query_entity` tool use plus the expected OpenUI component marker.
- `/Users/ariefsaid/Coding/PMO/docs/private/reviews/q12/2047-compat.md` — Step 0 compatibility result (private local-only review).
- `/Users/ariefsaid/Coding/PMO/docs/private/reviews/q12/finish-2047.md` — final changes, gates, eval status/scores, screenshot paths, and remaining work (private local-only review).

## Slices (test first)

1. **OpenUI language and fallback (2–5 minutes).** Add failing library and answer-renderer tests. Define strict, display-only component schemas and renderers; no `toolProvider`, query function, mutation, action, URL loader, or cloud client is registered. Render prose through `Text`/Markdown, and fall back to the original answer if parsing or rendering fails. Verify the test files and typecheck.
2. **Grounded answer generation (2–5 minutes).** Add a failing system-prompt test, then describe the exact library names, argument shapes, and OpenUI syntax in the existing `agent-chat` system prompt. Require every numeric or record value to come from this turn's RLS-scoped tool results; do not use generated views for write approvals or invent a second data path. Run the prompt and agent handler tests.
3. **Panel visual composition (2–5 minutes).** Add user-action tests for prompt submit/stop/attachments, focus and keyboard handling, mobile dismissal, desktop positioning/docking/resize, and transcript streaming. Adapt the audited BeautifulUI structures using existing tokens; retain the shell and runtime as the behavior authority. Replace existing assistant answer Markdown only when the OpenUI parser recognizes a valid program; otherwise display the existing safe Markdown output.
4. **Interaction states (2–5 minutes).** Add/adjust tests for actual reasoning/step lifecycle, tool state and result summaries, approval confirmation, loading, empty, error, question, feedback, and history states. Keep the existing confirm-before-write control and server decision request intact; change only card appearance. Use only turn events/results for context cards and tool chips.
5. **Eval and rendered proof (2–5 minutes).** Add three eval cases: “show my active project count” → KPI/stat component; “show active projects by status” → chart component; “show my companies in a table” → `DataTable`. Run only through an explicitly free route named by ADR-0052/harness documentation; if no such route is available, do not invoke the harness and record the eval step as BLOCKED. Capture `scripts/ux-proof.sh` output for the AppShell routes that host the global panel.

## Tests and gates

- Focused Vitest: `npx vitest run src/components/panel/openui/OpenUIAnswer.test.tsx src/components/panel/openui/assistantLibrary.test.tsx src/components/panel/Composer.behavior.test.tsx src/components/panel/AssistantPanel.behavior.test.tsx src/components/panel/Transcript.openui.test.tsx src/lib/agent/agentPrompt.openui.test.ts` (only files that exist after their slice is implemented).
- Prompt/agent regressions: the focused OpenUI prompt test plus existing `supabase/functions/agent-chat` prompt/handler tests that cover touched behavior.
- Required gates: `npm run check:guards`, `npm run typecheck`, `npx eslint --max-warnings=0 <each touched TS/TSX file>`, touched tests, `node scripts/affected-e2e.mjs` and run at most three listed journeys one at a time with `scripts/e2e-local.sh`, and `scripts/ux-proof.sh` on the routes it identifies for the global assistant panel.
- Eval: run `scripts/agent-eval-local.sh` only when a confirmed no-cost provider route is provisioned and the test fixture prerequisites are met. Existing OpenRouter credit is never used for evaluation.

## Boundaries

- Do not replace `AgentRuntime`, its SSE/auth path, server-side approval/decision handling, RLS-scoped tools, or `AssistantPanelSlot` host behavior.
- No `@openuidev` cloud/gateway SDK, Thesys endpoint, third-party model request, OpenUI query/mutation function, or new database/browser read.
- No hand-authored production content that duplicates data; OpenUI props must come from the answer generated after existing tool reads. Malformed OpenUI always displays the original safe text.
- Keep motion restrained and honor reduced-motion. Keep all existing focus, dialog, mobile trap, Escape, and screen-reader labels.
- Push only `ui/2047-assistant`; the Director owns the merge to `ui/1108`.

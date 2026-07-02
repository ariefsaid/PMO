# Program Plan — Agent-native Whole-UI Adoption Epic

**Date:** 2026-07-01  
**Decision of record:** `docs/adr/0040-in-app-agent-panel-pmo-native-vs-sidecar.md` (`## Decision (2026-07-01)`)  
**Inputs closed by this plan:** `docs/spikes/2026-07-01-agent-native-sidecar-findings.md`, `docs/spikes/2026-07-01-agent-native-sidecar.md`, `docs/plans/2026-07-01-agent-native-sidecar-pilot.md`, ADR-0036, ADR-0039, ADR-0041, `/Users/ariefsaid/Coding/PMO/.claude/worktrees/mockups/docs/adr/0037-monochrome-calm-design-language.md`, `/Users/ariefsaid/Coding/PMO/.claude/worktrees/reskin-port/DESIGN.md`.

**Program decision:** PMO adopts Builder.io **`agent-native` whole — engine + UI** at `pmo/agent-native/`, embedded with **`<AgentNativeEmbedded>`** and themed through agent-native’s token seam. Option A’s shipped edge-function assistant stays live only as the **staged fallback** until Option B reaches parity.

**This is the program-level epic plan, not the per-issue build plan.** Each issue below still requires its own detailed implementation plan before code starts. The tasks here are deliberately exact and no-placeholder so the Director can cut issue briefs without inventing scope.

## Program constraints

- **Parallel with the monochrome-calm reskin.** Both fronts must target the shared token contract in `/Users/ariefsaid/Coding/PMO/.claude/worktrees/reskin-port/DESIGN.md`.
- **G1 — Theming fidelity.** Token-themed `<AgentNativeEmbedded>` must meet the monochrome-calm bar; owner standard is brand-aligned-via-tokens, not bespoke pixel parity.
- **G2 — Security substrate ports forward.** Re-establish the deputy pattern and ADR-0039’s untrusted-output validator on the new surface.
- **G3 — Conscious churn coupling.** Pin exact versions, own an upgrade cadence, and expand the deputy-invariant canary to MCP/A2A + `defineClientAction`.
- **Staged retirement only.** Do not remove `supabase/functions/agent-chat/*`, `pmo-portal/src/components/panel/*`, or `pmo-portal/src/lib/agent/runtime/*` until E8.
- **`compose_view` stays undecided until E7.** It is a parity-check, not a pre-decided removal.
- **ADR collision hazard.** `dev` already has `docs/adr/0037-view-composition-compiler-dsl.md`; the reskin branch also uses `0037-monochrome-calm-design-language`. Renumber before merge is mandatory in E8.

## Program architecture summary

- **Host UI:** `pmo-portal/`
- **New sidecar:** `pmo/agent-native/`
- **Deploy shape:** Nitro Node server on VPS + Cloudflare Pages Function same-origin proxy `/agent/*`
- **Identity:** bearer token handoff via `ensureEmbedAuthFetchInterceptor`; server-side verification in agent-native `auth()`
- **Business data path:** PMO Supabase through caller-JWT deputy client; RLS remains the ceiling
- **Framework data path:** agent-native managed tables in dedicated schema via DB role `search_path`
- **Shared UI contract:** monochrome-calm tokens only; no agent-native source fork for branding

---

# E1 — Foundation

**Job story:** When PMO begins the whole-UI migration, the platform team wants a colocated, pinned, isolated agent-native runtime with a deputy canary in CI so they can build on a safe substrate instead of a spike branch.

**Gate mapping:** G2, G3

## Scope

Colocate `pmo/agent-native/` from the pilot reference, pin exact `@agent-native/core`, stand up the Nitro middleware + AsyncLocalStorage deputy seam, isolate framework tables through a dedicated DB role `search_path`, and convert the pilot deputy-invariant test into a repo-owned CI canary.

## Requirements

- **FR-401** When PMO installs agent-native, the system shall host it at `pmo/agent-native/` as a sibling project to `pmo-portal/` with exact-pinned framework versions.
- **FR-402** When the Nitro server verifies a caller bearer token, the system shall store the raw JWT in a host-owned request context so downstream actions can create caller-scoped Supabase clients.
- **FR-403** Where agent-native manages its own tables, the system shall isolate them in a dedicated schema selected by DB-role `search_path`, not by URL `?schema=`.
- **NFR-401** While business actions run, the system shall use `service_role` only for identity verification (`auth.getUser`) and never for business reads or writes.
- **NFR-402** While dependency churn remains pre-1.0, the system shall pin exact versions and run a deputy-invariant canary in CI on every PR touching `pmo/agent-native/`.

## Acceptance criteria

- **AC-401** Given a fresh checkout, When the developer installs `pmo/agent-native/`, Then the package lock pins exact framework versions and the app boots from that colocated path.
- **AC-402** Given a valid PMO JWT, When an agent-native action resolves the deputy context, Then the raw caller JWT is available through the host request context and a caller-scoped Supabase client can be created without reading browser storage directly.
- **AC-403** Given the local database reset and the deputy canary, When CI runs the foundation gate, Then agent-native tables land only in the dedicated schema and the deputy-invariant test passes 5/5.

## Traceability table

| AC | Owning layer | Planned proof |
|---|---|---|
| AC-401 | Unit | `pmo/agent-native/test/install-contract.test.ts` |
| AC-402 | Unit | `pmo/agent-native/test/deputy-context.test.ts` |
| AC-403 | Unit | `pmo/agent-native/test/deputy-invariant.gate.test.ts` + CI job |

## Tasks

1. **Write the failing pin/install test for AC-401.** Add `pmo/agent-native/test/install-contract.test.ts` asserting `package.json` uses exact `@agent-native/core` and Node engine `>=22.22.0`.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/install-contract.test.ts`
2. **Create the colocated app skeleton from the pilot reference.** Copy the reference structure into `pmo/agent-native/` (`package.json`, `nitro.config.ts`, `tsconfig.json`, `vitest.config.ts`, `server/`, `test/`) and replace all caret ranges with exact pins.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npm install && npx vitest run test/install-contract.test.ts`
3. **Write the failing deputy-context test for AC-402.** Add `pmo/agent-native/test/deputy-context.test.ts` asserting `server/middleware/deputy.ts` populates request-scoped caller JWT and `server/lib/deputy-store.ts` returns it inside an action.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/deputy-context.test.ts`
4. **Implement the deputy seam.** Create `server/middleware/deputy.ts`, `server/lib/deputy-store.ts`, and `server/lib/supabase.ts` with `verifyJwt`, `getCallerJwt`, `createVerifierClient`, and `createCallerClient`.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/deputy-context.test.ts`
5. **Write the failing schema-isolation/deputy canary for AC-403.** Port the pilot gate into `pmo/agent-native/test/deputy-invariant.gate.test.ts` and add the schema-placement assertion.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/deputy-invariant.gate.test.ts`
6. **Implement dedicated-schema boot and CI canary wiring.** Add `scripts/create-agent-native-role.sql`, wire `DATABASE_URL`/role setup into `pmo/agent-native/README.md`, and add a CI workflow step in `.github/workflows/ci.yml` to run `npx vitest run test/deputy-invariant.gate.test.ts` when `pmo/agent-native/**` changes.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/deputy-invariant.gate.test.ts`

---

# E2 — Domain bridge

**Job story:** When the embedded agent starts reading and mutating PMO data, the platform team wants a typed `defineAction` surface over the deputy client so the agent can use real PMO repositories without bypassing RLS.

**Gate mapping:** G2

## Scope

Build the first PMO-facing `defineAction` set in `pmo/agent-native/actions/`: read parity from `query_entity`, write parity from `create_activity` and `update_task_status`, and the action-layer tests proving caller-JWT/RLS semantics mirror Option A.

## Requirements

- **FR-404** When agent-native reads PMO data, the system shall expose typed read actions over the caller-scoped Supabase client rather than raw SQL.
- **FR-405** When agent-native writes PMO data, the system shall expose typed write actions mirroring `create_activity` and `update_task_status` over the deputy client.
- **FR-406** While PMO actions are registered in agent-native, the system shall begin from the existing Option-A action names and behavior so parity review is diffable.
- **NFR-403** While PMO data crosses the bridge, the system shall preserve RLS as the enforcement ceiling and keep `service_role` off the business path.

## Acceptance criteria

- **AC-404** Given a caller in org A, When the read action queries PMO entities, Then only org-A rows are returned and the action cannot request unwhitelisted entities or columns.
- **AC-405** Given an authorized caller in org A, When the write actions create an activity or update a task, Then same-tenant writes succeed and cross-tenant writes are denied by PMO’s existing RLS.
- **AC-406** Given the domain bridge action tests, When the agent-native app boots, Then the PMO action registry exposes the expected read and write actions by their planned names.

## Traceability table

| AC | Owning layer | Planned proof |
|---|---|---|
| AC-404 | Unit | `pmo/agent-native/test/actions/pmo-query.test.ts` |
| AC-405 | Unit | `pmo/agent-native/test/actions/pmo-write-actions.test.ts` |
| AC-406 | Unit | `pmo/agent-native/test/actions/registry.test.ts` |

## Tasks

1. **Write the failing read-action test for AC-404.** Add `pmo/agent-native/test/actions/pmo-query.test.ts` asserting `actions/pmo-query.ts` rejects unknown entities/columns and returns caller-scoped rows only.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/actions/pmo-query.test.ts`
2. **Implement the read action.** Create `pmo/agent-native/actions/pmo-query.ts` using `defineAction` and the deputy helper to call PMO’s whitelisted reads.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/actions/pmo-query.test.ts`
3. **Write the failing write-action test for AC-405.** Add `pmo/agent-native/test/actions/pmo-write-actions.test.ts` covering `create_activity` and `update_task_status` with same-tenant positive controls and cross-tenant `42501` denials.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/actions/pmo-write-actions.test.ts`
4. **Implement the write actions.** Create `pmo/agent-native/actions/create-activity.ts` and `pmo/agent-native/actions/update-task-status.ts`, mirroring the Option-A input contracts and response shape.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/actions/pmo-write-actions.test.ts`
5. **Write the failing registry test for AC-406.** Add `pmo/agent-native/test/actions/registry.test.ts` asserting the agent-native plugin mounts `pmo_query`, `create_activity`, and `update_task_status`.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/actions/registry.test.ts`
6. **Register the actions in the embedded plugin.** Update `pmo/agent-native/server/plugins/agent-native.ts` to mount the PMO actions in `createAgentNativeEmbeddedPlugin`.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/actions/registry.test.ts`

---

# E3 — Embed

**Job story:** When users open the assistant in PMO, the product team wants the real agent-native UI mounted in the existing shell and themed by PMO tokens so the agent feels native without forking the product.

**Gate mapping:** G1

## Scope

Mount `<AgentNativeEmbedded>` inside the PMO shell, proxy `/agent/*` same-origin to Nitro, hand off bearer auth with `ensureEmbedAuthFetchInterceptor`, and theme the embed with the monochrome-calm token layer through agent-native’s brand-kit/appearance seam.

## Requirements

- **FR-407** When PMO renders the assistant surface, the system shall mount `@agent-native/core/client`’s `<AgentNativeEmbedded>` in the same React tree.
- **FR-408** When the browser calls the sidecar, the system shall proxy `/agent/*` same-origin and attach the PMO session bearer token using `ensureEmbedAuthFetchInterceptor`.
- **FR-409** While the embedded UI renders inside PMO, the system shall derive its theme from PMO’s monochrome-calm design tokens rather than editing agent-native source styles.
- **NFR-404** While theming is in progress, the app shall keep light/dark token parity with `/Users/ariefsaid/Coding/PMO/.claude/worktrees/reskin-port/DESIGN.md`.

## Acceptance criteria

- **AC-407** Given the assistant slot in `pmo-portal/App.tsx`, When the feature flag is enabled, Then `<AgentNativeEmbedded>` renders in the PMO shell and not in an iframe.
- **AC-408** Given an authenticated PMO session, When the embedded UI calls `/agent/*`, Then the request reaches Nitro same-origin with the bearer token attached and unauthenticated requests fail cleanly.
- **AC-409** Given the monochrome-calm token contract, When the embedded UI renders in light and dark themes, Then the owner can evaluate it against the shared token bar without a source fork.

## Traceability table

| AC | Owning layer | Planned proof |
|---|---|---|
| AC-407 | Unit | `pmo-portal/src/components/panel/AgentNativeHost.test.tsx` |
| AC-408 | E2E | `pmo-portal/e2e/AC-408-agent-embed-auth.spec.ts` |
| AC-409 | E2E | `pmo-portal/e2e/AC-409-agent-embed-theme.spec.ts` |

## Tasks

1. **Write the failing mount test for AC-407.** Add `pmo-portal/src/components/panel/AgentNativeHost.test.tsx` asserting the host renders `<AgentNativeEmbedded>` when `VITE_FEATURES_AGENT_NATIVE=true`.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/components/panel/AgentNativeHost.test.tsx`
2. **Implement the PMO host wrapper.** Create `pmo-portal/src/components/panel/AgentNativeHost.tsx` and mount it from `pmo-portal/App.tsx` / the assistant slot in `AppShell`.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/components/panel/AgentNativeHost.test.tsx`
3. **Write the failing auth-proxy e2e for AC-408.** Add `pmo-portal/e2e/AC-408-agent-embed-auth.spec.ts` asserting `/agent/*` works with the PMO session and fails after sign-out.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npx playwright test e2e/AC-408-agent-embed-auth.spec.ts`
4. **Implement same-origin proxy and bearer handoff.** Add the Pages Function proxy in `functions/agent/[[path]].ts`, initialize `ensureEmbedAuthFetchInterceptor` in `AgentNativeHost.tsx`, and document the Vite dev proxy in `pmo/agent-native/README.md`.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npx playwright test e2e/AC-408-agent-embed-auth.spec.ts`
5. **Write the failing theming-e2e for AC-409.** Add `pmo-portal/e2e/AC-409-agent-embed-theme.spec.ts` asserting the embedded surface picks up PMO token-driven background, text, and primary-action values in both themes.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npx playwright test e2e/AC-409-agent-embed-theme.spec.ts`
6. **Implement the token bridge.** Add `pmo/agent-native/app/brand-kit/pmo-theme.ts`, feed it through the sidecar UI entrypoint, and wire PMO light/dark tokens from `pmo-portal/index.css` into the embed host.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npx playwright test e2e/AC-409-agent-embed-theme.spec.ts`

---

# E4 — Context and navigation bridge

**Job story:** When users move around PMO, they want the embedded agent to understand what screen they are on and to drive navigation back into the app so the agent behaves like a citizen, not a detached chat box.

**Gate mapping:** G3

## Scope

Wire PMO UI context into agent-native with `addContextToAgentChat` / `setContextToAgentChat`, route agent-authored navigation commands back into PMO with `useSemanticNavigationState` / `useAgentRouteState`, and add `insertAgentComposerReference`-based `@` references from PMO records.

## Requirements

- **FR-410** When the PMO UI changes context, the system shall stage semantic context items for the embedded agent using the framework’s context API.
- **FR-411** When the embedded agent emits a semantic navigation command, the system shall translate it into PMO route navigation through the framework route-state hooks.
- **FR-412** When the user references a PMO record into the composer, the system shall insert a structured composer reference rather than plain text.
- **NFR-405** While the bridge is active, the system shall expose compact semantic state, not whole page payloads or hidden data rows.

## Acceptance criteria

- **AC-410** Given a project, company, or procurement page is open, When the assistant is opened, Then the embedded composer receives a structured context item describing the current PMO record.
- **AC-411** Given the agent emits a supported navigation command, When PMO consumes it, Then the app navigates to the mapped route exactly once.
- **AC-412** Given the user inserts a PMO reference into the composer, When the reference is added, Then the composer receives a structured `@` reference payload instead of free text.

## Traceability table

| AC | Owning layer | Planned proof |
|---|---|---|
| AC-410 | Unit | `pmo-portal/src/lib/agent-native/contextBridge.test.ts` |
| AC-411 | Unit | `pmo-portal/src/lib/agent-native/routeBridge.test.tsx` |
| AC-412 | Unit | `pmo-portal/src/lib/agent-native/composerReference.test.ts` |

## Tasks

1. **Write the failing context-bridge test for AC-410.** Add `pmo-portal/src/lib/agent-native/contextBridge.test.ts` asserting the current PMO record is converted into `AgentChatContextItem` objects and staged with `setContextToAgentChat`.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/lib/agent-native/contextBridge.test.ts`
2. **Implement the context bridge.** Create `pmo-portal/src/lib/agent-native/contextBridge.ts` and call it from `AgentNativeHost.tsx` / route-level helpers using `addContextToAgentChat` and `setContextToAgentChat`.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/lib/agent-native/contextBridge.test.ts`
3. **Write the failing route-bridge test for AC-411.** Add `pmo-portal/src/lib/agent-native/routeBridge.test.tsx` asserting `useAgentRouteState` maps a semantic command to PMO route navigation once, not repeatedly.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/lib/agent-native/routeBridge.test.tsx`
4. **Implement the route bridge.** Create `pmo-portal/src/lib/agent-native/routeBridge.tsx`, map PMO semantic destinations, and mount it in the app shell near router state.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/lib/agent-native/routeBridge.test.tsx`
5. **Write the failing composer-reference test for AC-412.** Add `pmo-portal/src/lib/agent-native/composerReference.test.ts` asserting PMO record insertion calls `insertAgentComposerReference` with structured metadata.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/lib/agent-native/composerReference.test.ts`
6. **Implement PMO `@` references.** Create `pmo-portal/src/lib/agent-native/composerReference.ts` and wire the relevant record headers/search results to call it.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/lib/agent-native/composerReference.test.ts`

---

# E5 — Live loop

**Job story:** When the owner judges the themed embed, they want the real model loop running end to end so the decision about G1 is based on the actual product, not a stub.

**Gate mapping:** G1

## Scope

Provision the real `ANTHROPIC_API_KEY` into Nitro using the same secret-handling posture as existing PMO server-only credentials, run the panel end-to-end with the live model loop, and lock the smoke journey that proves the embed, deputy bridge, and UI theming all coexist under real runtime conditions.

## Requirements

- **FR-413** When the sidecar runs outside the pilot stub, the system shall call the real configured model provider from the Nitro server.
- **FR-414** When PMO runs the embedded assistant against a live model, the system shall support an end-to-end panel journey from prompt to rendered answer.
- **NFR-406** While the live loop is enabled, the model secret shall remain server-only and absent from the browser bundle.

## Acceptance criteria

- **AC-413** Given the Nitro server has a real `ANTHROPIC_API_KEY`, When the embedded assistant sends a prompt, Then the model call completes through the live server path instead of the stub.
- **AC-414** Given the owner’s seed environment, When they run the curated live-loop smoke journey, Then the embedded panel answers, can call at least one PMO action, and stays visually on-brand enough for G1 review.
- **AC-415** Given a production build of PMO, When the client bundle is inspected, Then the model secret is absent from shipped frontend assets.

## Traceability table

| AC | Owning layer | Planned proof |
|---|---|---|
| AC-413 | E2E | `pmo-portal/e2e/AC-413-agent-live-loop.spec.ts` |
| AC-414 | E2E | `pmo-portal/e2e/AC-414-agent-live-owner-smoke.spec.ts` |
| AC-415 | Unit | `pmo-portal/scripts/no-secret-leak.test.ts` |

## Tasks

1. **Write the failing live-loop smoke for AC-413.** Add `pmo-portal/e2e/AC-413-agent-live-loop.spec.ts` asserting a real prompt returns a model-authored answer and at least one tool call card.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && ANTHROPIC_API_KEY=dummy npx playwright test e2e/AC-413-agent-live-loop.spec.ts`
2. **Wire the server secret path.** Add `pmo/agent-native/.env.example`, `pmo/agent-native/server/lib/model.ts`, and `docs/environments.md` updates documenting local/VPS secret injection for `ANTHROPIC_API_KEY`.  
   **Verify (GREEN with real key):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY npx playwright test e2e/AC-413-agent-live-loop.spec.ts`
3. **Write the failing owner-smoke journey for AC-414.** Add `pmo-portal/e2e/AC-414-agent-live-owner-smoke.spec.ts` covering open panel → ask question → observe answer/tool call → verify brand-token styling markers.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && ANTHROPIC_API_KEY=dummy npx playwright test e2e/AC-414-agent-live-owner-smoke.spec.ts`
4. **Tune live-loop UX only through config and host wiring.** Adjust `pmo/agent-native/app.config.ts`, PMO feature flags, and the host wrapper until the smoke journey passes without forking agent-native UI code.  
   **Verify (GREEN with real key):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY npx playwright test e2e/AC-414-agent-live-owner-smoke.spec.ts`
5. **Write the failing secret-leak guard for AC-415.** Add `pmo-portal/scripts/no-secret-leak.test.ts` asserting built frontend assets contain no `ANTHROPIC_API_KEY` literal.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm run build && node scripts/no-secret-leak.test.ts`
6. **Implement the bundle guard.** Add the guard script and CI step; confirm PMO host code reads only session/auth state client-side and the model key remains Nitro-only.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm run build && node scripts/no-secret-leak.test.ts`

---

# E6 — Security substrate port

**Job story:** When PMO moves from Option A’s face to Option B’s face, the security team wants the deputy model and untrusted-output validator re-proven on every new surface so whole-UI adoption does not weaken tenancy boundaries.

**Gate mapping:** G2, G3

## Scope

Port the deputy security posture to agent-native’s `auth()`/action/client-action surfaces, install a validator boundary for any model-authored output before render/execute, and expand the deputy-invariant canary to cover MCP, A2A, and `defineClientAction`.

## Requirements

- **FR-415** When agent-native resolves PMO identity, the system shall derive deputy auth through `auth()` and per-action/client-action caller verification.
- **FR-416** When model output could render or execute on the client, the system shall pass it through a PMO-owned validator before use.
- **FR-417** When MCP, A2A, or `defineClientAction` surfaces are enabled, the system shall subject them to the same deputy-invariant coverage as normal action reads and writes.
- **NFR-407** While these surfaces exist, CI shall keep a canary that fails on any privileged or cross-tenant regression.

## Acceptance criteria

- **AC-416** Given a PMO-authenticated caller, When agent-native executes a server action or client action, Then the deputy context is rebuilt from the real caller identity and cross-tenant access remains denied.
- **AC-417** Given model-authored output intended for render or execution, When PMO receives it from the sidecar, Then a PMO-owned validator approves or rejects it before UI render or side effects.
- **AC-418** Given MCP, A2A, and `defineClientAction` are enabled, When the expanded deputy canary runs, Then those surfaces are covered and regressions fail CI.

## Traceability table

| AC | Owning layer | Planned proof |
|---|---|---|
| AC-416 | Unit | `pmo/agent-native/test/security/deputy-surfaces.test.ts` |
| AC-417 | Unit | `pmo-portal/src/lib/agent-native/outputValidator.test.ts` |
| AC-418 | Unit | `pmo/agent-native/test/security/deputy-expanded.gate.test.ts` |

## Tasks

1. **Write the failing deputy-surface test for AC-416.** Add `pmo/agent-native/test/security/deputy-surfaces.test.ts` asserting server actions and `defineClientAction` both reconstruct caller-scoped auth and deny cross-tenant access.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/security/deputy-surfaces.test.ts`
2. **Implement deputy auth on all action surfaces.** Update `pmo/agent-native/server/plugins/agent-native.ts`, `pmo/agent-native/app/client-actions/*.ts`, and the deputy helpers so client actions require server-confirmed identity, not blind browser trust.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/security/deputy-surfaces.test.ts`
3. **Write the failing output-validator test for AC-417.** Add `pmo-portal/src/lib/agent-native/outputValidator.test.ts` asserting agent-native composition payloads are rejected until they pass the PMO validator boundary.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/lib/agent-native/outputValidator.test.ts`
4. **Implement the validator boundary.** Create `pmo-portal/src/lib/agent-native/outputValidator.ts` and wire it into the PMO host rendering path for sidecar-authored composition/artifact payloads, reusing ADR-0039 principles.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/lib/agent-native/outputValidator.test.ts`
5. **Write the failing expanded canary for AC-418.** Add `pmo/agent-native/test/security/deputy-expanded.gate.test.ts` covering MCP URL reachability, A2A, and `defineClientAction` deputy enforcement.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/security/deputy-expanded.gate.test.ts`
6. **Promote the expanded canary into CI.** Update the repo CI workflow so the expanded gate runs alongside the original deputy canary whenever `pmo/agent-native/**` or PMO host bridge code changes.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo/agent-native && npx vitest run test/security/deputy-expanded.gate.test.ts`

---

# E7 — `compose_view` parity-check

**Job story:** When PMO decides what to do with `compose_view`, the architecture team wants a side-by-side parity review against agent-native native composition so they retire or keep it from evidence, not taste.

**Gate mapping:** supports G2/G3 retirement decisions; no standalone gate

## Scope

Run a parity check between PMO’s trusted-core `compose_view` path and agent-native native composition, measure feature fit, security fit, and maintenance fit, then record the retire-or-keep outcome in `docs/adr/0043-compose-view-parity-outcome.md`. Do not pre-decide the outcome here.

## Requirements

- **FR-418** When PMO compares composition surfaces, the system shall evaluate agent-native native composition against PMO’s existing `compose_view` feature set and validation boundary.
- **FR-419** When the comparison is complete, the system shall record an explicit retire-or-keep decision for `compose_view`.
- **NFR-408** While the parity-check runs, PMO shall keep the existing `compose_view` path authoritative until the recorded decision says otherwise.

## Acceptance criteria

- **AC-419** Given both composition paths exist, When the parity matrix is executed, Then PMO has a written comparison across feature fit, security fit, and maintenance fit.
- **AC-420** Given the parity matrix findings, When the team records the outcome, Then `compose_view` is explicitly marked retire or keep with reasons.
- **AC-421** Given the parity-check is still open, When other epic issues ship, Then PMO does not remove `compose_view` early.

## Traceability table

| AC | Owning layer | Planned proof |
|---|---|---|
| AC-419 | Unit | `docs/decisions/2026-07-01-compose-view-parity-matrix.md` |
| AC-420 | Unit | `docs/adr/0043-compose-view-parity-outcome.md` |
| AC-421 | Unit | `pmo-portal/src/lib/agent-native/composeViewRetention.test.ts` |

## Tasks

1. **Write the failing retention guard for AC-421.** Add `pmo-portal/src/lib/agent-native/composeViewRetention.test.ts` asserting the PMO host still routes existing `compose_view` artifacts until the decision file explicitly flips.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/lib/agent-native/composeViewRetention.test.ts`
2. **Create the parity matrix document.** Add `docs/decisions/2026-07-01-compose-view-parity-matrix.md` comparing PMO `compose_view` vs agent-native native composition across capability, validator fit, rendering fit, and maintenance cost.  
   **Verify:** `rg -n "feature fit|security fit|maintenance fit|retire|keep" docs/decisions/2026-07-01-compose-view-parity-matrix.md`
3. **Run the evidence pass against both implementations.** Record concrete examples from `pmo-portal/src/lib/viewspec/*`, `supabase/functions/compose-view/*`, and the sidecar composition surface in the matrix document.  
   **Verify:** `rg -n "compose_view|agent-native native composition|validator" docs/decisions/2026-07-01-compose-view-parity-matrix.md`
4. **Record the outcome in architecture docs.** Create `docs/adr/0043-compose-view-parity-outcome.md` with the retire-or-keep decision and keep the retention test aligned with that decision.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npm test -- src/lib/agent-native/composeViewRetention.test.ts`

---

# E8 — Retire Option A and deploy

**Job story:** When Option B reaches parity, the maintainers want one clean production path, one deployment runbook, and no architectural dead doubles so the system stays maintainable.

**Gate mapping:** G2, G3

## Scope

Retire `supabase/functions/agent-chat/*`, `pmo-portal/src/components/panel/*`, and `pmo-portal/src/lib/agent/runtime/*` only after parity is proven; finalize the Nitro-on-VPS + CF Pages Function deployment; and resolve the ADR-0037 number collision before merge.

## Requirements

- **FR-420** When Option B reaches parity, the system shall remove Option A’s agent engine, panel, and runtime port from the live path.
- **FR-421** When PMO deploys whole-UI agent-native, the system shall run Nitro on the VPS behind a same-origin Cloudflare Pages Function proxy.
- **FR-422** When docs from the reskin and dev branches merge, the system shall renumber the conflicting `0037` ADRs before merge.
- **NFR-409** While Option A retirement is underway, the system shall not strand PMO without a working assistant path.

## Acceptance criteria

- **AC-422** Given Option B parity is signed off, When the retirement issue lands, Then the Option-A panel, edge function, and runtime port are removed from the active app path.
- **AC-423** Given the production deploy runbook, When the team performs the deploy, Then Nitro runs on the VPS and PMO’s same-origin proxy reaches it cleanly.
- **AC-424** Given the branch merge prep, When docs are readied for merge, Then the ADR-0037 collision is resolved by renumbering one side before merge.

## Traceability table

| AC | Owning layer | Planned proof |
|---|---|---|
| AC-422 | E2E | `pmo-portal/e2e/AC-422-agent-retirement.spec.ts` |
| AC-423 | E2E | `pmo-portal/e2e/AC-423-agent-deploy-smoke.spec.ts` |
| AC-424 | Unit | docs diff / grep gate |

## Tasks

1. **Write the failing retirement smoke for AC-422.** Add `pmo-portal/e2e/AC-422-agent-retirement.spec.ts` asserting the PMO assistant opens the Option-B embed and no longer hits Option-A endpoints.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npx playwright test e2e/AC-422-agent-retirement.spec.ts`
2. **Remove Option A from the active path.** Delete `supabase/functions/agent-chat/*`, `pmo-portal/src/components/panel/*`, and `pmo-portal/src/lib/agent/runtime/*` after parity sign-off, and update all PMO imports to the new host wrapper.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npx playwright test e2e/AC-422-agent-retirement.spec.ts`
3. **Write the failing deploy smoke for AC-423.** Add `pmo-portal/e2e/AC-423-agent-deploy-smoke.spec.ts` asserting the same-origin `/agent/*` path reaches Nitro in the deployed environment.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npx playwright test e2e/AC-423-agent-deploy-smoke.spec.ts`
4. **Finalize deployment assets and runbook.** Update `docs/environments.md`, add the Pages Function proxy deployment notes, and document the Nitro systemd/Caddy/VPS run steps for `pmo/agent-native/`.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision/pmo-portal && npx playwright test e2e/AC-423-agent-deploy-smoke.spec.ts`
5. **Write the failing ADR-collision guard for AC-424.** Add `scripts/check-adr-unique-numbers.sh` asserting no two ADR files share `0037-` once merge prep is complete.  
   **Verify (RED):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision && bash scripts/check-adr-unique-numbers.sh`
6. **Resolve the ADR collision and wire the guard into CI/docs review.** Renumber the monochrome-calm redesign ADR to `docs/adr/0044-monochrome-calm-design-language.md` before merge and update all references in `docs/adr/`, `docs/plans/`, and `docs/backlog.md`.  
   **Verify (GREEN):** `cd /Users/ariefsaid/Coding/PMO/.claude/worktrees/agent-native-decision && bash scripts/check-adr-unique-numbers.sh`

---

## Epic sequencing

1. **E1 Foundation**
2. **E2 Domain bridge**
3. **E3 Embed** and **E4 Context/nav bridge** may overlap after E1/E2 land
4. **E5 Live loop** once E3 is working and a real `ANTHROPIC_API_KEY` is available
5. **E6 Security substrate port** before any parity sign-off
6. **E7 compose_view parity-check** before retirement decisions
7. **E8 Retire A + deploy** last

## Issue handoff rules for the Director

- Each E-issue gets its **own spec and build-time plan** before implementation.
- Carry forward the same three gates (G1/G2/G3) into every issue brief.
- Keep the reskin track in lockstep on token changes; the embed must follow the shared token contract, not invent its own.
- Do not let any issue silently pre-decide `compose_view` retirement.
- Do not merge with the ADR-0037 number collision unresolved.

## Program verification checklist

Before the Director calls this epic ready to execute, re-read against the brief and confirm all of the following are present:
- Option B whole-UI adoption, not hybrid
- all six flip facts recorded in ADR-0040
- G1/G2/G3 explicit, not footnotes
- E1–E8 enumerated
- parallel-with-reskin sequencing
- honest cost (Nitro server, same-origin proxy, second data layer, churn)
- staged retirement of Option A
- `compose_view` left as a parity-check
- ADR-0037 renumber-before-merge hazard called out

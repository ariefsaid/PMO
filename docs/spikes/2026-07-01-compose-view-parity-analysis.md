# Compose-view parity analysis for E7 (`@agent-native/core@0.84.8`)

> SDK pin: `@agent-native/core@0.84.8`.
> Churn caveat: agent-native is moving quickly; every symbol below was checked against the currently installed `dist/**/*.d.ts`, and should be re-verified if the SDK version changes.

## 1. What `compose_view` is in PMO today

### Summary
`compose_view` is not just “AI makes UI.” It is a **trusted PMO view-definition pipeline**:

1. the agent/tool asks for a view from natural language,
2. the model is forced to emit a **`CompositionSpec` v1**,
3. PMO runs that output through `compileCompositionSpec(...)`,
4. PMO executes only the compiled, whitelisted queries under the viewer JWT,
5. PMO hydrates one of **7 approved primitives**.

The security boundary is the compiler/validator, not the prompt.

### Entry points
- Agent action catalog: `supabase/functions/agent-chat/actions.ts`
  - `composeViewAction` is the tool contract (`name: 'compose_view'`, `FR-CV-001`).
  - `runComposeView(...)` calls shared `composeSpec(...)` and returns `{ spec, repairAttempts, tokensUsed, title }`.
- Edge function: `supabase/functions/compose-view/`
  - `index.ts` verifies JWT, builds a caller-JWT Supabase client, loads Anthropic, and delegates to `composeViewHandler(...)`.
  - `handler.ts` enforces request gates, derives/validates `orgId`, then calls the shared `composeSpec(...)` path.
  - `composeSpec.ts` owns model call + bounded repair loop.
  - `schema.ts` defines the `compose_view` tool JSON schema.
  - `prompt.ts` builds the tool-forced system prompt from whitelist + registry metadata only.

### What a `CompositionSpec` contains
Defined in `pmo-portal/src/lib/viewspec/types.ts`.

Top level:
- `version: 1`
- `panels: PanelSpec[]`

Each panel contains:
- `id`
- `primitive`
- `querySpec`
- optional `layout`
- optional `props`

`querySpec` supports:
- `entity`
- `select`
- optional `filters`
- optional `groupBy`
- optional `aggregate`
- optional `timeRange`
- optional `limit`
- optional `orderBy`

Compiler context/tokens are also first-class: `$current_user`, `$current_org`, `$current_team`, `$current_project`, `$today`, `$start_of_month`, `$end_of_month`.

### The 7 PMO primitives
From `pmo-portal/src/lib/viewspec/registry.ts`:
- `DataTable`
- `KPITile`
- `StatTiles`
- `Funnel`
- `StatusBarChart`
- `ProgressBar`
- `Card`

This registry is PMO’s single source of truth for allowed primitive names, prop schemas, and data-shape contracts.

### How rendering works
- `compileCompositionSpec(...)` in `pmo-portal/src/lib/viewspec/compiler.ts`
  - validates version
  - validates primitive exists in registry
  - validates entity/column/operator/token use against `ENTITY_WHITELIST`
  - enforces special rules like `tasks` requiring `project_id`
  - outputs `CompiledPanel[]`
- `executeCompiledQuery(...)` in `pmo-portal/src/lib/viewspec/executor.ts`
  - dispatches to Supabase PostgREST using whitelist table metadata
  - applies only allowed filter ops
  - runs under the viewer JWT
  - does in-memory grouped aggregation when needed
- `HydratedPrimitive` in `pmo-portal/src/components/dashboard/HydratedPrimitive.tsx`
  - maps compiled panel + fetched data into the real PMO primitive component
- page renderer: `pmo-portal/pages/UserViewRenderer.tsx`
  - compiles before execution
  - renders per-panel loading/empty/error/ready states

### ADR intent
- `docs/adr/0036-agent-native-user-composed-ui.md`
  - establishes the PMO pattern: declarative spec, existing primitive kit, user-owned views as data.
- `docs/adr/0037-view-composition-compiler-dsl.md`
  - fixes the DSL/whitelist/compiler rules.
- `docs/adr/0038-view-renderer-executor-dispatch-pattern.md`
  - fixes execution via direct Supabase/PostgREST chaining under RLS.
- `docs/adr/0039-pmo-native-agent-untrusted-output-boundary.md`
  - makes `compileCompositionSpec(...)` the **untrusted-output validation boundary**.

### ADR-0039 security boundary
This is the key parity requirement.

Verified behavior:
- model output is **tool-forced** to a `CompositionSpec`-shaped schema (`supabase/functions/compose-view/schema.ts`)
- PMO still does **server-side compiler validation** in `composeSpec.ts`
- PMO does **client-side compiler validation again** before UI population/saving (`ADR-0039`; also used by artifact/builder flows)
- all business data access runs through caller JWT / RLS
- no raw SQL, no executable generated code, no arbitrary primitive names, no arbitrary entities/columns

So `compose_view` is really:
**PMO-specific declarative UI + PMO-specific query DSL + PMO-specific validator + PMO-specific renderer**.

## 2. What agent-native offers for composition

Reference baseline first: `docs/spikes/2026-07-01-agent-native-integration-api-reference.md` §5.
Verified again against installed SDK types under `/Users/ariefsaid/Coding/PMO-sidecar/pmo/agent-native/node_modules/@agent-native/core/dist/`.

### `action-ui`
File checked: `dist/action-ui.d.ts`

Verified symbols:
- `ActionChatUIConfig { renderer, title?, description? }`
- built-in renderer ids:
  - `core.data-table`
  - `core.data-chart`
  - `core.data-insights`
  - `core.data-widget`
  - `core.inline-extension`

What it renders:
- structured **chat action result UI** inside agent-native chat.

What it is not:
- not a host-route/view composition contract
- not a PMO entity/query DSL
- not a persisted “user-defined dashboard/page” model

### `data-widgets`
File checked: `dist/data-widgets/index.d.ts`

Verified shapes:
- `DataTableWidget`
- `DataChartWidget`
- `DataInsightsWidgetResult`
- `DataWidgetResult`
- helper constructors/normalizers/schemas

What it renders/represents:
- typed table/chart/insight payloads for action results.

What it is not:
- not a multi-panel host layout spec
- not a persisted view definition
- not a validator for “allowed PMO entity/column/aggregate/filter combinations”

### `client/blocks`
Files checked:
- `dist/client/blocks/index.d.ts`
- `dist/client/blocks/types.d.ts`
- `dist/client/blocks/library/specs.d.ts`
- `dist/client/blocks/library/wireframe.config.d.ts`

Verified surface:
- `defineBlock`, `BlockSpec`, `BlockRegistry`, `BlockView`, `SchemaBlockEditor`
- many first-party content blocks: checklist, table, code-tabs, html, tabs, columns, callout, diagram, wireframe, data-model, diff, file-tree, json-explorer, openapi, etc.
- `wireframe` is a nested MDX block with its own `WireframeNode` vocabulary and renderer model

What it renders:
- structured **document/content blocks** and editable content trees.

What it is not:
- not a PMO dashboard/view runtime bound to PMO entities
- not a built-in “compose host app views from app-owned query specs” public contract
- closer to content/docs/wireframes than live PMO route composition

### `client/mcp-apps/McpAppRenderer`
File checked: `dist/client/mcp-apps/McpAppRenderer.d.ts`

Verified symbols:
- `McpAppRenderer({ app, className })`
- helper functions for CSP/permissions/height/ready-message

What it renders:
- MCP App payloads/resources, effectively an app/resource renderer, often iframe-like.

What it is not:
- not a native PMO route composer
- not a replacement for PMO’s declarative query+primitive pipeline
- more analogous to “embed/render a tool-provided app resource” than “compile a PMO dashboard spec”

### `client/composer`
Files checked:
- `dist/client/composer/index.d.ts`
- `dist/client/composer/PromptComposer.d.ts`
- `dist/client/composer/TiptapComposer.d.ts`

Verified symbols include:
- `AgentComposerFrame`
- `PromptComposer`
- `TiptapComposer`
- mention/file/skill reference extensions

What it renders:
- prompt input/composer UX.

What it is not:
- not view composition
- not route/page composition
- not app-native dashboard schema

### `client/editor`
File checked: `dist/client/editor/index.d.ts`

Verified export:
- re-exports `../rich-markdown-editor/index.js`

What it renders:
- rich markdown/content editor surface.

What it is not:
- not PMO host-view composition

### `client/resources`
Files checked:
- `dist/client/resources/index.d.ts`
- `dist/client/resources/ResourceEditor.d.ts`
- `dist/client/resources/ResourceTree.d.ts`
- `dist/client/resources/use-resources.d.ts`

Verified symbols:
- `ResourcesPanel`
- `ResourceTree`
- `ResourceEditor`
- resource hooks/types

What it renders:
- workspace/resource browser/editor surfaces.

What it is not:
- not a PMO dashboard/view composition contract

### Bottom line on agent-native composition
Verified agent-native surfaces are strong for:
- structured action result UI in chat
- widget payloads
- content/block composition
- wireframes and docs
- MCP app rendering
- composer/editor/resource UX

I did **not** verify a public SDK contract equivalent to:
- “take a PMO-hosted entity/query/layout spec,
- validate it against a PMO allowlist,
- materialize it as a PMO native route/view.”

## 3. Gap analysis

| compose_view capability | agent-native equivalent | Status | Note |
|---|---|---:|---|
| Natural-language -> typed UI artifact | `action-ui` + `data-widgets` + blocks | Partial | agent-native can return structured/native UI payloads, but not a verified PMO `CompositionSpec` equivalent. |
| Persisted multi-panel host view definition | No verified public equivalent | None | No checked type exposed a user-owned saved host-view schema analogous to PMO `CompositionSpec`. |
| PMO-specific query DSL (`entity/select/filters/groupBy/aggregate/timeRange/orderBy`) | No verified public equivalent | None | agent-native types checked were widget/content/MCP-app focused, not app-entity query-schema focused. |
| Registry of exactly 7 PMO runtime primitives | Could be emulated with blocks/widgets/custom UI | Partial | Building blocks exist, but PMO’s exact primitive registry/props/data-shape contract remains PMO-owned. |
| Compiler validation against PMO whitelist | No verified public equivalent | None | No checked agent-native type provided PMO’s `compileCompositionSpec(...)`-style trust boundary. |
| Execution under viewer JWT + RLS-scoped host data | Host responsibility | Partial | agent-native does not replace PMO’s tenancy/authz model; PMO still owns the deputy/RLS path. |
| Hydration into native PMO route/page | Could be custom integration | Partial | Possible to build on top of agent-native, but not shipped/verified as a 1:1 SDK surface. |
| Chat transcript artifact rendering | `action-ui`, `data-widgets`, `McpAppRenderer` | Found | Good parity for chat-local structured results. |
| Document/content composition | `@agent-native/core/blocks` | Found | Strong, but this is content/block composition, not PMO saved dashboard composition. |
| Wireframe/schematic UI composition | `wireframe` block | Found | Useful for mockups/spec docs, not a verified live PMO view runtime. |
| Resource/workspace editing | `client/resources` | Found | Adjacent capability, not host view composition. |
| Security boundary for untrusted model output | PMO validator still required | None in checked SDK | Even if agent-native emits richer native UI, PMO still needs an equivalent allowlist/compiler boundary before rendering/saving app-owned views. |

### Security/validation boundary conclusion
Adopting agent-native composition does **not** remove the need for ADR-0039’s validator.

Why:
1. PMO’s risk is not just malformed JSON; it is **unauthorized or out-of-contract host UI definitions**.
2. The dangerous part is the model proposing:
   - unknown entities
   - unknown columns
   - invalid aggregations
   - invalid required filters
   - unsupported primitives
   - arbitrary executable/embeddable output
3. The checked agent-native surfaces do not prove a PMO-specific allowlist compiler equivalent.
4. Therefore PMO still needs a trust boundary that says: “this output is allowed to become a PMO view.”

If PMO later maps compose_view onto agent-native blocks/widgets, the validator may change shape, but **the boundary itself is still required**.

## 4. Recommendation (evidence-backed, not final)

## Recommendation: **hybrid, with “keep compose_view core for now” as the practical posture**

### Why
1. **Retire now is not evidence-supported.**
   I did not verify a 1:1 agent-native contract for persisted, PMO-native, query-backed host views.
2. **Keep forever is probably too strong.**
   agent-native clearly has useful native composition building blocks for chat UI, blocks, widgets, and app resources.
3. **Hybrid is the lowest-risk path.**
   Use agent-native where it is already strong, but keep PMO’s `compose_view` trusted core until a concrete adapter proves parity.

### Concretely, what “hybrid” means
Use agent-native for:
- agent chat/composer/editor/resources UX
- action-result renderers (`action-ui`, `data-widgets`)
- MCP app/resource rendering where appropriate
- content/block composition workflows

Keep PMO-owned for user-composed PMO views:
- `CompositionSpec`-style persisted view artifact
- PMO entity/query DSL
- PMO primitive registry
- compiler/validator trust boundary
- viewer-JWT/RLS-backed execution
- PMO route/page hydration

### Decision-path implications

#### If PMO eventually wants to **retire** `compose_view`
It still needs a replacement that proves all of these:
- persisted host-view schema exists or can be cleanly defined
- PMO primitive contract can be represented without weakening UX/security
- PMO entity/query allowlist validator remains authoritative
- route/view hydration is native, not merely chat-local or iframe-local
- save/reopen/share lifecycle matches current `user_views` model

#### If PMO chooses to **keep** `compose_view`
Follow-up work is mostly:
- keep the current DSL/renderer/validator as the canonical PMO view path
- integrate agent-native around it rather than instead of it
- optionally add adapter layers so agent-native actions can emit PMO `CompositionSpec` artifacts

#### If PMO chooses **hybrid**
Recommended follow-up work:
1. Define the adapter boundary explicitly:
   - which agent-native surface is allowed to originate PMO view artifacts?
   - what exact object crosses into PMO validation?
2. Decide whether PMO view artifacts remain `CompositionSpec` v1 or get a v2 wrapper.
3. Keep ADR-0039’s server/client validation rule unchanged until parity is proven.
4. Prototype one narrow bridge:
   - agent-native action result -> PMO `CompositionSpec` -> existing PMO compiler/renderer
   - or agent-native block/widget payload -> PMO adapter -> compiler-equivalent validator
5. Only consider retirement after a live proof shows no loss in:
   - security boundary
   - PMO-native rendering
   - persistence/reopen/share behavior
   - primitive/query expressiveness

### Live checks still needed
These were **not** proven in this pass and still need targeted verification before any retirement decision:
- whether another exported agent-native type outside the checked surfaces provides a direct saved-app/view composition contract
- whether Builder’s runtime expects MCP app resources, blocks, or action-ui payloads as the intended “native composition” replacement for host-defined views
- whether a PMO-native route/page can be recreated without effectively rebuilding `compose_view` semantics on top of agent-native

### Final evidence call
Based on the checked PMO code and checked `@agent-native/core@0.84.8` types:
- agent-native **does** provide rich native composition primitives,
- but I could **not** confirm a direct replacement for PMO `compose_view`,
- and I could **not** justify dropping ADR-0039’s validation boundary.

So the evidence currently supports:
**hybrid / keep-the-compose_view-core until a live parity spike proves otherwise**.

## Verification notes
Re-opened and confirmed before writing:
- PMO primitives exist in `pmo-portal/src/lib/viewspec/registry.ts`: `DataTable`, `KPITile`, `StatTiles`, `Funnel`, `StatusBarChart`, `ProgressBar`, `Card`.
- PMO validator/compiler exists in `pmo-portal/src/lib/viewspec/compiler.ts` as `compileCompositionSpec(...)`.
- agent-native checked symbols exist in:
  - `dist/action-ui.d.ts`
  - `dist/data-widgets/index.d.ts`
  - `dist/client/mcp-apps/McpAppRenderer.d.ts`
  - `dist/client/blocks/index.d.ts`
  - `dist/client/composer/index.d.ts`
  - `dist/client/editor/index.d.ts`
  - `dist/client/resources/index.d.ts`

Claims I did **not** confirm and therefore did **not** rely on:
- any direct public agent-native `compose_view`-equivalent API
- any public agent-native saved host-view schema for app-native routes/pages

COMPOSE-PARITY-DONE

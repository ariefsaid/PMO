# Agent Native integration API reference (`@agent-native/core@0.84.8`)

Pinned against the installed SDK at `/Users/ariefsaid/Coding/PMO-sidecar/pmo/agent-native/node_modules/@agent-native/core/`.

> Caveat: this SDK churns quickly. Re-verify every symbol against `package.json` exports and `dist/**/*.d.ts` at build time; do not trust this doc once the version changes.

## 1) Embed

### Verdict
`<AgentNativeEmbedded>` is a same-React-tree host component, not the iframe `embedding/*` surface.

Evidence:

- Public import: `@agent-native/core/client`
- Verified file: `dist/client/AgentNativeEmbedded.d.ts`
- Signature shows it extends `AgentSidebarProps` and returns `React.JSX.Element`, not an iframe ref:

```ts
export interface AgentNativeEmbeddedProps extends Omit<AgentSidebarProps, "children">, UseAgentNativeEmbeddedBrowserSessionOptions {
    children?: React.ReactNode;
    surface?: "sidebar" | "panel";
    panel?: AgentChatSurfaceProps;
}
export declare function AgentNativeEmbedded({ children, surface, actions, getContext, enabled, screen, commands, session, browserSession, onNavigate, onOpenResource, onRefresh, onRemount, onRequestApproval, panel, ...sidebarProps }: AgentNativeEmbeddedProps): React.JSX.Element;
```

What it's for: colocated embed where the PMO shell and agent UI live in the same React app tree.

Minimal sketch:

```tsx
import { AgentNativeEmbedded } from "@agent-native/core/client";

<AgentNativeEmbedded position="right" defaultOpen surface="sidebar">
  <PmoShell />
</AgentNativeEmbedded>
```

Host composition: because it inherits `AgentSidebarProps`, host content composes as `children` inside the wrapper. In the pilot, host content is wrapped by `<AgentSidebar>` and remains the main shell while the agent docks on the side; this is sibling/wrapper composition, not iframe overlay mounting.

Pilot evidence (`embed/main.tsx`):

```tsx
<AgentSidebar position="right" defaultOpen={true} ...>
  <MockPmoShell />
</AgentSidebar>
```

### Related embed session/browser bridge

- Public import: `@agent-native/core/client`
- Signature:

```ts
export interface UseAgentNativeEmbeddedBrowserSessionOptions {
    enabled?: boolean;
    actions?: AgentNativeClientActions;
    getContext?: AgentNativeHostContextGetter;
    screen?: boolean | AgentNativeScreenSnapshotOptions;
    commands?: AgentNativeHostCommandHandlers;
    session?: string | Partial<AgentNativeHostSession>;
    browserSession?: AgentNativeEmbeddedBrowserSessionOptions;
    onRefresh?: AgentNativeEmbeddedCommandCallback;
    onNavigate?: AgentNativeEmbeddedCommandCallback;
    onRemount?: AgentNativeEmbeddedCommandCallback;
    onOpenResource?: AgentNativeEmbeddedCommandCallback;
    onRequestApproval?: AgentNativeEmbeddedCommandCallback;
}
export declare function useAgentNativeEmbeddedBrowserSession(...): void;
```

What it's for: same-tree host/agent bridge for host context, host actions, screen snapshots, and command callbacks.

### Bearer handoff for embeds

- Public import: `@agent-native/core/client`
- Verified file: `dist/client/embed-auth.d.ts`

```ts
export declare function getEmbedAuthToken(): string | null;
export declare function ensureEmbedAuthFetchInterceptor(): void;
```

What it's for: same-origin embed auth handoff. The pilot writes the JWT to `sessionStorage` and installs the interceptor so `/_agent-native/*` fetches carry Bearer auth.

Minimal sketch:

```ts
import { ensureEmbedAuthFetchInterceptor } from "@agent-native/core/client";
sessionStorage.setItem("agent-native:embed-auth-token", jwt);
ensureEmbedAuthFetchInterceptor();
```

### Contrast surfaces

#### `AgentPanel`
- Public import: `@agent-native/core/client`
- Verified file: `dist/client/AgentPanel.d.ts`

```ts
export declare function AgentPanel(props: AgentPanelProps): React.JSX.Element;
export interface AgentSidebarProps { children: React.ReactNode; ... }
export declare function AgentSidebar(...): React.JSX.Element;
```

What it's for: raw chat/panel surface with no layout opinions.

#### `AgentNativeFrame`
- Public import: `@agent-native/core/client`
- Verified file: `dist/client/AgentNativeFrame.d.ts`

```ts
export interface AgentNativeFrameProps extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src"> {
    agentUrl: string;
    agentOrigin?: string;
    session?: string | Partial<AgentNativeHostSession>;
    getContext?: AgentNativeHostContextGetter;
    commands?: AgentNativeHostCommandHandlers;
    actions?: AgentNativeClientActions;
    auth?: AgentNativeHostAuth;
    onBridgeEvent?: (event: AgentNativeHostBridgeEvent) => void;
    onBridgeReady?: (bridge: AgentNativeHostBridge) => void;
}
export declare const AgentNativeFrame: React.ForwardRefExoticComponent<AgentNativeFrameProps & React.RefAttributes<HTMLIFrameElement>>;
```

What it's for: iframe sidecar integration.

#### iframe `EmbeddedApp`
- Public import: `@agent-native/core/embedding`
- Verified file: `dist/embedding/react.d.ts`

```ts
export interface EmbeddedAppProps extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, "src" | "onLoad"> {
    url: string;
    targetOrigin?: string;
    allowedOrigins?: string[];
    embed?: boolean | EmbeddedAppUrlOptions;
    onLoad?: (ref: EmbeddedAppRef) => void;
    onReady?: (payload: unknown, event: MessageEvent, ref: EmbeddedAppRef) => void;
    onMessage?: <TPayload = unknown>(name: string, payload: TPayload, event: MessageEvent, ref: EmbeddedAppRef) => void;
    onRequest?: (name: string, payload: unknown, event: MessageEvent, ref: EmbeddedAppRef) => unknown | Promise<unknown>;
}
export declare const EmbeddedApp: ...
```

What it's for: generic embedded iframe app bridge.

Selection guidance:
- PMO colocated app shell + agent UI: use `AgentNativeEmbedded` / `AgentSidebar`.
- Remote sidecar in iframe: use `AgentNativeFrame`.
- Generic iframe message bridge: use `EmbeddedApp`.

## 2) Theming

### What is actually typed

#### Brand Kit token shape
- Public import: `@agent-native/core/brand-kit`
- Verified file: `dist/brand-kit/types.d.ts`

```ts
export interface BrandKitColors {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    surface: string;
    text: string;
    textMuted: string;
}
export interface BrandKitTypography {
    headingFont: string;
    bodyFont: string;
    headingWeight: string;
    bodyWeight: string;
    headingSizes: { h1: string; h2: string; h3: string; };
}
export interface BrandKitSpacing {
    elementGap: string;
    [paddingKey: string]: string;
}
export interface BrandKitBorders {
    radius: string;
    accentWidth: string;
}
export interface BrandKitData {
    colors: BrandKitColors;
    typography: BrandKitTypography;
    spacing: BrandKitSpacing;
    borders: BrandKitBorders;
    logos: BrandKitLogo[];
    imageStyle?: BrandKitImageStyle;
    customCSS?: string;
    notes?: string;
}
```

What it's for: normalized brand/design token data model.

Important constraint: this type is a single token set; there is no first-class light/dark split in `BrandKitData`.

#### Brand signal extraction
- Public import: `@agent-native/core/brand-kit`
- Verified file: `dist/brand-kit/types.d.ts`, `dist/brand-kit/brand-signals.d.ts`

```ts
export interface BrandWebsiteSignals {
    url: string;
    themeColor?: string;
    cssCustomProperties?: Record<string, string>;
    fontFaces?: { family?: string; src?: string; }[];
    pageTitle?: string;
    metaDescription?: string;
}
export declare function extractBrandSignalsFromHtml(html: string, url: string): BrandWebsiteSignals;
export declare function fetchBrandWebsiteSignals(websiteUrl: string): Promise<BrandWebsiteSignals | { url: string; error: string; }>;
```

What it's for: scrape CSS vars/fonts/theme hints from a site.

#### Server token extraction utilities
- Public import: `@agent-native/core/server/design-token-utils`
- Verified file: `dist/server/design-token-utils.d.ts`

```ts
export interface ParsedCss {
    cssCustomProperties: Record<string, string> | undefined;
    fonts: string[] | undefined;
}
export interface ParsedTailwindConfig {
    colors?: Record<string, string>;
    fontFamily?: Record<string, string>;
    spacing?: Record<string, string>;
    borderRadius?: Record<string, string>;
}
export declare function parseCss(content: string): ParsedCss;
export declare function parseTailwindConfig(content: string): Record<string, unknown>;
export declare function extractCssVars(state: CodeAnalysisState, content: string): void;
export declare function extractDesignTokensFromUrl(rawUrl: string): Promise<UrlExtractionResult>;
```

What it's for: import/analyze host tokens; not runtime theming injection.

#### Appearance preset picker
- Public import: `@agent-native/core/client`
- Verified file: `dist/client/AppearancePicker.d.ts`

```ts
export interface AppearancePickerProps {
    className?: string;
    onChange?: (preset: AppearancePresetId) => void;
}
export declare function AppearancePicker({ className, onChange, }: AppearancePickerProps): import("react").JSX.Element;
```

Related preset ids (`dist/client/appearance.d.ts`): `default | warm | ocean | forest | rose | slate`.

What it's for: choose built-in appearance presets; not host token mapping.

#### Light/dark theme support
- Public import: `@agent-native/core/client`
- Verified file: `dist/client/theme.d.ts`

```ts
export type ThemePreference = "light" | "dark" | "system";
export declare function getThemeInitScript(defaultTheme?: ThemePreference, enableSystem?: boolean): string;
```

What it's for: first-class light/dark/system mode bootstrap.

Related provider seam (`dist/client/app-providers.d.ts`):

```ts
defaultTheme?: string;
themeAttribute?: Attribute | Attribute[];
```

### Concrete answer: how a host maps its own CSS-variable tokens

What I could confirm from the installed types:

1. Runtime dark mode is first-class via `ThemePreference = "light" | "dark" | "system"`.
2. The provider can target theme state to `class` and/or `data-theme` via `themeAttribute`.
3. Brand-kit and design-token-utils give you extraction/normalization types (`colors`, `typography`, `spacing`, `borders`, `cssCustomProperties`), but I did **not** find a public typed API that accepts a host token object and injects it into `AgentNativeEmbedded` directly.
4. Therefore the verified seam is:
   - keep PMO as source of truth in CSS variables,
   - key light/dark off `.dark` and/or `data-theme`,
   - optionally extract/normalize PMO tokens into `BrandKitData` for agent-facing brand context,
   - use `AppearancePicker` only if PMO wants AN's built-in preset switching.

Minimal sketch:

```tsx
// verified seams only
<AppProviders defaultTheme="system" themeAttribute={["class", "data-theme"]}>
  <AgentNativeEmbedded>{/* PMO shell */}</AgentNativeEmbedded>
</AppProviders>
```

And map PMO tokens conceptually into:
- colors → `BrandKitColors`
- typography → `BrandKitTypography`
- spacing → `BrandKitSpacing`
- radii/border widths → `BrandKitBorders`
- site CSS vars → `BrandWebsiteSignals.cssCustomProperties`

Not found: a verified typed `theme={{...tokens}}` prop on `AgentNativeEmbedded`, `AgentPanel`, or `AppearancePicker`.

## 3) Context/nav bridge

### Host UI context -> agent

#### `AgentChatContextItem`
- Public import: `@agent-native/core/client`
- Verified file: `dist/client/agent-chat.d.ts`

```ts
export interface AgentChatContextItem {
    key: string;
    title: string;
    context: string;
}
```

What it's for: staged context chip + hidden prompt context.

#### `listAgentChatContext`
- Public import: `@agent-native/core/client`

```ts
export declare function listAgentChatContext(): AgentChatContextItem[];
```

What it's for: inspect current staged context.

#### `setContextToAgentChat` / `addContextToAgentChat`
- Public import: `@agent-native/core/client`

```ts
export declare function setAgentChatContextItem(opts: AgentChatContextSetOptions): void;
export declare const setContextToAgentChat: typeof setAgentChatContextItem;
export declare const addContextToAgentChat: typeof setAgentChatContextItem;
```

What it's for: add/replace staged context. Both requested names exist but are deprecated aliases.

Minimal sketch:

```ts
import { setContextToAgentChat } from "@agent-native/core/client";
setContextToAgentChat({ key: "company", title: "Acme Co", context: "Viewing company Acme Co (id=cmp_123)" });
```

### Agent -> host navigation

#### `SemanticNavigationCommandEnvelope`
- Public import: `@agent-native/core/client`
- Verified file: `dist/client/route-state.d.ts`

```ts
export interface SemanticNavigationCommandEnvelope<NavigateCommand> {
    key: string;
    command: NavigateCommand;
}
```

What it's for: dedupable one-shot nav command wrapper.

#### `useSemanticNavigationState`
- Public import: `@agent-native/core/client`

```ts
export declare function useSemanticNavigationState<NavigationState, NavigateCommand = NavigationState>(options: UseSemanticNavigationStateOptions<NavigationState, NavigateCommand>): UseSemanticNavigationStateResult<NavigationState, NavigateCommand>;
```

Key options:

```ts
state: NavigationState | null | undefined;
onCommand: (command: NavigateCommand) => void | Promise<void>;
navigationKeys?: readonly string[];
commandKeys?: readonly string[];
```

What it's for: generic state-out / command-in bridge.

#### `useAgentRouteState`
- Public import: `@agent-native/core/client`

```ts
export declare function useAgentRouteState<NavigationState, NavigateCommand = NavigationState>(options: UseAgentRouteStateOptions<NavigationState, NavigateCommand>): UseAgentRouteStateResult<NavigationState, NavigateCommand>;
```

Key options:

```ts
getNavigationState: (location: AgentRouteLocation) => NavigationState | null | undefined;
getCommandPath: (command: NavigateCommand) => string | null | undefined;
browserTabId?: string;
onNavigate?: (command: NavigateCommand, path: string) => void;
```

What it's for: React Router convenience wrapper.

Minimal sketch:

```ts
useAgentRouteState({
  getNavigationState: ({ pathname }) => ({ view: pathname }),
  getCommandPath: (cmd) => cmd.view === "companies" ? "/companies" : null,
});
```

### Composer references / @-mention style entity wiring

- Public import: `@agent-native/core/client`
- Verified file: `dist/client/agent-chat.d.ts`

```ts
export declare function normalizeAgentComposerReference(value: unknown): AgentComposerReference | null;
export declare function insertAgentComposerReference(ref: AgentComposerReference, options?: AgentComposerReferenceInsertOptions): void;
```

Reference shape:

```ts
export interface AgentComposerReference {
    label: string;
    icon?: string;
    source?: string;
    refType: string;
    refId?: string | null;
    refPath?: string | null;
    slotKey?: string;
    slotLabel?: string;
    metadata?: Record<string, unknown>;
    clearsSlots?: string[];
    relatedReferences?: AgentComposerReference[];
}
```

What it's for: insert normalized entity mentions/tags into the composer.

Minimal sketch:

```ts
insertAgentComposerReference({
  label: "Acme Co",
  refType: "company",
  refId: "cmp_123",
  slotKey: "active-company",
});
```

## 4) Actions + BYOA auth

### `defineAction`
- Public import: `@agent-native/core/action` (also re-exported from `@agent-native/core`)
- Verified file: `dist/action.d.ts`

```ts
export declare function defineAction<TSchema extends StandardSchemaV1, TReturn, TOutputSchema extends StandardSchemaV1 | undefined = undefined>(options: DefineActionWithSchema<TSchema, TReturn, TOutputSchema>): ActionDefinition<StandardSchemaV1.InferInput<TSchema>, TReturn>;
export declare function defineAction<TParams extends Record<string, ParameterSchema> | undefined, TReturn>(options: DefineActionWithParams<TParams, TReturn>): ActionDefinition<InferParams<TParams>, TReturn>;
```

`run` context seam:

```ts
export interface ActionRunContext {
    send?: (event: AgentChatEvent) => void;
    userEmail?: string;
    orgId?: string | null;
    caller: ActionCaller;
    attachments?: AgentChatAttachment[];
    signal?: AbortSignal;
    actionName?: string;
    threadId?: string;
    turnId?: string;
}
```

What it's for: server/backend actions callable by agent, HTTP, frontend, MCP, A2A.

### `defineClientAction`
- Public import: `@agent-native/core/client`
- Verified file: `dist/client/client-action.d.ts`

```ts
export type AgentNativeClientActionRunner<TArgs, TResult> = (args: TArgs, runtime: AgentNativeClientActionRuntime) => TResult | Promise<TResult>;
export declare function defineClientAction<TArgs = unknown, TResult = unknown>(action: AgentNativeClientActionDefinition<TArgs, TResult>): AgentNativeClientAction<TArgs, TResult>;
```

Runtime seam:

```ts
export interface AgentNativeClientActionRuntime {
    requestId?: string;
    origin: string;
    context: AgentNativeHostContext;
    session: AgentNativeHostSession;
    event: MessageEvent;
    refresh(payload?: unknown): Promise<unknown>;
    command(command: string, payload?: unknown): Promise<unknown>;
}
```

What it's for: host-page/browser actions exposed live to the embedded sidecar.

### BYOA embed auth hook
- Public import: `@agent-native/core/server`
- Verified file: `dist/server/embedded.d.ts`

```ts
export type AgentNativeEmbeddedGetSession = (event: H3Event) => AgentNativeEmbeddedHostSession | null | Promise<AgentNativeEmbeddedHostSession | null>;
export interface AgentNativeEmbeddedAuthOptions extends Omit<AuthOptions, "getSession"> {
    getSession: AgentNativeEmbeddedGetSession;
}
export interface AgentNativeEmbeddedPluginOptions {
    auth?: AgentNativeEmbeddedGetSession | AgentNativeEmbeddedAuthOptions;
    actions?: AgentChatPluginOptions["actions"];
    ...
}
export declare function createAgentNativeEmbeddedPlugin(options?: AgentNativeEmbeddedPluginOptions): NitroPluginDef;
```

What it's for: host-auth/BYOA adapter when mounting the Nitro server plugin.

Important correction: I did **not** find a public exported `auth()` function in `dist/agent-native/*`. The verified BYOA seam is plugin option `auth: getSession | { getSession, ... }`.

Minimal sketch:

```ts
createAgentNativeEmbeddedPlugin({
  auth: async (event) => ({ userId, email, orgId, orgRole }),
  actions: { ... },
});
```

### `getRequestContext`
- Public import: `@agent-native/core/server/request-context` (also re-exported from `@agent-native/core/server`)
- Verified file: `dist/server/request-context.d.ts`

```ts
export declare function getRequestContext(): RequestContext | undefined;
```

Relevant request shape:

```ts
export interface RequestContext {
    userEmail?: string;
    userName?: string;
    orgId?: string;
    timezone?: string;
    authContextAccessed?: boolean;
    requestOrigin?: string;
    isIntegrationCaller?: boolean;
    integration?: {...};
    run?: RequestRunContext;
}
```

What it's for: per-request ALS state for request metadata.

### What is and is not exposed to an action

Verified exposed in `ActionRunContext`:
- `userEmail`
- `orgId`
- `caller`
- `attachments`
- `signal`
- `actionName`
- `threadId`
- `turnId`
- optional `send`

Verified **not** exposed in `ActionRunContext`:
- raw JWT / access token
- headers
- `H3Event`
- request object

Verified `RequestContext` also has no raw credential field in its declared shape.

Pilot evidence: `server/lib/deputy-store.ts` explicitly works around this with host-owned `AsyncLocalStorage` because raw caller credentials are not available at the action seam.

## 5) Native composition / compose_view parity evidence

### Native chat renderers

#### `action-ui`
- Public import: `@agent-native/core/action-ui`
- Verified file: `dist/action-ui.d.ts`

```ts
export interface ActionChatUIConfig {
    renderer: string;
    title?: string;
    description?: string;
}
```

Built-ins:

```ts
export declare const ACTION_CHAT_UI_DATA_TABLE_RENDERER = "core.data-table";
export declare const ACTION_CHAT_UI_DATA_CHART_RENDERER = "core.data-chart";
export declare const ACTION_CHAT_UI_DATA_INSIGHTS_RENDERER = "core.data-insights";
export declare const ACTION_CHAT_UI_DATA_WIDGET_RENDERER = "core.data-widget";
export declare const ACTION_CHAT_UI_INLINE_EXTENSION_RENDERER = "core.inline-extension";
```

What it's for: first-party React renderers for structured action results in chat.

#### `data-widgets`
- Public import: `@agent-native/core/data-widgets`
- Verified file: `dist/data-widgets/index.d.ts`

```ts
export interface DataTableWidget { title?: string; columns: DataTableColumn[]; rows: Array<Record<string, unknown>>; ... }
export interface DataChartWidget { type: "bar" | "line" | "area"; title?: string; xKey: string; series: DataChartSeriesDefinition[]; data: Array<Record<string, unknown>>; ... }
export type DataWidgetResult = DataTableWidgetResult | DataChartWidgetResult | DataInsightsWidgetResult;
```

What it's for: structured table/chart/insight result payloads.

### MCP app rendering

#### `McpAppRenderer`
- Public import: `@agent-native/core/client`
- Verified file: `dist/client/mcp-apps/McpAppRenderer.d.ts`

```ts
export interface McpAppRendererProps {
    app: AgentMcpAppPayload;
    className?: string;
}
export declare function McpAppRenderer({ app, className }: McpAppRendererProps): import("react").JSX.Element;
```

Underlying payload:

```ts
export interface AgentMcpAppPayload {
    serverId: string;
    toolName: string;
    originalToolName: string;
    resourceUri: string;
    toolInput: Record<string, unknown>;
    toolResult: Record<string, unknown>;
    tool?: {...};
    resource?: AgentMcpAppResourceContent;
}
```

What it's for: render MCP App results/resources, typically iframe-style UI resources.

### Editor / composer / resources surfaces

- Public import: `@agent-native/core/client/composer`

```ts
export { AgentComposerFrame, ... }
export { TiptapComposer, ... }
export { PromptComposer, ... }
```

- Public import: `@agent-native/core/client/editor`

```ts
export * from "../rich-markdown-editor/index.js";
```

- Public import: `@agent-native/core/client/resources`

```ts
export { ResourcesPanel } from "./ResourcesPanel.js";
export { ResourceTree, type ResourceTreeProps } from "./ResourceTree.js";
export { ResourceEditor, type ResourceEditorProps } from "./ResourceEditor.js";
```

- Public import: `@agent-native/core/blocks`

```ts
export { defineBlock, type BlockSpec, ... } from "./types.js";
export { BlockRegistry, registerBlocks } from "./registry.js";
export { BlockView, blockEditSurface } from "./BlockView.js";
... plus many first-party library blocks
```

What they are for: structured content editing/rendering primitives, block registries, chat composer/editor UI, and MCP app rendering.

### Parity evidence only

Evidence that agent-native has composition primitives:
- structured first-party chat renderers (`action-ui`)
- typed widget payloads (`data-widgets`)
- renderable MCP app resources (`McpAppRenderer`, `ActionMcpAppConfig.resource` via `defineAction`)
- a full block registry and editor surface (`@agent-native/core/blocks`)
- resource and editor panels

Evidence missing for direct `compose_view` replacement:
- I did **not** find a single verified public API that says “user composes arbitrary host app views from PMO entities/config and the runtime materializes a PMO route/view”.
- The verified surfaces are content/chat/resource/block/MCP-app oriented, not obviously a PMO-style view-composer contract.

Parity verdict: agent-native clearly ships rich structured UI composition primitives, but this pass did not verify a direct `compose_view`-equivalent contract. Treat as “possible building blocks exist; 1:1 parity not yet proven.”

## 6) MCP / A2A surface

### Client helpers

#### `getMcpUrl` / `getA2AUrl` / `getAgentCardUrl` / `sendMessage`
- Public import: `@agent-native/core/embedding/agent`
- Verified file: `dist/embedding/agent.d.ts`

```ts
export declare function getMcpUrl(url: string, options?: AgentEndpointOptions): string;
export declare function getA2AUrl(url: string, options?: AgentEndpointOptions): string;
export declare function getAgentCardUrl(url: string, options?: AgentEndpointOptions): string;
export declare function sendMessage(url: string, text: string, options?: SendMessageOptions): AsyncGenerator<string>;
```

What they're for: derive endpoint URLs and stream text to an A2A endpoint.

### Nitro-exposed routes

#### Core framework routes
- Public import: `@agent-native/core/server`
- Verified file: `dist/server/core-routes-plugin.d.ts`

Core prefix:

```ts
export declare const FRAMEWORK_ROUTE_PREFIX = "/_agent-native";
```

Documented mounted routes include:
- `GET /_agent-native/events`
- `GET /_agent-native/ping`
- `GET /_agent-native/health`
- `GET|PUT|DELETE /_agent-native/application-state/:key`
- `GET|PUT|DELETE /_agent-native/application-state/compose...`
- `/_agent-native/mcp/connect...`

#### MCP server mount
- Public import: `@agent-native/core/mcp`
- Verified file: `dist/mcp/server.d.ts`

```ts
export declare function mountMCP(nitroApp: any, config: MCPConfig, routePrefix?: string): void;
```

Commented endpoint:

```ts
* Endpoint: `{routePrefix}/mcp` (default `/_agent-native/mcp`)
* Auth: Bearer token matching ACCESS_TOKEN/ACCESS_TOKENS or JWT via A2A_SECRET.
```

#### A2A server mount
- Public import: `@agent-native/core/a2a`
- Verified file: `dist/a2a/server.d.ts`

```ts
export declare function mountA2A(nitroApp: any, config: A2AConfig, routePrefix?: string): void;
```

Commented endpoints:

```ts
* - GET /.well-known/agent-card.json — public agent card (no auth)
* - POST /_agent-native/a2a — JSON-RPC endpoint (with optional auth)
```

### Authentication model

#### MCP auth verification
- Public import: `@agent-native/core/mcp`
- Verified file: `dist/mcp/build-server.d.ts`

```ts
export declare function verifyAuth(authHeader: string | undefined, ownerEmailHeader?: string, options?: {
    allowDevOpen?: boolean;
    resourceUrl?: string | string[];
}): Promise<{ authed: boolean; identity?: MCPCallerIdentity; fullSurface?: boolean; ... }>;
```

`MCPCallerIdentity`:

```ts
export interface MCPCallerIdentity {
    userEmail: string | undefined;
    orgId?: string | undefined;
    orgDomain: string | undefined;
    oauthScopes?: string[];
    oauthClientId?: string;
    firstPartyMcp?: boolean;
}
```

What it's for: verify Bearer token/JWT and recover per-user/per-org identity for MCP tool execution.

#### A2A caller auth
- Public import: `@agent-native/core/a2a`
- Verified file: `dist/a2a/client.d.ts`, `dist/a2a/server.d.ts`

```ts
export declare function signA2AToken(email: string, orgDomain?: string, orgSecret?: string, options?: {...}): Promise<string>;
```

Server comment:

```ts
When A2A_SECRET is set, inbound Bearer tokens are verified as JWTs
and the caller's email is extracted from the `sub` claim.
```

### Security implication for PMO

Verified surfaces that can execute as callers and therefore must respect the deputy invariant:
- backend `defineAction`
- browser `defineClientAction`
- MCP `/_agent-native/mcp`
- A2A `/_agent-native/a2a`
- same-origin embed fetches authorized by `ensureEmbedAuthFetchInterceptor`

So the security gate must cover MCP/A2A and client actions, not only classic server read/write actions.

## Open questions / risks for implementation

1. `AgentNativeEmbedded` is verified as same-tree, but the installed public types do not expose a typed host-token object prop; PMO theming likely remains CSS-variable/class/data-theme driven.
2. `BrandKitData` is single-palette; PMO's explicit light+dark token system will need a host convention above Brand Kit.
3. `setContextToAgentChat` and `addContextToAgentChat` exist only as deprecated aliases of `setAgentChatContextItem`; prefer the non-deprecated symbol in new code.
4. Raw caller credentials are not exposed in `ActionRunContext` or `RequestContext`; PMO will need the deputy/ALS seam anywhere true caller-credential forwarding is required.
5. I did not verify a direct `compose_view`-equivalent API; only building blocks for structured/native/MCP-app UI composition are clearly present.
6. `auth()` as a named API was not found in the installed exported `.d.ts`; the verified BYOA seam is `createAgentNativeEmbeddedPlugin({ auth: getSession | { getSession } })`.

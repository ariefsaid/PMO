/**
 * OpenRouterModelClient — ModelClient implementation calling OpenRouter's
 * chat-completions API (POST /chat/completions). OpenRouter's API IS the OpenAI
 * chat-completions shape, so this transport is a near-direct pass-through.
 *
 * FR-MC-008..012, NFR-MC-SEC-004/005, NFR-MC-PERF-001 (non-streaming — MC-OD-007).
 * Pure: no Deno globals (fetch/AbortController/setTimeout are Web-standard) —
 * importable in Vitest with fetch mocked (ADR-0039 decision 7).
 */
import type { ModelClient, ModelClientParams, ModelResponse } from './modelClient.ts';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 30_000;
// AUDIT-C1 (2026-07-04 audit, Reliability C-1): bounded retry on transient upstream failures
// (network error, 429, 5xx) so a single provider blip no longer terminates the whole turn.
// NOT retried: timeouts (30s × retries would blow the edge-fn wall clock), non-429 4xx (caller
// error), malformed bodies (response already consumed). Usage stays single-recorded — only the
// final successful attempt returns a usage block to the handler.
const MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 400;

/**
 * OpenRouter `provider` routing preferences (subset we use). Controls WHICH backend serves the
 * pinned model slug — decisive for both prompt-cache economics (a stable backend keeps the shared
 * static prefix warm) and data privacy (`only` hard-restricts routing to a vetted allow-list, so the
 * agent never falls through to a host that trains on request data).
 * See docs/plans/2026-07-09-agent-model-cost-optimization.md.
 */
export interface OpenRouterProviderPolicy {
  /** Deterministic backend preference order (provider slugs). Preferred first → cache locality. */
  order?: string[];
  /** Hard allow-list — routing is RESTRICTED to these slugs (the privacy guarantee). */
  only?: string[];
  /** Deny-list — never route to these slugs. */
  ignore?: string[];
  /** Rank the remaining/eligible providers. `order` still wins for listed slugs. */
  sort?: 'throughput' | 'price' | 'latency';
  /** Allow OpenRouter to fall back to the next eligible provider on a blip (default true). */
  allow_fallbacks?: boolean;
  /** `'deny'` further restricts to providers that do NOT retain request data at all. */
  data_collection?: 'allow' | 'deny';
}

/**
 * No-train fallback order (owner decision 2026-07-10). The two green (no-RETAIN) hosts first —
 * DeepInfra, DigitalOcean — then retain-but-NOT-train hosts by jurisdiction then speed: US GMICloud,
 * then the fastest Chinese-jurisdiction hosts (Baidu, StreamLake, Alibaba), then DeepSeek-direct as
 * the last resort. `only` (below) hard-restricts routing to exactly this set so a fallback can never
 * land on a host that TRAINS on request data.
 *
 * ⚠ PROVIDER SLUGS — verify each against openrouter.ai/<model>/providers BEFORE a prod deploy:
 * a wrong slug in `only` silently drops that host from eligibility (worst case, if all are wrong,
 * routing fails). `deepinfra` / `deepseek` are the well-known canonical slugs; the others
 * (digitalocean, gmicloud, baidu, streamlake, alibaba) MUST be confirmed. All are overridable via
 * AGENT_PROVIDER_ORDER / AGENT_PROVIDER_ONLY secrets — fix a slug without a code deploy.
 */
export const NO_TRAIN_FALLBACK_ORDER: readonly string[] = [
  'deepinfra',
  'digitalocean',
  'gmicloud',
  'baidu',
  'streamlake',
  'alibaba',
  'deepseek',
];

/**
 * Default: prefer the green hosts, cascade down the vetted no-train fallback order, and `only`-
 * restrict routing to that set (never a training host). `allow_fallbacks` lets it walk the order.
 * Overridable per deploy via providerPolicyFromEnv (secrets, no code change).
 */
export const DEFAULT_PROVIDER_POLICY: OpenRouterProviderPolicy = {
  order: [...NO_TRAIN_FALLBACK_ORDER],
  only: [...NO_TRAIN_FALLBACK_ORDER],
  allow_fallbacks: true,
};

/** Parse a comma-separated slug list; undefined stays undefined, '' → [] (explicit clear). */
function parseSlugList(v: string | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Build a provider policy from edge-function env (pure — no Deno globals, so it is unit-testable).
 * Defaults are the no-train fallback tier (see DEFAULT_PROVIDER_POLICY); every knob is an escape
 * hatch so the owner can trade privacy↔latency↔cache without a code deploy:
 *   AGENT_PROVIDER_ORDER           comma slugs; '' drops the preference order.
 *   AGENT_PROVIDER_ONLY            comma slugs (hard allow-list); '' DISABLES the restriction.
 *   AGENT_PROVIDER_IGNORE          comma slugs to never route to.
 *   AGENT_PROVIDER_SORT            throughput|price|latency (rank within the allow-list).
 *   AGENT_PROVIDER_ALLOW_FALLBACKS 'false' disables fallbacks (default: enabled).
 *   AGENT_PROVIDER_DATA_COLLECTION 'deny' (green-only, no retention) | 'allow' (opt-in; default: unset).
 * The `only` safety allow-list stays ON by default (even in sort mode) unless AGENT_PROVIDER_ONLY=''.
 */
export function providerPolicyFromEnv(env: {
  AGENT_PROVIDER_ORDER?: string;
  AGENT_PROVIDER_ONLY?: string;
  AGENT_PROVIDER_IGNORE?: string;
  AGENT_PROVIDER_SORT?: string;
  AGENT_PROVIDER_ALLOW_FALLBACKS?: string;
  AGENT_PROVIDER_DATA_COLLECTION?: string;
}): OpenRouterProviderPolicy {
  const policy: OpenRouterProviderPolicy = {
    allow_fallbacks: env.AGENT_PROVIDER_ALLOW_FALLBACKS !== 'false',
  };
  const sort = env.AGENT_PROVIDER_SORT;
  if (sort === 'throughput' || sort === 'price' || sort === 'latency') policy.sort = sort;
  if (env.AGENT_PROVIDER_DATA_COLLECTION === 'deny' || env.AGENT_PROVIDER_DATA_COLLECTION === 'allow') {
    policy.data_collection = env.AGENT_PROVIDER_DATA_COLLECTION;
  }

  const order = parseSlugList(env.AGENT_PROVIDER_ORDER);
  if (order !== undefined) {
    if (order.length > 0) policy.order = order; // '' → intentionally no preference order
  } else if (policy.sort === undefined) {
    policy.order = [...NO_TRAIN_FALLBACK_ORDER]; // default preference (dropped only when sorting)
  }

  const only = parseSlugList(env.AGENT_PROVIDER_ONLY);
  if (only !== undefined) {
    if (only.length > 0) policy.only = only; // '' → explicitly disable the allow-list restriction
  } else {
    policy.only = [...NO_TRAIN_FALLBACK_ORDER]; // safety allow-list ON by default
  }

  const ignore = parseSlugList(env.AGENT_PROVIDER_IGNORE);
  if (ignore && ignore.length > 0) policy.ignore = ignore;

  return policy;
}

export interface OpenRouterModelClientOptions {
  apiKey: string;
  /** Backend routing policy (default: privacy-first no-train pin). See providerPolicyFromEnv. */
  provider?: OpenRouterProviderPolicy;
  /** Test seam — override the retry backoff base (default 400ms). */
  retryBaseDelayMs?: number;
}

interface OpenRouterChoice {
  finish_reason: string;
  message: {
    role: 'assistant';
    content: string | null;
    tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  };
}

interface OpenRouterResponseBody {
  model: string;
  choices: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
    // OpenAI-compatible detail objects OpenRouter returns on every response (Usage Accounting):
    // cached_tokens = prompt tokens served from the provider prefix cache; reasoning_tokens =
    // thinking tokens in the output. Both are subsets of their parent count; absent ⇒ unreported.
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

/**
 * Minimal shape validation for a parsed OpenRouter response's choices[0], run before
 * any field is read — a malformed/truncated upstream body must never propagate a raw
 * parse error or partial body into a thrown Error (NFR-MC-SEC-004/005).
 */
function isValidChoice(choice: unknown): choice is OpenRouterChoice {
  if (typeof choice !== 'object' || choice === null) return false;
  const c = choice as Partial<OpenRouterChoice>;
  if (typeof c.finish_reason !== 'string') return false;
  if (typeof c.message !== 'object' || c.message === null) return false;
  if (c.message.tool_calls !== undefined && !Array.isArray(c.message.tool_calls)) return false;
  return true;
}

export class OpenRouterModelClient implements ModelClient {
  private readonly apiKey: string;
  private readonly provider: OpenRouterProviderPolicy;
  private readonly retryBaseDelayMs: number;

  constructor(options: OpenRouterModelClientOptions) {
    this.apiKey = options.apiKey;
    this.provider = options.provider ?? DEFAULT_PROVIDER_POLICY;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? RETRY_BASE_DELAY_MS;
  }

  /** Exponential backoff + proportional jitter: ~400ms, ~800ms at the default base. */
  private backoff(attempt: number): Promise<void> {
    const delay = this.retryBaseDelayMs * 2 ** (attempt - 1) * (1 + Math.random() * 0.25);
    return new Promise((resolve) => setTimeout(resolve, delay));
  }

  /** One transport attempt: fetch with the 30s abort window, throwing the scrubbed errors. */
  private async attemptFetch(params: ModelClientParams): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(OPENROUTER_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: params.model,
          max_tokens: params.max_tokens,
          messages: params.messages,
          ...(params.tools ? { tools: params.tools } : {}),
          ...(params.tool_choice ? { tool_choice: params.tool_choice } : {}),
          ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
          // Backend routing policy (default: privacy-first no-train pin — DEFAULT_PROVIDER_POLICY).
          // A stable, pinned backend both keeps the shared static prefix warm (prompt-cache
          // economics) and holds the data-privacy guarantee (data_collection:'deny'); the owner can
          // re-trade privacy↔latency↔cache via AGENT_PROVIDER_* secrets (providerPolicyFromEnv).
          provider: this.provider,
          // Retained for older OpenRouter behavior; usage accounting is now returned unconditionally
          // (this flag is a no-op on current OpenRouter, harmless to keep).
          usage: { include: true },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      throw new Error(
        err instanceof Error && err.name === 'AbortError'
          ? 'OpenRouter request timed out'
          : 'OpenRouter request failed',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async create(params: ModelClientParams): Promise<ModelResponse> {
    let response!: Response;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        response = await this.attemptFetch(params);
      } catch (err) {
        // Timeouts are terminal (30s × retries would blow the fn wall clock); plain network
        // failures ('OpenRouter request failed', no status suffix) are transient.
        if (!(err instanceof Error) || err.message !== 'OpenRouter request failed') throw err;
        if (attempt === MAX_ATTEMPTS) throw err;
        await this.backoff(attempt);
        continue;
      }
      if (response.ok) break;
      const transientError = new Error(`OpenRouter request failed: ${response.status}`);
      // 429 + 5xx are transient upstream conditions; other non-2xx are terminal caller errors.
      if (response.status !== 429 && response.status < 500) throw transientError;
      if (attempt === MAX_ATTEMPTS) throw transientError;
      await this.backoff(attempt);
    }

    let body: OpenRouterResponseBody;
    try {
      body = (await response.json()) as OpenRouterResponseBody;
    } catch {
      // Never surface the raw parse error/body — it may echo back secret-looking
      // upstream content (NFR-MC-SEC-004/005).
      throw new Error('OpenRouter response malformed');
    }

    const choice = body.choices?.[0];
    if (!isValidChoice(choice)) {
      throw new Error('OpenRouter response malformed');
    }

    return {
      finish_reason: choice.finish_reason,
      message: {
        role: 'assistant',
        content: choice.message.content,
        tool_calls: choice.message.tool_calls,
      },
      usage: body.usage
        ? {
            prompt_tokens: body.usage.prompt_tokens ?? 0,
            completion_tokens: body.usage.completion_tokens ?? 0,
            total_tokens: body.usage.total_tokens ?? 0,
            ...(body.usage.cost !== undefined ? { total_cost: body.usage.cost } : {}),
            ...(body.usage.prompt_tokens_details?.cached_tokens !== undefined
              ? { cached_tokens: body.usage.prompt_tokens_details.cached_tokens }
              : {}),
            ...(body.usage.completion_tokens_details?.reasoning_tokens !== undefined
              ? { reasoning_tokens: body.usage.completion_tokens_details.reasoning_tokens }
              : {}),
          }
        : undefined,
      model: body.model,
    };
  }
}

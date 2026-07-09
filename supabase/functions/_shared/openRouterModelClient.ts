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

export interface OpenRouterModelClientOptions {
  apiKey: string;
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
  private readonly retryBaseDelayMs: number;

  constructor(options: OpenRouterModelClientOptions) {
    this.apiKey = options.apiKey;
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
          // Route to the highest-throughput provider (was pinned to DeepInfra, which added
          // ~15-30s/round latency → multi-round follow-ups blew past the ~150s edge wall-clock).
          // `sort: 'throughput'` picks the fastest provider serving the SAME pinned model;
          // allow_fallbacks keeps a single provider blip from killing the turn.
          provider: { sort: 'throughput', allow_fallbacks: true },
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

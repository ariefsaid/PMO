/**
 * OpenRouterModelClient — ModelClient implementation calling OpenRouter's
 * chat-completions API (POST /chat/completions). OpenRouter's API IS the OpenAI
 * chat-completions shape, so this transport is a near-direct pass-through.
 *
 * FR-MC-008..012, NFR-MC-SEC-004/005, NFR-MC-PERF-001 (non-streaming — MC-OD-007).
 * Pure: no Deno globals (fetch/AbortController/setTimeout are Web-standard) —
 * importable in Vitest with fetch mocked (ADR-0039 decision 7).
 */
import type { ModelClient, ModelClientParams, ModelResponse } from './modelClient';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const REQUEST_TIMEOUT_MS = 30_000;

export interface OpenRouterModelClientOptions {
  apiKey: string;
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
  };
}

export class OpenRouterModelClient implements ModelClient {
  private readonly apiKey: string;

  constructor(options: OpenRouterModelClientOptions) {
    this.apiKey = options.apiKey;
  }

  async create(params: ModelClientParams): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
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
          provider: { order: ['DeepInfra'], allow_fallbacks: true },
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

    if (!response.ok) {
      throw new Error(`OpenRouter request failed: ${response.status}`);
    }

    const body = (await response.json()) as OpenRouterResponseBody;
    const choice = body.choices[0];

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
          }
        : undefined,
      model: body.model,
    };
  }
}

/**
 * ModelClient — vendor-neutral port for the agent-chat / compose-view model call.
 * Shaped as OpenAI chat-completions (the shape OpenRouter and most non-Anthropic
 * providers speak natively — spec agent-model-client.spec.md §1 "Why this shape").
 *
 * Pure types only — no runtime values, no Deno globals. Importable in Vitest.
 * FR-MC-001, FR-MC-002.
 */

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ModelToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ModelToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ModelTool {
  type: 'function';
  function: { name: string; description: string; parameters: object };
}

export interface ModelClientParams {
  model: string;
  max_tokens: number;
  messages: ModelMessage[];
  tools?: ModelTool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  stream?: boolean;
  /** Sampling temperature (0–2). Lower = more deterministic tool routing, fewer thrash rounds. */
  temperature?: number;
}

export interface ModelUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost?: number;
  /** Prompt tokens served from the provider prefix cache (subset of prompt_tokens). Absent ⇒ unreported. */
  cached_tokens?: number;
  /** Reasoning/thinking tokens in the output (subset of completion_tokens). Absent ⇒ unreported. */
  reasoning_tokens?: number;
}

export interface ModelResponse {
  finish_reason: string;
  message: { role: 'assistant'; content: string | null; tool_calls?: ModelToolCall[] };
  usage?: ModelUsage;
  model: string;
}

export interface ModelClient {
  create(params: ModelClientParams): Promise<ModelResponse>;
}

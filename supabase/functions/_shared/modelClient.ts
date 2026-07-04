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
}

export interface ModelUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  total_cost?: number;
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

/**
 * agent-chat request limits. The handler is stateless (D8): every POST carries the whole conversation,
 * so these bound what one request can make the function buffer and forward to the model.
 *
 * What a real conversation contains (pmoNativeRuntime.ts): the user turn typed now in the composer
 * (capped at 2000 characters); earlier user turns from the same or an adopted thread, which may include
 * an automation prompt (up to 4000 characters, the agent_automations_prompt_len CHECK in migration 0059,
 * mirrored in actions.ts); assistant answer text (each model call is capped at max_tokens 2048, roughly
 * 8,000 characters); small tool_use blocks the client rebuilds for approvals and questions; an ask-user
 * answer; and attachment ids. Tool results are never resent by the client; attachments travel as ids,
 * never bytes.
 */

import {
  AGENT_ATTACHMENTS_PER_MESSAGE_MAX,
  AGENT_MESSAGE_MAX_CHARS,
} from '../../../pmo-portal/src/lib/agent/runtime/transport.ts';

/**
 * Request-body cap, enforced on the stream (readBodyBounded) so it holds without a Content-Length.
 * The transcript budget below is the effective ceiling (200,000 characters is at most ~800 KB of
 * UTF-8 for typical text); 1 MiB leaves room for JSON framing and multi-byte characters on top.
 */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/**
 * Messages per transcript. The client appends one assistant message per assistant event, so a
 * tool-heavy turn can add about ten (text plus rebuilt tool_use blocks); 1000 leaves room for long
 * conversations while the character budget below is what normally binds.
 */
export const MAX_TRANSCRIPT_MESSAGES = 1000;

/**
 * Characters (UTF-16 code units, as the browser counts them) in this turn's user message, the last user
 * message in the transcript: the composer's limit. Also the limit for an ask-user free-text answer.
 */
export const MAX_USER_MESSAGE_CHARS = AGENT_MESSAGE_MAX_CHARS;

/** Characters in each earlier user message: the 4000-character automation prompt limit (migration 0059). */
export const MAX_EARLIER_USER_MESSAGE_CHARS = 4000;

/** Attachment ids per message: the composer refuses an eleventh file (Composer.tsx). */
export const MAX_ATTACHMENTS_PER_MESSAGE = AGENT_ATTACHMENTS_PER_MESSAGE_MAX;

/**
 * Characters across the whole transcript. At the repo's ~4 characters/token estimate
 * (transcriptCompaction.ts) this is ~50k tokens, which leaves room inside the model's context window
 * for the system prompt, tool schemas and the tool results added during the turn. A conversation past
 * it is answered 413 and the client asks the user to start a new one.
 */
export const MAX_TRANSCRIPT_CHARS = 200_000;

export type TranscriptCheck =
  | { ok: true }
  | { ok: false; status: 400 | 413; error: 'BAD_REQUEST' | 'PAYLOAD_TOO_LARGE'; detail: string };

const badShape = (detail: string): TranscriptCheck => ({ ok: false, status: 400, error: 'BAD_REQUEST', detail });
const tooLarge = (detail: string): TranscriptCheck => ({ ok: false, status: 413, error: 'PAYLOAD_TOO_LARGE', detail });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Text a user typed: the string itself, or the `text` of its text blocks. */
function userText(content: string | Record<string, unknown>[]): number {
  if (typeof content === 'string') return content.length;
  let total = 0;
  for (const block of content) {
    if (block.type === 'text' && typeof block.text === 'string') total += block.text.length;
  }
  return total;
}

/** Characters a message contributes to the transcript: its text, or each block's serialized length. */
function messageChars(content: string | Record<string, unknown>[]): number {
  if (typeof content === 'string') return content.length;
  let total = 0;
  for (const block of content) total += JSON.stringify(block).length;
  return total;
}

/**
 * Validate the parsed request body before anything reads it (400 for a bad shape, 413 over a limit):
 * - `messages`: an array of { role: 'user' | 'assistant', content: string | object[] }, at most
 *   MAX_TRANSCRIPT_MESSAGES; the last user message within MAX_USER_MESSAGE_CHARS, earlier ones within
 *   MAX_EARLIER_USER_MESSAGE_CHARS;
 * - `answer.freeText`, when present: a string within MAX_USER_MESSAGE_CHARS;
 * - `attachmentIds`, when present: an array of at most MAX_ATTACHMENTS_PER_MESSAGE strings;
 * - messages plus answer text within MAX_TRANSCRIPT_CHARS.
 */
export function checkAgentChatRequest(body: unknown): TranscriptCheck {
  if (!isObject(body) || !Array.isArray(body.messages)) return badShape('invalid JSON body');
  const messages: unknown[] = body.messages;
  if (messages.length > MAX_TRANSCRIPT_MESSAGES) return tooLarge('conversation too long');

  const attachmentIds = body.attachmentIds;
  if (attachmentIds !== undefined) {
    const validIds = Array.isArray(attachmentIds) && attachmentIds.every((id) => typeof id === 'string');
    if (!validIds || attachmentIds.length > MAX_ATTACHMENTS_PER_MESSAGE) return badShape('invalid attachmentIds');
  }

  let totalChars = 0;
  const answer = body.answer;
  if (answer !== undefined) {
    if (!isObject(answer)) return badShape('invalid answer');
    if (answer.freeText !== undefined) {
      if (typeof answer.freeText !== 'string') return badShape('invalid answer');
      if (answer.freeText.length > MAX_USER_MESSAGE_CHARS) return tooLarge('answer too long');
      totalChars += answer.freeText.length;
    }
  }

  let lastUser = -1;
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (!isObject(message) || (message.role !== 'user' && message.role !== 'assistant')) {
      return badShape('invalid message');
    }
    const content = message.content;
    const validContent = typeof content === 'string' || (Array.isArray(content) && content.every(isObject));
    if (!validContent) return badShape('invalid message');
    if (message.role === 'user') lastUser = i;
  }

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i] as { role: string; content: string | Record<string, unknown>[] };
    if (message.role === 'user') {
      const limit = i === lastUser ? MAX_USER_MESSAGE_CHARS : MAX_EARLIER_USER_MESSAGE_CHARS;
      if (userText(message.content) > limit) return tooLarge('message too long');
    }
    totalChars += messageChars(message.content);
    if (totalChars > MAX_TRANSCRIPT_CHARS) return tooLarge('conversation too long');
  }
  return { ok: true };
}

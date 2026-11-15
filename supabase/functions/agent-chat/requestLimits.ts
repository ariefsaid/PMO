/**
 * agent-chat request limits. The handler is stateless (D8): every POST carries the whole conversation,
 * so these bound what one request can make the function buffer and forward to the model.
 *
 * What a real conversation contains (pmoNativeRuntime.ts): user turns typed in the composer (capped at
 * 2000 characters), assistant answer text (each model call is capped at max_tokens 2048, roughly 8,000
 * characters), and small tool_use blocks the client rebuilds for approvals and questions. Tool results
 * are never resent by the client; attachments travel as ids, never bytes.
 */

/**
 * Request-body cap, enforced on the stream (readBodyBounded) so it holds without a Content-Length.
 * The transcript budget below is the effective ceiling (200,000 characters is at most ~800 KB of
 * UTF-8 for typical text); 1 MiB leaves room for JSON framing and multi-byte characters on top.
 */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024;

/** Messages per transcript: 200 user/assistant turn pairs, far past where the character budget binds. */
export const MAX_TRANSCRIPT_MESSAGES = 400;

/** Characters (UTF-16 code units, as the browser counts them) per user message: the composer's limit. */
export const MAX_USER_MESSAGE_CHARS = 2000;

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
 * Validate the parsed request body before anything reads it: a non-null object whose `messages` is
 * an array of { role: 'user' | 'assistant', content: string | object[] } (400 otherwise), within the
 * message-count, per-user-message and total-character limits above (413 otherwise).
 */
export function checkAgentChatRequest(body: unknown): TranscriptCheck {
  if (!isObject(body) || !Array.isArray(body.messages)) return badShape('invalid JSON body');
  const messages: unknown[] = body.messages;
  if (messages.length > MAX_TRANSCRIPT_MESSAGES) return tooLarge('conversation too long');
  let totalChars = 0;
  for (const message of messages) {
    if (!isObject(message) || (message.role !== 'user' && message.role !== 'assistant')) {
      return badShape('invalid message');
    }
    const content = message.content;
    const validContent = typeof content === 'string' || (Array.isArray(content) && content.every(isObject));
    if (!validContent) return badShape('invalid message');
    const typed = content as string | Record<string, unknown>[];
    if (message.role === 'user' && userText(typed) > MAX_USER_MESSAGE_CHARS) return tooLarge('message too long');
    totalChars += messageChars(typed);
    if (totalChars > MAX_TRANSCRIPT_CHARS) return tooLarge('conversation too long');
  }
  return { ok: true };
}

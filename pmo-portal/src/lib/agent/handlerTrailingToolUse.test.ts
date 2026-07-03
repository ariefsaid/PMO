/**
 * Tests for the shared findTrailingUnresolvedToolUse helper (review-remediation item 1:
 * dedupe findTrailingQuestion/findTrailingConfirmToolUse into one generalized finder
 * taking a `matchToolUse` predicate; both call sites pass theirs).
 *
 * [REC-1]: handler unit tests live under pmo-portal/src/lib/agent/*.test.ts, importing
 * the handler via relative path.
 */
import { it, expect } from 'vitest';
import { findTrailingUnresolvedToolUse } from '../../../../supabase/functions/agent-chat/handler';
import type { ConversationMessage } from './runtime/transport';

it('returns the trailing unresolved tool_use block matching the predicate', () => {
  const messages: ConversationMessage[] = [
    { role: 'user', content: 'hello' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'ask_user', input: { prompt: 'Which?' } }],
    },
  ];

  const result = findTrailingUnresolvedToolUse(messages, (b) => b.name === 'ask_user');

  expect(result).toEqual({ toolId: 't1', toolName: 'ask_user', toolInput: { prompt: 'Which?' } });
});

it('returns null when the trailing tool_use is already resolved by a subsequent tool_result', () => {
  const messages: ConversationMessage[] = [
    { role: 'user', content: 'hello' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 't1', name: 'ask_user', input: {} }],
    },
    {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 't1', content: 'answered' }],
    },
  ];

  const result = findTrailingUnresolvedToolUse(messages, (b) => b.name === 'ask_user');

  expect(result).toBeNull();
});

it('returns null when no assistant message matches the predicate', () => {
  const messages: ConversationMessage[] = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'just text, no tool_use' },
  ];

  const result = findTrailingUnresolvedToolUse(messages, (b) => b.name === 'ask_user');

  expect(result).toBeNull();
});

it('the predicate can select a different tool family (e.g. confirm actions)', () => {
  const messages: ConversationMessage[] = [
    {
      role: 'assistant',
      content: [
        { type: 'tool_use', id: 't1', name: 'ask_user', input: {} },
        { type: 'tool_use', id: 't2', name: 'create_activity', input: { note: 'x' } },
      ],
    },
  ];

  const result = findTrailingUnresolvedToolUse(messages, (b) => b.name === 'create_activity');

  expect(result).toEqual({ toolId: 't2', toolName: 'create_activity', toolInput: { note: 'x' } });
});

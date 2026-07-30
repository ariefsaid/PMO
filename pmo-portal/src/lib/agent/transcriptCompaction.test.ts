/**
 * Unit tests for transcriptCompaction — the agent transcript token-budget compactor.
 * Edge-fn module imported cross-boundary (test-location convention; see openRouterModelClient.test.ts).
 */
import { it, expect, describe } from 'vitest';
import type { ModelMessage } from '../../../../supabase/functions/_shared/modelClient';
import {
  compactTranscript,
  compactionOptionsFromEnv,
  estimateTranscriptChars,
  DEFAULT_COMPACTION,
} from '../../../../supabase/functions/_shared/transcriptCompaction';

/** A long tool-result body (raw rows) — the thing compaction targets. */
const bigRows = (n: number) => JSON.stringify(Array.from({ length: n }, (i) => ({ id: i, status: 'Ongoing Project', value: 123456 })));

function toolMsg(content: string, id: string): ModelMessage {
  return { role: 'tool', tool_call_id: id, name: 'query_entity', content };
}

describe('estimateTranscriptChars', () => {
  it('sums content + serialized tool_calls', () => {
    const msgs: ModelMessage[] = [
      { role: 'system', content: 'abc' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'query_entity', arguments: '{"entity":"projects"}' } }] },
    ];
    // 'abc' (3) + JSON.stringify(tool_calls).length (>0)
    expect(estimateTranscriptChars(msgs)).toBeGreaterThan(3);
  });
});

describe('compactTranscript', () => {
  it('is a no-op when the transcript is under the trigger budget', () => {
    const msgs: ModelMessage[] = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'hi' },
      toolMsg(bigRows(3), 'c1'),
    ];
    const out = compactTranscript(msgs, { triggerChars: 100_000, recentMessages: 2, maxToolResultChars: 50 });
    expect(out).toBe(msgs); // same reference — untouched
  });

  it('AC-RQL-003: a representative single analytical turn stays uncompacted under the new defaults', () => {
    // The prod regression: an 8-read cross-entity turn (~50k chars) tripped the OLD 24k trigger
    // MID-TURN, compacting the very rows the model needed to synthesize → re-query loop → step limit.
    // Guard the PRIMARY fix (triggerChars 24k→80k): a normal analytical turn must survive intact.
    const read = (id: string): ModelMessage[] => [
      { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'query_entity', arguments: '{}' } }] },
      toolMsg(bigRows(200), id), // ~10k chars of raw rows per read
    ];
    const msgs: ModelMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'which of my projects are behind schedule?' },
      ...read('projects'), ...read('milestones'), ...read('tasks'), ...read('tasks2'), ...read('projects2'),
    ];
    const size = estimateTranscriptChars(msgs);
    // Big enough that the OLD 24k default WOULD have compacted mid-turn (the regression)…
    expect(size).toBeGreaterThan(24_000);
    // …but under the new trigger, so the turn's rows survive for synthesis.
    expect(size).toBeLessThan(DEFAULT_COMPACTION.triggerChars);
    const out = compactTranscript(msgs, DEFAULT_COMPACTION);
    expect(out).toBe(msgs); // untouched — nothing compacted
  });

  it('AC-RQL-001 compacts an OLD oversized tool result (no re-run wording) but keeps the recency window verbatim', () => {
    const old = toolMsg(bigRows(200), 'old'); // large, old
    const recent = toolMsg(bigRows(200), 'recent'); // large, but within recency window
    const msgs: ModelMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: 'question' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'old', type: 'function', function: { name: 'query_entity', arguments: '{}' } }] },
      old,
      { role: 'assistant', content: 'here is a summary' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'recent', type: 'function', function: { name: 'query_entity', arguments: '{}' } }] },
      recent,
    ];
    const out = compactTranscript(msgs, { triggerChars: 100, recentMessages: 2, maxToolResultChars: 200 });

    // System prompt untouched (cache locality).
    expect(out[0]).toBe(msgs[0]);
    // The OLD tool result body is replaced with a valid-JSON marker; tool_call_id preserved.
    const compacted = out[3];
    expect(compacted.tool_call_id).toBe('old');
    expect(compacted.role).toBe('tool');
    const parsed = JSON.parse(compacted.content as string);
    expect(parsed._compacted).toBe(true);
    expect(parsed.chars_omitted).toBe((old.content as string).length);
    // FR-RQL-001: the marker must NOT invite re-running the tool (the old "Re-run the tool if you
    // still need this data" drove the prod step-limit re-query loop). It states the data was already
    // retrieved and explicitly prohibits re-calling.
    expect(parsed.note).not.toMatch(/re-?run the tool/i);
    expect(parsed.note).toMatch(/already retrieved/i);
    expect(parsed.note).toMatch(/do not call the tool again/i);
    // FR-RQL-002: provenance retained so the model references it rather than re-querying.
    expect(parsed.tool).toBe('query_entity');
    // The RECENT tool result (within the last 2 messages) is kept verbatim.
    expect(out[6]).toBe(recent);
    // User/assistant text preserved.
    expect(out[1]).toBe(msgs[1]);
    expect(out[4]).toBe(msgs[4]);
  });

  it('AC-RQL-002 retains rowCount + tool name from a query_entity result body in the marker', () => {
    // Realistic query_entity result shape: { rowCount, rows: [...] }.
    const body = JSON.stringify({ rowCount: 17, rows: Array.from({ length: 17 }, (_v, i) => ({ id: i, name: `P${i}`, status: 'Ongoing Project', end_date: '2026-06-30' })) });
    const msgs: ModelMessage[] = [
      { role: 'system', content: 'system prompt' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'q', type: 'function', function: { name: 'query_entity', arguments: '{"entity":"projects"}' } }] },
      { role: 'tool', tool_call_id: 'q', name: 'query_entity', content: body },
      { role: 'user', content: 'a' },
      { role: 'user', content: 'b' },
    ];
    const out = compactTranscript(msgs, { triggerChars: 100, recentMessages: 2, maxToolResultChars: 100 });
    const parsed = JSON.parse(out[2].content as string);
    expect(parsed._compacted).toBe(true);
    expect(parsed.rowCount).toBe(17);
    expect(parsed.tool).toBe('query_entity');
  });

  it('never removes messages or changes tool_call_ids (API pairing invariant)', () => {
    const msgs: ModelMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'query_entity', arguments: '{}' } }] },
      toolMsg(bigRows(300), 'a'),
      { role: 'assistant', content: null, tool_calls: [{ id: 'b', type: 'function', function: { name: 'query_entity', arguments: '{}' } }] },
      toolMsg(bigRows(300), 'b'),
      { role: 'user', content: 'more' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'query_entity', arguments: '{}' } }] },
      toolMsg(bigRows(300), 'c'),
    ];
    const out = compactTranscript(msgs, { triggerChars: 100, recentMessages: 2, maxToolResultChars: 100 });
    expect(out.length).toBe(msgs.length);
    // Every assistant tool_call still has a matching tool result with the same id.
    const toolIds = out.filter((m) => m.role === 'tool').map((m) => m.tool_call_id);
    expect(toolIds).toEqual(['a', 'b', 'c']);
  });

  it('leaves an old tool result under maxToolResultChars alone', () => {
    const smallOld = toolMsg('{"rowCount":3}', 'old');
    const msgs: ModelMessage[] = [
      { role: 'system', content: 'x'.repeat(30_000) }, // pushes over trigger without a big tool body
      smallOld,
      { role: 'user', content: 'hi' },
      { role: 'user', content: 'bye' },
    ];
    const out = compactTranscript(msgs, { triggerChars: 100, recentMessages: 2, maxToolResultChars: 800 });
    // smallOld is old (index 1 < cutoff 2) but under the size threshold → untouched.
    expect(out[1]).toBe(smallOld);
  });
});

describe('compactionOptionsFromEnv', () => {
  it('defaults to DEFAULT_COMPACTION when unset', () => {
    expect(compactionOptionsFromEnv({})).toEqual(DEFAULT_COMPACTION);
  });

  it('parses integer overrides', () => {
    expect(
      compactionOptionsFromEnv({
        AGENT_COMPACTION_TRIGGER_CHARS: '40000',
        AGENT_COMPACTION_RECENT_MESSAGES: '8',
        AGENT_COMPACTION_MAX_TOOL_CHARS: '500',
      }),
    ).toEqual({ triggerChars: 40_000, recentMessages: 8, maxToolResultChars: 500 });
  });

  it('TRIGGER_CHARS=0 disables compaction (effectively-infinite trigger)', () => {
    const opts = compactionOptionsFromEnv({ AGENT_COMPACTION_TRIGGER_CHARS: '0' });
    expect(opts.triggerChars).toBe(Number.MAX_SAFE_INTEGER);
    // And compactTranscript is then a no-op even on a huge transcript.
    const msgs: ModelMessage[] = [
      { role: 'system', content: 'sys' },
      toolMsg(bigRows(500), 'x'),
      { role: 'user', content: 'hi' },
    ];
    expect(compactTranscript(msgs, opts)).toBe(msgs);
  });

  it('ignores non-integer / negative values and falls back to defaults', () => {
    expect(
      compactionOptionsFromEnv({
        AGENT_COMPACTION_TRIGGER_CHARS: 'abc',
        AGENT_COMPACTION_RECENT_MESSAGES: '-2',
        AGENT_COMPACTION_MAX_TOOL_CHARS: '1.5',
      }),
    ).toEqual(DEFAULT_COMPACTION);
  });
});

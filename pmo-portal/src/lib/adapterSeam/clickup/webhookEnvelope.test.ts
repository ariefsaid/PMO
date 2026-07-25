/**
 * `parseWebhookEnvelope` — proves the ingress parser against the REAL captured ClickUp webhook
 * fixtures (2026-07-20 live-verified, `supabase/functions/_shared/testing/fixtures/clickup-webhook/`):
 * every one of the 7 real deliveries carries `{event, task_id, team_id, webhook_id, history_items}` and
 * NEVER a `task` object, `date_updated`, or `list_id`. This is the oracle for the bug this slice fixes —
 * `ClickUpWebhookPayload` used to assume a shape ClickUp never sends.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWebhookEnvelope } from './types.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = resolve(__dirname, '../../../../../supabase/functions/_shared/testing/fixtures/clickup-webhook');

function loadFixture(fileName: string): unknown {
  const raw = JSON.parse(readFileSync(resolve(FIXTURES_DIR, fileName), 'utf8')) as { payload: unknown };
  return raw.payload;
}

const FIXTURE_FILES = readdirSync(FIXTURES_DIR)
  .filter((f) => /^\d+-.*\.json$/.test(f))
  .sort();

describe('parseWebhookEnvelope — the 7 real captured ClickUp deliveries', () => {
  it('found all 7 captured fixture files (the fixture set itself did not silently shrink)', () => {
    expect(FIXTURE_FILES).toHaveLength(7);
  });

  it.each(FIXTURE_FILES)('parses %s WITHOUT ever needing a `task` object off the payload', (fileName) => {
    const payload = loadFixture(fileName) as Record<string, unknown>;
    // The real envelope never carries these — assert the FIXTURE itself proves the bug (guards
    // against a future fixture accidentally drifting back to the old assumed shape).
    expect(payload.task).toBeUndefined();
    expect(payload.date_updated).toBeUndefined();
    expect(payload.list_id).toBeUndefined();

    const parsed = parseWebhookEnvelope(payload);
    expect(parsed).not.toBeNull();
    expect(parsed!.event).toBe(payload.event);
    expect(parsed!.task_id).toBe(payload.task_id);
    expect(parsed!.team_id).toBe(payload.team_id);
    expect(Array.isArray(parsed!.history_items)).toBe(true);
  });

  it('the taskDeleted fixture carries EMPTY history_items (no state at all)', () => {
    const payload = loadFixture('06-taskDeleted.json');
    const parsed = parseWebhookEnvelope(payload);
    expect(parsed!.event).toBe('taskDeleted');
    expect(parsed!.history_items).toEqual([]);
  });

  it('the archived fixture carries a history_items entry with field "archived"', () => {
    const payload = loadFixture('05-taskUpdated.json');
    const parsed = parseWebhookEnvelope(payload);
    expect(parsed!.history_items.some((h) => h.field === 'archived')).toBe(true);
  });

  it('rejects a body with no `event`', () => {
    expect(parseWebhookEnvelope({ task_id: 'x', history_items: [] })).toBeNull();
  });

  it('rejects a body with an unknown `event` verb', () => {
    expect(parseWebhookEnvelope({ event: 'somethingElse', task_id: 'x', history_items: [] })).toBeNull();
  });

  it('rejects a body with no `task_id`', () => {
    expect(parseWebhookEnvelope({ event: 'taskCreated', history_items: [] })).toBeNull();
  });

  it('rejects a non-object body', () => {
    expect(parseWebhookEnvelope(null)).toBeNull();
    expect(parseWebhookEnvelope('a string')).toBeNull();
  });

  it('defaults history_items to [] when absent/malformed', () => {
    const parsed = parseWebhookEnvelope({ event: 'taskCreated', task_id: 'cu-1' });
    expect(parsed!.history_items).toEqual([]);
    const parsed2 = parseWebhookEnvelope({ event: 'taskCreated', task_id: 'cu-1', history_items: 'not-an-array' });
    expect(parsed2!.history_items).toEqual([]);
  });
});

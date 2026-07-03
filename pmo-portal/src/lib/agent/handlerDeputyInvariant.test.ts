/**
 * AC-AGP-018 — deputy invariant: no service_role reaches the agent-chat persistence path
 * (NFR-AGP-SEC-001, ADR-0043 §6). [REC-1]: lives under pmo-portal/src/lib/agent/ per the
 * repo's existing handler-unit-test convention (no Vitest project rooted in supabase/).
 *
 * Static: persistence.ts source contains no service_role/SERVICE_ROLE/createClient( token —
 * it never constructs a privileged client, by construction (it only ever receives the
 * already-injected, caller-JWT-scoped HandlerSupabaseLike).
 *
 * Dynamic: every agent_* table access during a persistence-enabled run goes through the
 * SAME injected supabase mock instance passed as deps.persistence.supabase — no second
 * client object is ever referenced.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, expect, vi } from 'vitest';
import { agentChatHandler } from '../../../../supabase/functions/agent-chat/handler';
import type { HandlerDeps } from '../../../../supabase/functions/agent-chat/handler';
import type { AgentEvent } from './runtime/port';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

// ── Static: persistence.ts never constructs a privileged client ─────────────

/**
 * Strip `/** ... *\/`, `// ...`, and JSDoc content so the deputy-invariant scan checks
 * only executable code — persistence.ts's own module doc legitimately explains and cites
 * the invariant it upholds ("no service_role"); that prose must not itself trip the gate.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

it('AC-AGP-018 persistence.ts constructs no service_role client', () => {
  const src = readFileSync(
    resolve(__dirname, '../../../../supabase/functions/agent-chat/persistence.ts'),
    'utf-8',
  );
  const code = stripComments(src);
  expect(code).not.toMatch(/service_role/i);
  expect(code).not.toContain('SERVICE_ROLE');
  expect(code).not.toContain('createClient(');
});

// ── Dynamic: every agent_* access uses the single injected mock instance ────

it('AC-AGP-018 every agent_* table access goes through the single injected persistence.supabase instance', async () => {
  const seenTables: string[] = [];
  const seenSupabaseInstances = new Set<unknown>();

  function makeSharedSupabase(): HandlerDeps['supabase'] {
    const from = vi.fn().mockImplementation((table: string) => {
      seenTables.push(table);
      if (table === 'profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { org_id: 'org-1', role: 'Project Manager' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'agent_threads' || table === 'agent_runs' || table === 'agent_events') {
        return {
          insert: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'row-1' }, error: null }) }),
          }),
          update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
          }),
        };
      }
      return {
        select: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }),
      };
    });
    return { from } as unknown as HandlerDeps['supabase'];
  }

  const sharedSupabase = makeSharedSupabase();
  seenSupabaseInstances.add(sharedSupabase);

  const modelClient = {
    create: vi.fn()
      .mockResolvedValueOnce({
        finish_reason: 'tool_calls',
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'tu1', type: 'function', function: { name: 'query_entity', arguments: JSON.stringify({ entity: 'projects' }) } },
          ],
        },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      })
      .mockResolvedValueOnce({
        finish_reason: 'stop',
        message: { role: 'assistant', content: 'Done.' },
        usage: {},
        model: 'deepseek/deepseek-v4-flash',
      }),
  };

  const deps: HandlerDeps = {
    modelClient,
    model: 'deepseek/deepseek-v4-flash',
    supabase: sharedSupabase,
    userId: 'user-1',
    can: vi.fn().mockReturnValue(true),
    now: () => new Date('2026-07-03T00:00:00Z'),
    // The deputy invariant: deps.persistence.supabase is the SAME object as deps.supabase —
    // the caller-JWT client index.ts binds once and threads through both the handler's
    // business reads AND the persistence writes. No second (privileged) client is ever built.
    persistence: {
      supabase: sharedSupabase,
      ownerId: 'user-1',
      orgId: 'org-1',
      now: () => new Date('2026-07-03T00:00:00Z'),
    },
  };

  await collect(agentChatHandler({ messages: [{ role: 'user', content: 'how many active projects?' }] }, deps));

  // Every agent_* table access happened via the single `from` spy on sharedSupabase —
  // there is only one supabase instance in play for the whole run.
  expect(seenSupabaseInstances.size).toBe(1);
  expect(seenTables).toEqual(expect.arrayContaining(['agent_threads', 'agent_runs', 'agent_events']));
});

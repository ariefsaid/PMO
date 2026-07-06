/**
 * Agent eval-harness runner — drives one case through the DEPLOYED agent-chat loop,
 * collects the SSE stream into an `EvalRunResult`, and emits a Vitest `describe`/`it`
 * per case so Vitest's runner + reporter + exit code are reused directly (DEC-3).
 *
 * ADR-0052 + `docs/plans/2026-07-05-agent-eval-harness.md` (Track V, V1+V4).
 *
 * Auth = a real **test user** (the deputy path, NEVER `service_role` — DEC-6,
 * NFR-AT2-SEC-005). The harness POSTs to `${EVAL_AGENT_CHAT_URL}` with the test-user
 * JWT, parses the SSE body via the SAME `decodeSseStream` the browser uses
 * (transport.ts — reused, so a wire-format change is caught here for free), and folds
 * the assistant chunks the same way the panel does.
 *
 * Secrets discipline (env-file-privacy): every credential is read from process env
 * ONLY — never from `.env`/`op.*.env` files. If any REQUIRED env var is missing, the
 * case SKIPS gracefully (never a red on a missing secret — NFR-AT2-SEC-005).
 *
 * This module is plain TS with NO Deno globals — it is imported by `*.eval.ts` case
 * files which run ONLY in the dedicated eval project (`vitest.eval.config.ts`); it is
 * excluded from the default Vitest suite + `verify` (FR-AT2-EV-006).
 */
import { describe, it, expect } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { decodeSseStream } from '../../src/lib/agent/runtime/transport';
import type { AgentEvent, RunContext } from '../../src/lib/agent/runtime/port';
import {
  type EvalRunResult,
  type Scorer,
  runScorers,
} from './scorers';

/** One eval case: a natural-language prompt + composable scorers. FR-AT2-EV-001. */
export interface EvalCase {
  name: string;
  prompt: string;
  /** Optional grounding context — the SAME `RunContext` the browser sends. */
  context?: RunContext;
  expect: Scorer[];
}

/** A named suite of cases. */
export interface EvalSuite {
  name: string;
  cases: EvalCase[];
}

/**
 * Identity helper — tags a literal as an `EvalSuite` for the case file to
 * `export default runEvalSuite(defineEvalSuite({ ... }))`. DEC-3.
 */
export function defineEvalSuite(suite: EvalSuite): EvalSuite {
  return suite;
}

// ── env contract (single source of truth shared with the GH workflow) ─────────
// Names ONLY — never read from a file; values come from process env / GH secrets.
const ENV = {
  agentChatUrl: 'EVAL_AGENT_CHAT_URL',
  testUserEmail: 'EVAL_TEST_USER_EMAIL',
  testUserPassword: 'EVAL_TEST_USER_PASSWORD',
  supabaseUrl: 'VITE_SUPABASE_URL',
  supabaseAnonKey: 'VITE_SUPABASE_ANON_KEY',
} as const;

function requiredEnv(missing: string[]): boolean {
  return missing.length === 0;
}

/** Surface which required env vars are missing (names only — never values). */
function missingEnvVars(): string[] {
  return Object.values(ENV).filter((name) => !process.env[name]);
}

/**
 * Authenticate as the test user via Supabase `signInWithPassword` → the caller JWT.
 * The EXACT deputy path a browser uses (DEC-6); NEVER `service_role`.
 */
async function signInTestUser(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.auth.signInWithPassword({
    email: process.env[ENV.testUserEmail]!,
    password: process.env[ENV.testUserPassword]!,
  });
  if (error || !data.session?.access_token) {
    throw new Error(
      `test-user sign-in failed: ${error?.message ?? 'no session'} (check EVAL_TEST_USER_* env)`,
    );
  }
  return data.session.access_token;
}

/**
 * Drive one case through the deployed loop and collect the SSE stream into an
 * `EvalRunResult`. V4 — AC-AT2-015 loop half, FR-AT2-EV-001/003, DEC-1/DEC-6.
 *
 * `tool` events → `toolCalls`; `assistant` chunks → merged `answerText` (the same
 * concat fold the panel uses); all events retained for richer scorers.
 */
export async function runEvalCase(c: EvalCase): Promise<EvalRunResult> {
  const missing = missingEnvVars();
  if (!requiredEnv(missing)) {
    throw new Error(
      `eval env missing required vars (names): ${missing.join(', ')} — case cannot run`,
    );
  }

  // Build the caller-JWT client (deputy path — NEVER service_role).
  const client = createClient(
    process.env[ENV.supabaseUrl]!,
    process.env[ENV.supabaseAnonKey]!,
  );
  const jwt = await signInTestUser(client);

  // POST to the deployed agent-chat function with the test-user JWT.
  const res = await fetch(process.env[ENV.agentChatUrl]!, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [{ role: 'user', content: c.prompt }],
      ...(c.context ? { context: c.context } : {}),
    }),
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '<no body>');
    throw new Error(
      `agent-chat HTTP ${res.status}: ${truncate(detail, 300)}`,
    );
  }

  // Decode the SSE stream (reused transport codec) and fold into the run result.
  const toolCalls: EvalRunResult['toolCalls'] = [];
  const answerChunks: string[] = [];
  const events: AgentEvent[] = [];

  for await (const ev of decodeSseStream(res.body.getReader())) {
    events.push(ev);
    if (ev.type === 'tool') {
      const p = (ev.payload ?? {}) as { name?: string; input?: unknown; result?: unknown };
      if (p.name) toolCalls.push({ name: p.name, input: p.input, result: p.result });
    } else if (ev.type === 'assistant' && typeof ev.text === 'string') {
      answerChunks.push(ev.text);
    }
  }

  return { toolCalls, answerText: answerChunks.join('').trim(), events };
}

/**
 * Emit a Vitest `describe` with one `it` per case. Called at the bottom of each
 * `*.eval.ts` case file as `export default runEvalSuite(defineEvalSuite({ ... }))`.
 *
 * Per-case skip-on-missing-env (NFR-AT2-SEC-005): a case whose env is absent SKIPS
 * (never reds the suite on a missing secret). A failing scorer is a real regression
 * → `expect` fails → Vitest exit code is non-zero (FR-AT2-EV-004).
 *
 * NOTE: this module is imported only by `*.eval.ts` files, which are EXCLUDED from
 * the default Vitest project + `verify` (`vite.config.ts` test.exclude). The
 * `describe`/`it` below therefore execute ONLY under `npm run test:evals`.
 */
export function runEvalSuite(suite: EvalSuite): EvalSuite {
  const missing = missingEnvVars();
  const skipReason = requiredEnv(missing)
    ? null
    : `eval env missing: ${missing.join(', ')} (provision to run)`;

  describe(suite.name, { concurrent: false, timeout: 60_000 }, () => {
    for (const c of suite.cases) {
      if (skipReason) {
        // NFR-AT2-SEC-005: graceful skip, never a red on a missing secret. The skip
        // reason is surfaced in the test name suffix (Vitest reports it as skipped).
        it.skip(`${c.name} [SKIPPED: eval env not provisioned]`, () => {});
        continue;
      }
      it(c.name, async () => {
        const run = await runEvalCase(c);
        const { pass, reasons } = await runScorers(c.expect, run);
        // Each failing scorer's reason is surfaced in the assertion message.
        expect(pass, reasons.join(' | ') || 'eval scorers failed').toBe(true);
      });
    }
  });

  return suite;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

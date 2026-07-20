/**
 * Capture REAL ClickUp webhook deliveries, once, and turn them into test fixtures.
 *
 * Why this exists: `ClickUpWebhookPayload` (clickup/types.ts) is a PROVISIONAL guess — it assumes the
 * delivery carries a full `task` object. ClickUp's docs say the envelope is
 * `{event, task_id, webhook_id, history_items[]}` with NO task. Mocks cannot settle this; only a real
 * delivery can. This script gets one of each event type and writes them to e2e-usable fixtures.
 *
 * SECRET HANDLING (binding, OD-INT-8): the API token arrives via the CLICKUP_TOKEN env var and is
 * never logged, never written to a file, never placed in a URL or argv. The per-webhook signing
 * secret returned at registration is likewise held in memory only. Captured payloads are REDACTED
 * (actor email/username/profile picture) before being written, so no workspace PII lands in the repo.
 *
 * LIVE API USE (binding, OD-INT-8): ~15 calls total, one pass, no polling. Every artifact created in
 * ClickUp (the webhook registration and the probe task) is deleted in the `finally` block, including
 * on crash or Ctrl-C. Leave the workspace as found.
 *
 * Usage:
 *   CLICKUP_TOKEN="$(~/.local/bin/op-get.sh clickup-api AS credential)" \
 *     deno run --allow-net --allow-env --allow-write --allow-run \
 *     scripts/clickup-webhook-capture.ts --list-id <LIST_ID> [--out <dir>]
 */

const API = 'https://api.clickup.com/api/v2';
const PORT = 8787;
const EVENTS = ['taskCreated', 'taskUpdated', 'taskStatusUpdated', 'taskDeleted'];

const token = Deno.env.get('CLICKUP_TOKEN');
if (!token) {
  console.error('✗ CLICKUP_TOKEN is not set (pipe it from 1Password; see the header comment)');
  Deno.exit(1);
}

const args = Deno.args;
// Optional. When omitted we CREATE a throwaway probe List and delete it again in cleanup — that
// keeps the probe out of any real List and avoids having to read workspace content to pick a target.
const givenListId = args.includes('--list-id') ? args[args.indexOf('--list-id') + 1] : undefined;
const outDir = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'supabase/functions/_shared/testing/fixtures/clickup-webhook';

/** ClickUp REST call. The token goes in a header from a variable — never into the URL. */
async function cu(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: token!, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${text.slice(0, 300)} (rl:${remaining})`);
  return text ? JSON.parse(text) : {};
}

/** Strip actor PII from a captured delivery before it becomes a committed fixture. */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'email') out[k] = 'redacted@example.test';
      else if (k === 'username') out[k] = 'Redacted User';
      else if (k === 'profilePicture') out[k] = null;
      else out[k] = redact(v);
    }
    return out;
  }
  return value;
}

type Capture = { signature: string | null; body: string };
const captured: Capture[] = [];

// ── 1. Capture sink. Answers 200 immediately (ClickUp marks a webhook Failing past 7s) ────────────
const ac = new AbortController();
const server = Deno.serve({ port: PORT, signal: ac.signal, onListen: () => {} }, async (req) => {
  if (req.method !== 'POST') return new Response('ok');
  captured.push({ signature: req.headers.get('x-signature'), body: await req.text() });
  return new Response('ok');
});
console.log(`✓ capture sink listening on :${PORT}`);

let ngrok: Deno.ChildProcess | undefined;
let webhookId: string | undefined;
let taskId: string | undefined;
let probeListId: string | undefined; // only set when WE created the List, so cleanup deletes it

try {
  // ── 2. Public URL via ngrok ──────────────────────────────────────────────────────────────────
  ngrok = new Deno.Command('ngrok', {
    args: ['http', String(PORT), '--log', 'stdout'],
    stdout: 'null',
    stderr: 'null',
  }).spawn();

  let publicUrl = '';
  for (let i = 0; i < 30 && !publicUrl; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    try {
      const t = await (await fetch('http://127.0.0.1:4040/api/tunnels')).json();
      publicUrl = t.tunnels?.find((x: any) => x.proto === 'https')?.public_url ?? '';
    } catch { /* ngrok not up yet */ }
  }
  if (!publicUrl) throw new Error('ngrok did not produce a public URL');
  console.log('✓ tunnel up');

  // ── 3. Workspace + List context ──────────────────────────────────────────────────────────────
  const teamId = (await cu('GET', '/team')).teams?.[0]?.id;
  if (!teamId) throw new Error('no ClickUp team on this token');

  let listId = givenListId;
  if (!listId) {
    const spaceId = (await cu('GET', `/team/${teamId}/space`)).spaces?.[0]?.id;
    if (!spaceId) throw new Error('no ClickUp space on this token');
    const created = await cu('POST', `/space/${spaceId}/list`, { name: `pmo-capture-probe ${Date.now()}` });
    listId = probeListId = created.id;
    console.log('✓ throwaway probe List created (deleted again in cleanup)');
  }

  const list = await cu('GET', `/list/${listId}`);
  const statuses: Array<{ status: string; type?: string }> = list.statuses ?? [];
  console.log(`✓ list resolved · ${statuses.length} statuses · types: ${[...new Set(statuses.map((s) => s.type))].join(',')}`);
  // The real status vocabulary — this is also the answer to V2 in the divergence doc.
  await Deno.mkdir(outDir, { recursive: true });
  await Deno.writeTextFile(`${outDir}/list-statuses.json`, JSON.stringify(statuses, null, 2));

  // ── 4. Register the webhook ──────────────────────────────────────────────────────────────────
  const hook = await cu('POST', `/team/${teamId}/webhook`, { endpoint: publicUrl, events: EVENTS });
  webhookId = hook.id ?? hook.webhook?.id;
  console.log(`✓ webhook registered (id captured, secret held in memory only)`);

  // ── 5. Drive one of each event ───────────────────────────────────────────────────────────────
  const settle = () => new Promise((r) => setTimeout(r, 6000));

  const created = await cu('POST', `/list/${listId}/task`, { name: `pmo-capture-probe ${Date.now()}` });
  taskId = created.id;
  console.log('  → taskCreated'); await settle();

  await cu('PUT', `/task/${taskId}`, { name: `pmo-capture-probe renamed` });
  console.log('  → taskUpdated (name)'); await settle();

  // Prefer a done/closed-type status: this also answers V4 (does date_done populate?).
  const target = statuses.find((s) => s.type === 'done') ?? statuses.find((s) => s.type === 'closed') ?? statuses[statuses.length - 1];
  await cu('PUT', `/task/${taskId}`, { status: target.status });
  console.log(`  → taskStatusUpdated (type=${target.type})`); await settle();

  const afterStatus = await cu('GET', `/task/${taskId}`);
  console.log(`  · date_done=${afterStatus.date_done === null ? 'null' : 'set'} date_closed=${afterStatus.date_closed === null ? 'null' : 'set'} (V4)`);

  // Archive fires taskUpdated, NOT taskDeleted (docs) — the §2.6 claim, verified here.
  await cu('PUT', `/task/${taskId}`, { archived: true });
  console.log('  → archived'); await settle();

  await cu('DELETE', `/task/${taskId}`);
  const deletedTaskId = taskId;
  taskId = undefined; // already gone; don't re-delete in cleanup
  console.log('  → taskDeleted'); await settle();

  // ── 6. Write fixtures ────────────────────────────────────────────────────────────────────────
  await Deno.mkdir(outDir, { recursive: true });
  const summary: Array<Record<string, unknown>> = [];
  for (const [i, c] of captured.entries()) {
    let parsed: any;
    try { parsed = JSON.parse(c.body); } catch { parsed = { unparseable: true }; }
    const event = parsed.event ?? `unknown-${i}`;
    await Deno.writeTextFile(
      `${outDir}/${String(i).padStart(2, '0')}-${event}.json`,
      JSON.stringify({ signatureHeaderPresent: c.signature !== null, payload: redact(parsed) }, null, 2),
    );
    summary.push({
      event,
      topLevelKeys: Object.keys(parsed).sort(),
      hasTaskObject: 'task' in parsed,
      hasHistoryItems: Array.isArray(parsed.history_items),
      historyFields: Array.isArray(parsed.history_items) ? [...new Set(parsed.history_items.map((h: any) => h.field))] : [],
      signaturePresent: c.signature !== null,
    });
  }
  await Deno.writeTextFile(`${outDir}/_summary.json`, JSON.stringify(summary, null, 2));

  console.log(`\n── captured ${captured.length} deliveries (task ${deletedTaskId} cleaned up) ──`);
  console.table(summary.map((s) => ({ event: s.event, hasTask: s.hasTaskObject, hasHistory: s.hasHistoryItems, sig: s.signaturePresent })));
  console.log(`\nfixtures + _summary.json written to ${outDir}`);
} finally {
  // ── 7. Cleanup — runs on success, failure and Ctrl-C ──────────────────────────────────────────
  if (taskId) { try { await cu('DELETE', `/task/${taskId}`); console.log('✓ probe task deleted'); } catch (e) { console.error('⚠ MANUAL CLEANUP NEEDED — task', taskId, e); } }
  if (webhookId) { try { await cu('DELETE', `/webhook/${webhookId}`); console.log('✓ webhook registration deleted'); } catch (e) { console.error('⚠ MANUAL CLEANUP NEEDED — webhook', webhookId, e); } }
  if (probeListId) { try { await cu('DELETE', `/list/${probeListId}`); console.log('✓ probe List deleted'); } catch (e) { console.error('⚠ MANUAL CLEANUP NEEDED — list', probeListId, e); } }
  try { ngrok?.kill(); } catch { /* already gone */ }
  ac.abort();
  await server.finished.catch(() => {});
}

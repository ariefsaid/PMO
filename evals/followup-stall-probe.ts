// Diagnose the follow-up stall (2026-07-07): the user's 2nd turn asks to (a) check the status of each
// "Tender Submitted" project and (b) "whether there are activities in the CRM to push this forward".
// There is NO read entity for CRM activities (readEntities.ts: crm_activities is a write target, not a
// v1 read). What does deepseek-v4-flash DO with that — query a valid entity, invent an unknown entity
// (→ error loop), call a WRITE (→ approval pause), call ask_user (→ pause), or answer in prose?
// Hits OpenRouter directly (no edge runtime → no CPU cap), N times, printing each first-round action.
import { buildAgentSystemPrompt } from "../supabase/functions/agent-chat/prompt.ts";
import { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP } from "../supabase/functions/agent-chat/readEntities.ts";
import {
  queryEntityAction, createActivityAction, updateTaskStatusAction, notifyAction,
  createAutomationAction, askUserAction,
} from "../supabase/functions/agent-chat/actions.ts";

const KEY = Deno.env.get("OPENROUTER_API_KEY");
if (!KEY) { console.error("OPENROUTER_API_KEY missing"); Deno.exit(2); }
const MODEL = Deno.env.get("EVAL_MODEL") ?? "deepseek/deepseek-v4-flash";
const N = Number(Deno.env.get("EVAL_N") ?? "6");

const system = buildAgentSystemPrompt(
  AGENT_READ_ENTITIES as unknown as string[], AGENT_READ_ROW_CAP, "Project Manager",
  { composeEnabled: true, automationsEnabled: true },
);
const tools = [queryEntityAction, createActivityAction, updateTaskStatusAction, notifyAction, createAutomationAction, askUserAction]
  .map((a) => ({ type: "function", function: { name: a.name, description: a.description, parameters: a.inputSchema } }));

// A realistic turn-1 answer (the "8 open opportunities" table the user actually saw).
const turn1Answer =
  "You have 8 open opportunities in your pipeline. Breakdown by stage: Leads 1 (Meridian East Wing Solar Scoping $1.8M); " +
  "PQ Submitted 2 (Cascade Foods Phase 2 $4.8M, Riverside Plastics Phase 2 $0.8M); " +
  "Tender Submitted 4 (Riverside Plastics Carport PV $2.9M, Northwind ERP $1.2M, Eastgate Depot $1.0M, Highfield Bridge $0.95M); " +
  "Negotiation 1 (Northgate Mills Rooftop PV $4.1M). Total potential pipeline value: ~$17.45M.";

const messages = [
  { role: "user", content: "How many open opportunities do I have this quarter? Break it down by stage." },
  { role: "assistant", content: turn1Answer },
  { role: "user", content: "for the tender submitted, can you check the status of each ones? and whether there are activities in the CRM to push this forward?" },
];

// Stub a query_entity result so the loop can continue without a DB. Tender projects have no
// status change to report and there is no activities entity — mirrors reality closely enough.
function stubToolResult(name: string, argsRaw: string): string {
  if (name !== "query_entity") return JSON.stringify({ error: `unknown entity or unsupported in probe: ${name}` });
  let args: { entity?: string } = {};
  try { args = JSON.parse(argsRaw); } catch { /*noop*/ }
  const entity = args.entity ?? "";
  if (!(AGENT_READ_ENTITIES as unknown as string[]).includes(entity)) {
    return JSON.stringify({ error: `unknown entity: ${entity}` });
  }
  if (entity === "projects") {
    return JSON.stringify({ rowCount: 4, rows: [
      { id: "p1", name: "Riverside Plastics Carport PV", status: "Tender Submitted" },
      { id: "p2", name: "Northwind ERP", status: "Tender Submitted" },
      { id: "p3", name: "Eastgate Depot", status: "Tender Submitted" },
      { id: "p4", name: "Highfield Bridge", status: "Tender Submitted" },
    ] });
  }
  return JSON.stringify({ rowCount: 0, rows: [] });
}

async function complete(msgs: unknown[]): Promise<{ msg: { content?: string; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish: string; err?: string }> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, ...msgs], tools, tool_choice: "auto" }),
  });
  if (!res.ok) return { msg: {}, finish: "http_error", err: `HTTP_${res.status}: ${(await res.text()).slice(0, 300)}` };
  const body = await res.json();
  return { msg: body?.choices?.[0]?.message ?? {}, finish: body?.choices?.[0]?.finish_reason ?? "?" };
}

const MAX_ROUNDS = 5;
async function runConversation(idx: number): Promise<void> {
  const msgs: unknown[] = [...messages];
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const { msg, finish, err } = await complete(msgs);
    if (err) { console.log(`  #${idx} r${round} MODEL_ERROR ${err}`); return; }
    const tc = msg.tool_calls ?? [];
    if (tc.length === 0) {
      console.log(`  #${idx} r${round} DONE finish=${finish} text="${(msg.content ?? "").replace(/\s+/g, " ").slice(0, 200)}"`);
      return;
    }
    const names = tc.map((t) => t.function.name);
    console.log(`  #${idx} r${round} calls=${JSON.stringify(names)} args=${tc.map((t) => t.function.arguments).join(" ").replace(/\s+/g, " ").slice(0, 220)}`);
    // A write/ask_user tool would PAUSE the real run for a decision — flag it and stop.
    const pauser = names.find((n) => ["create_activity", "update_task_status", "ask_user", "create_automation", "notify"].includes(n));
    if (pauser) { console.log(`  #${idx} r${round} ⏸  PAUSES on '${pauser}' (approval/question) — run would await a decision`); return; }
    // Otherwise feed stubbed tool results and continue the loop.
    msgs.push({ role: "assistant", content: msg.content ?? "", tool_calls: tc });
    for (const t of tc) msgs.push({ role: "tool", tool_call_id: t.id, content: stubToolResult(t.function.name, t.function.arguments) });
  }
  console.log(`  #${idx} HIT MAX_ROUNDS (${MAX_ROUNDS}) without terminating — LOOP suspect`);
}

console.log(`model=${MODEL}  N=${N}  (multi-round sim)\n`);
for (let i = 0; i < N; i++) {
  console.log(`#${i + 1}:`);
  try { await runConversation(i + 1); }
  catch (e) { console.log(`  #${i + 1} EXC ${(e as Error).message}`); }
}

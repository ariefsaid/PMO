// Model-focus check for the broadened read scope (2026-07-07): with ~23 read entities, does
// deepseek-v4-flash still route each question to the RIGHT entity, or does the larger menu cause
// mis-routing / thrash? Prints the first query_entity entity per question. Hits OpenRouter directly.
import { buildAgentSystemPrompt } from "../supabase/functions/agent-chat/prompt.ts";
import { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP } from "../supabase/functions/agent-chat/readEntities.ts";
import { queryEntityAction, createActivityAction, updateTaskStatusAction, notifyAction, createAutomationAction, askUserAction } from "../supabase/functions/agent-chat/actions.ts";

const KEY = Deno.env.get("OPENROUTER_API_KEY");
if (!KEY) { console.error("OPENROUTER_API_KEY missing"); Deno.exit(2); }
const MODEL = Deno.env.get("EVAL_MODEL") ?? "deepseek/deepseek-v4-flash";
const N = Number(Deno.env.get("EVAL_N") ?? "3");

const system = buildAgentSystemPrompt(AGENT_READ_ENTITIES as unknown as string[], AGENT_READ_ROW_CAP, "Project Manager", { composeEnabled: true, automationsEnabled: true });
const tools = [queryEntityAction, createActivityAction, updateTaskStatusAction, notifyAction, createAutomationAction, askUserAction]
  .map((a) => ({ type: "function", function: { name: a.name, description: a.description, parameters: a.inputSchema } }));

// question -> the entity we EXPECT the model to route to (first query).
const CASES: [string, string][] = [
  ["Have we paid the vendor invoices on my procurement cases?", "payments"],
  ["Show me the purchase orders across my procurements.", "purchase_orders"],
  ["What line items are on procurement case PRJ-001?", "procurement_items"],
  ["Any unread notifications for me?", "notifications"],
  ["Give me the budget breakdown by category.", "budget_line_items"],
  ["What documents are attached to my projects?", "project_documents"],
  ["Who is the project manager — resolve the person's name.", "profiles"],
  ["Have we received the goods (GRN) for my POs?", "procurement_receipts"],
];

async function firstEntity(q: string): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: q }], tools, tool_choice: "auto" }),
  });
  if (!res.ok) return `HTTP_${res.status}`;
  const body = await res.json();
  const tc = body?.choices?.[0]?.message?.tool_calls ?? [];
  const qe = tc.find((t: { function: { name: string } }) => t.function?.name === "query_entity");
  if (!qe) return "(no query_entity)";
  try { return JSON.parse(qe.function.arguments)?.entity ?? "(no entity)"; } catch { return "(bad args)"; }
}

console.log(`model=${MODEL}  N=${N}  entities=${(AGENT_READ_ENTITIES as unknown as string[]).length}\n`);
let hits = 0, total = 0;
for (const [q, expected] of CASES) {
  const got: Record<string, number> = {};
  for (let i = 0; i < N; i++) { const e = await firstEntity(q); got[e] = (got[e] ?? 0) + 1; }
  const top = Object.entries(got).sort((a, b) => b[1] - a[1])[0][0];
  const ok = top === expected;
  if (ok) hits++; total++;
  console.log(`${ok ? "✅" : "⚠️ "} expected=${expected.padEnd(22)} got=${JSON.stringify(got)}  | ${q}`);
}
console.log(`\n${hits}/${total} routed to the expected entity`);

// Focused live-loop proof (2026-07-07): with the fixed prompt, does deepseek-v4-flash emit a
// VALID project_status filter for the "active projects" question — i.e. the single comma-containing
// enum label "Won, Pending KoM" used verbatim, never split into invalid "Won" / "Pending KoM"?
// Hits OpenRouter directly (no edge runtime → no local CPU cap). Reports the exact filter args and
// validates every filter value against the REAL project_status enum.
import { buildAgentSystemPrompt } from "../supabase/functions/agent-chat/prompt.ts";
import { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP } from "../supabase/functions/agent-chat/readEntities.ts";
import { queryEntityAction, createActivityAction, updateTaskStatusAction } from "../supabase/functions/agent-chat/actions.ts";

const KEY = Deno.env.get("OPENROUTER_API_KEY");
if (!KEY) { console.error("OPENROUTER_API_KEY missing"); Deno.exit(2); }
const MODEL = Deno.env.get("EVAL_MODEL") ?? "deepseek/deepseek-v4-flash";
const N = Number(Deno.env.get("EVAL_N") ?? "6");

// The authoritative project_status enum labels (pg_enum, 2026-07-07). Note "Won, Pending KoM"
// is ONE label containing a comma — the exact footgun this probe guards.
const VALID_STATUS = new Set([
  "Leads", "PQ Submitted", "Quotation Submitted", "Tender Submitted", "Negotiation",
  "Won, Pending KoM", "Ongoing Project", "On Hold", "Close Out", "Loss Tender", "Internal Project",
]);

const system = buildAgentSystemPrompt(
  AGENT_READ_ENTITIES as unknown as string[], AGENT_READ_ROW_CAP, "Project Manager",
  { composeEnabled: true, automationsEnabled: false },
);
const tools = [queryEntityAction, createActivityAction, updateTaskStatusAction].map((a) => ({
  type: "function", function: { name: a.name, description: a.description, parameters: a.inputSchema },
}));

const Q = "How many active projects do I have? List their names.";

async function once(): Promise<{ entity?: string; values?: unknown[]; allValid: boolean; raw: string }> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: system }, { role: "user", content: Q }], tools, tool_choice: "auto" }),
  });
  const body = await res.json();
  const tc = body?.choices?.[0]?.message?.tool_calls ?? [];
  const qe = tc.find((t: { function: { name: string } }) => t.function?.name === "query_entity");
  if (!qe) return { allValid: false, raw: "(no query_entity call)" };
  const args = JSON.parse(qe.function.arguments);
  const filter = args.filter;
  const values: unknown[] = filter ? (Array.isArray(filter.value) ? filter.value : [filter.value]) : [];
  // A status filter is valid iff every value is a real enum label. No filter at all is also fine
  // (returns all projects — the model can then summarize), so treat "no status filter" as valid.
  const isStatusFilter = filter?.column === "status";
  const allValid = !isStatusFilter || values.every((v) => VALID_STATUS.has(String(v)));
  return { entity: args.entity, values: isStatusFilter ? values : undefined, allValid, raw: JSON.stringify(args) };
}

console.log(`model=${MODEL}  N=${N}\nQ: ${Q}\n`);
let valid = 0;
for (let i = 0; i < N; i++) {
  try {
    const r = await once();
    if (r.allValid && r.entity === "projects") valid++;
    console.log(`#${i + 1} entity=${r.entity} statusValues=${JSON.stringify(r.values)} valid=${r.allValid ? "YES" : "NO ❌"}  args=${r.raw}`);
  } catch (e) { console.log(`#${i + 1} ERROR ${(e as Error).message}`); }
}
console.log(`\n${valid}/${N} produced a projects query with a VALID status filter`);
Deno.exit(valid === N ? 0 : 1);

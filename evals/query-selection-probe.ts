// Query-predictability eval: does deepseek-v4-flash actually CALL query_entity for
// common PMO questions, given the REAL system prompt + tools? Runs each question N
// times and reports the tool-call rate. No DB / browser — pure model behavior.
//   deno run --allow-net --allow-env --allow-read eval_queries.ts
import { buildAgentSystemPrompt } from "../supabase/functions/agent-chat/prompt.ts";
import { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP } from "../supabase/functions/agent-chat/readEntities.ts";
import {
  queryEntityAction,
  createActivityAction,
  updateTaskStatusAction,
} from "../supabase/functions/agent-chat/actions.ts";

const KEY = Deno.env.get("OPENROUTER_API_KEY");
if (!KEY) { console.error("OPENROUTER_API_KEY missing"); Deno.exit(2); }
const MODEL = Deno.env.get("EVAL_MODEL") ?? "deepseek/deepseek-v4-flash";
const N = Number(Deno.env.get("EVAL_N") ?? "5");

const system = buildAgentSystemPrompt(
  AGENT_READ_ENTITIES as unknown as string[],
  AGENT_READ_ROW_CAP,
  "admin",
  { composeEnabled: true, automationsEnabled: false },
);
const tools = [queryEntityAction, createActivityAction, updateTaskStatusAction].map((a) => ({
  type: "function",
  function: { name: a.name, description: a.description, parameters: a.inputSchema },
}));

const QUESTIONS = [
  "How many open opportunities do I have this quarter?",
  "How many open tasks are there across my projects?",
  "List my active projects.",
  "Any safety incidents this month?",
  "What is our total procurement spend?",
  "Show me my milestones.",
];

async function callOnce(q: string): Promise<{ toolCalls: string[]; queried: boolean; entity?: string }> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: system }, { role: "user", content: q }],
      tools,
      tool_choice: "auto",
    }),
  });
  const body = await res.json();
  const tc = body?.choices?.[0]?.message?.tool_calls ?? [];
  const names: string[] = tc.map((t: { function: { name: string } }) => t.function.name);
  const qe = tc.find((t: { function: { name: string } }) => t.function.name === "query_entity");
  let entity: string | undefined;
  if (qe) { try { entity = JSON.parse(qe.function.arguments)?.entity; } catch { /*noop*/ } }
  return { toolCalls: names, queried: !!qe, entity };
}

console.log(`model=${MODEL}  N=${N}  entities=${(AGENT_READ_ENTITIES as unknown as string[]).join(",")}`);
console.log(`system prompt length: ${system.length} chars\n`);
for (const q of QUESTIONS) {
  let queried = 0;
  const entities: Record<string, number> = {};
  const sampleCalls: string[] = [];
  for (let i = 0; i < N; i++) {
    try {
      const r = await callOnce(q);
      if (r.queried) { queried++; if (r.entity) entities[r.entity] = (entities[r.entity] ?? 0) + 1; }
      if (i === 0) sampleCalls.push(r.toolCalls.join(",") || "(no tool call → prose/refusal)");
    } catch (e) { sampleCalls.push(`ERROR:${(e as Error).message}`); }
  }
  const pct = Math.round((queried / N) * 100);
  console.log(`${pct.toString().padStart(3)}% queried  [${queried}/${N}]  entities=${JSON.stringify(entities)}  1st=${sampleCalls[0]}`);
  console.log(`     Q: ${q}`);
}

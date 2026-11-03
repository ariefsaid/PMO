// Plans S4 (FR-PLN-008) eval: with `stock` OFF for the org, does the model (a) refrain from calling a
// stock tool and (b) tell the user the feature is not on the plan?
//
// Real system prompt + real tool catalog (the shipped buildTools/offerable* output), mocked switches —
// no DB, no browser. Model behaviour only.
//
//   OPENROUTER_API_KEY=... deno run --allow-net --allow-env --allow-read evals/plans-switch-off-probe.ts
//
// EVAL_N (default 3) = runs per question. PASS = no tool call AND a plan refusal in the reply.
import { buildTools } from '../supabase/functions/agent-chat/handler.ts';
import { buildAgentSystemPrompt } from '../supabase/functions/agent-chat/prompt.ts';
import { AGENT_READ_ENTITIES, AGENT_READ_ROW_CAP } from '../supabase/functions/agent-chat/readEntities.ts';
import { offerableEntities, unavailableFeatureLabels } from '../supabase/functions/agent-chat/featureSwitches.ts';

const KEY = Deno.env.get('OPENROUTER_API_KEY');
if (!KEY) {
  console.error('OPENROUTER_API_KEY missing');
  Deno.exit(2);
}
const MODEL = Deno.env.get('EVAL_MODEL') ?? 'deepseek/deepseek-v4-flash';
const N = Number(Deno.env.get('EVAL_N') ?? '3');

// The switch snapshot the resolver would return for an org whose plan excludes warehouse stock.
const switches = { stock: false, crm: true, procurement: true, timesheets: true };
const tools = buildTools(true, switches);
const entities = offerableEntities(switches, AGENT_READ_ENTITIES);
const system = buildAgentSystemPrompt(entities, AGENT_READ_ROW_CAP, 'Project Manager', {
  composeEnabled: true,
  automationsEnabled: true,
  invoiceDraftsEnabled: true,
  remindersEnabled: true,
  offeredTools: new Set(tools.map((t) => t.function.name)),
  offeredEntities: new Set<string>(entities),
  unavailableFeatures: unavailableFeatureLabels(switches),
});

const QUESTIONS = [
  'How much cement is on hand in gudang A?',
  'Show me the stock movement history for steel rebar last month.',
  'Which items are below their reorder level?',
];

const PLAN_WORDS = /\b(plan|not included|not available|upgrade|paket|tidak termasuk)\b/i;

console.log(`model=${MODEL}  N=${N}  stock=off  tools=${tools.map((t) => t.function.name).join(',')}`);
console.log(`system prompt: ${system.length} chars, mentions the plan line: ${system.includes("plan does not include")}\n`);

let pass = 0;
let total = 0;
for (const q of QUESTIONS) {
  for (let i = 0; i < N; i++) {
    total++;
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'system', content: system }, { role: 'user', content: q }],
          tools,
          tool_choice: 'auto',
          temperature: 0.2,
        }),
      });
      const body = await res.json();
      const message = body?.choices?.[0]?.message ?? {};
      const calls: string[] = (message.tool_calls ?? []).map((t: { function: { name: string } }) => t.function.name);
      const text = String(message.content ?? '');
      const stockCall = calls.some((n) => n === 'query_stock');
      const refused = PLAN_WORDS.test(text) && !stockCall;
      if (refused) pass++;
      console.log(`${refused ? 'PASS' : 'FAIL'}  calls=[${calls.join(',')}]  reply="${text.slice(0, 140)}"`);
    } catch (e) {
      console.log(`ERROR  ${(e as Error).message}`);
    }
    console.log(`     Q: ${q}`);
  }
}
console.log(`\n${pass}/${total} runs said the feature is not on the plan without calling a stock tool.`);
Deno.exit(pass === total ? 0 : 1);

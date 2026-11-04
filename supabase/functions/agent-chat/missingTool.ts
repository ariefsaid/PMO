/**
 * missingTool.ts — the privacy-preserving "the assistant has no tool for this" signal (S4,
 * FR-PLN-009 / AC-PLN-007).
 *
 * The product question: when a user asks for something the assistant cannot do — a module that is off
 * on their plan, or a capability no tool covers — that demand is invisible today. This module turns it
 * into ONE PostHog event carrying `org`, `route` and a coarse **module guess**, and nothing else. It
 * never returns, logs or forwards the question or the answer text: the guess is drawn from the fixed
 * module vocabulary below, so even a prompt-injected answer can only select a constant.
 *
 * Pure: no imports beyond the UUID regex — no I/O, no Deno globals.
 */
import { UUID_RE } from './looseClient.ts';

/**
 * Which of the two demand signals this answer is (FR-PLN-009): the assistant says it has no such
 * capability (`missing`), or it says the module is not on the org's plan (`plan`). The owner builds for
 * the first and sells for the second, so the chart must be able to separate them.
 */
export type MissingToolSource = 'missing' | 'plan';

/** Plan wording — the phrasing the system prompt tells the model to use for a switched-off module. */
const PLAN_PATTERNS: readonly RegExp[] = Object.freeze([
  // "stock isn't on your organisation's plan" / "not part of your plan" / "not included in the plan"
  /\b(?:isn'?t|is\s+not|not)\s+(?:on|part\s+of|included\s+in)\s+(?:your|the)\s+(?:organi[sz]ation'?s?|org'?s?|company'?s?|current\s+)?\s*(?:plan|subscription)\b/i,
  // "not available on your plan"
  /\bnot\s+available\s+on\s+(?:your|the)\s+(?:organi[sz]ation'?s?|org'?s?|company'?s?)?\s*(?:plan|subscription)\b/i,
]);

/** Capability wording — nothing exists for the request. */
const MISSING_TOOL_PATTERNS: readonly RegExp[] = Object.freeze([
  // "I don't have a tool for that", "I do not have any tool to read stock"
  /\b(?:do|does|did)\s*n[o']?t\s+have\s+(?:a|any|the)\s+(?:tool|way\s+to|capability|ability\s+to)\b/i,
  // "there is no tool", "no such tool", "I have no tool"
  /\b(?:there\s+(?:is|are)\s+)?no\s+(?:such\s+)?tool\b/i,
  // "the tool for stock isn't available"
  /\btool\s+(?:for|to)\b[^.]{0,80}\b(?:isn'?t|is\s+not|not)\s+(?:available|supported|enabled)\b/i,
  // "the tool isn't available to me"
  /\btools?\s+(?:isn'?t|is\s+not|aren'?t|are\s+not)\s+available\b/i,
  // "the stock feature is not available/enabled", "that module is not available"
  /\b(?:this|that|the)\s+(?:\w+\s+)?(?:feature|module)\s+(?:is\s+)?(?:not\s+(?:available|enabled|included))\b/i,
]);

/**
 * Module vocabulary for the guess — ordered most-specific-first. Names are the switch keys where one
 * exists (so the event lines up with plan switches), else a coarse module name. First match wins.
 */
const MODULE_GUESSES: readonly { module: string; re: RegExp }[] = Object.freeze([
  { module: 'stock', re: /\b(stock|stok|inventory|warehouse|warehouses|gudang|on[ -]hand|reorder level)\b/i },
  { module: 'imprest', re: /\b(imprest|petty[ -]cash)\b/i },
  { module: 'financial_statements', re: /\b(financial statements?|profit (?:and|&) loss|p&l|balance sheet|trial balance)\b/i },
  { module: 'management_pack', re: /\b(management pack)\b/i },
  { module: 'multi_currency', re: /\b(multi[ -]?currency|exchange rates?|fx rates?|currency rates?)\b/i },
  { module: 'sales_invoices', re: /\b(invoices?|invoicing|billing|progress claims?)\b/i },
  { module: 'revenue', re: /\b(incoming payments?|receipts?|ageing|aging|receivables?)\b/i },
  // D17 (#1783 item 1): receipts/GRNs are Basic reads — an ordinary receipt ask is never a Full ask.
  // Only the match is Full-only vocabulary; the offered `procurement_receipts` entity covers receipts.
  { module: 'procurement_full', re: /\bthree[ -]way match\b/i },
  { module: 'procurement', re: /\b(procurement|purchase orders?|purchase requisitions?|rfqs?|quotations?|suppliers?|vendors?|payables?)\b/i },
  { module: 'timesheets', re: /\b(time ?sheets?|hours logged|timesheet entries)\b/i },
  { module: 'crm', re: /\b(crm|compan(?:y|ies)|contacts?|deals?|opportunit(?:y|ies))\b/i },
  { module: 'sales_pipeline', re: /\b(pipeline|leads?|prospects?)\b/i },
  { module: 'user_views', re: /\b(saved views?|custom views?|dashboards?)\b/i },
  { module: 'agent_assistant', re: /\b(automations?|scheduled agent)\b/i },
  { module: 'import_export', re: /\b(imports?|exports?|bulk upload)\b/i },
  { module: 'erp_sync', re: /\b(erp|erpnext|odoo|synchroni[sz]ation)\b/i },
  { module: 'incidents', re: /\b(incidents?|hse|safety reports?)\b/i },
  { module: 'budget_projection', re: /\b(budget project(?:ion|ions)|budget forecast)\b/i },
]);

/** Coarse module name used when nothing in the text matches the vocabulary. */
export const UNKNOWN_MODULE = 'unknown';

/**
 * Template a route for telemetry: drop the query/hash, then replace UUID and numeric path segments with
 * `:id` so an entity id never leaves the app. Clamped to the 64-char server-property ceiling.
 */
export function routeTemplate(route: string | null | undefined): string | undefined {
  if (typeof route !== 'string') return undefined;
  const path = route.split(/[?#]/)[0].trim();
  if (!path) return undefined;
  const templated = path
    .split('/')
    .map((segment) => (UUID_RE.test(segment) || /^\d+$/.test(segment) ? ':id' : segment))
    .join('/');
  return templated.slice(0, 64);
}

/** The coarse module a request maps to (first vocabulary match over question, then answer). */
export function guessModule(question: string, answer: string): string {
  const corpus = `${question}\n${answer}`;
  for (const { module, re } of MODULE_GUESSES) {
    if (re.test(corpus)) return module;
  }
  return UNKNOWN_MODULE;
}

/**
 * Did the assistant answer that it has no tool for this request? Returns the module guess and the source
 * (and nothing else) when it did, `null` otherwise. Only COMPLETED answers should be tested — a partial
 * draft is not an answer.
 */
export function detectMissingTool(
  input: { question?: string; answer?: string },
): { module: string; source: MissingToolSource } | null {
  const answer = typeof input.answer === 'string' ? input.answer : '';
  if (!answer.trim()) return null;
  const source: MissingToolSource | null = PLAN_PATTERNS.some((re) => re.test(answer))
    ? 'plan'
    : MISSING_TOOL_PATTERNS.some((re) => re.test(answer))
      ? 'missing'
      : null;
  if (!source) return null;
  return { module: guessModule(typeof input.question === 'string' ? input.question : '', answer), source };
}

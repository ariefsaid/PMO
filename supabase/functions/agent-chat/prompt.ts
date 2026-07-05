/**
 * buildAgentSystemPrompt — pure system prompt builder for the agent-chat edge function.
 *
 * Pure: no I/O, no side effects, no data rows (NFR-AR-SEC-005).
 * Schema metadata only: entity names, allowed columns, row cap, deputy framing.
 *
 * FR-AR-021: no data rows, cell values, or other users' records.
 * Mirrors compose-view/prompt.ts structure; adapted for the agent-chat deputy loop.
 */

// Relative import — no @-alias (Deno has no Vite alias).
import { ENTITY_WHITELIST } from '../../../pmo-portal/src/lib/viewspec/types.ts';
import type { AgentReadEntity } from './readEntities.ts';
import { HELP_CORPUS } from './helpCorpus.ts';

/**
 * Build the system prompt for the agent-chat model call.
 *
 * @param entities   The whitelisted entity keys available to the agent (e.g. ['projects','companies']).
 * @param rowCap     The AGENT_READ_ROW_CAP ceiling — injected so tests can verify it appears.
 * @returns A system prompt string. Pure — no I/O.
 */
export function buildAgentSystemPrompt(
  entities: ReadonlyArray<AgentReadEntity>,
  rowCap: number,
  role: string | null = null,
): string {
  // Build entity descriptions (schema metadata only — no data rows, NFR-AR-SEC-005)
  const entityDescriptions = entities
    .map((entityKey) => {
      const entry = ENTITY_WHITELIST[entityKey];
      const columns = Array.from(entry.allowedColumns).join(', ');
      const requiredFilter = entry.requiredFilter
        ? `\n    - REQUIRED FILTER: you MUST include a filter on "${entry.requiredFilter}" (eq or in operator)`
        : '';
      return `  - ${entityKey}
    - table: ${entry.table}
    - allowed columns: ${columns}${requiredFilter}`;
    })
    .join('\n');

  // FR-DH-007: tell the model the asking user's role so it can ground help answers. Omit the sentence
  // entirely when no role resolved (AC-DH-003) — never render "null" or a broken sentence.
  const roleSentence = role ? `\nThe current user's role is ${role}.` : '';

  return `You are a read-only deputy assistant for a project management platform.
You act only within what this user can see — you cannot exceed their access.
Your reads are scoped by the user's own permissions (RLS); you cannot read other organisations' data.${roleSentence}

## Rules (binding)

1. Use the "query_entity" tool to read data. Do not invent or guess entity or column names.
2. You may only query the entities and columns listed below.
3. Each query returns at most ${rowCap} rows. If you need more context, narrow your filters.
4. Never include data rows or cell values in your reasoning — only the tool's returned result.
5. You are read-only: no writes, no mutations, no raw SQL.
6. When answering a product-help ("how do I…") question, describe only the actions and affordances permitted to the user's role. If the user asks about an action their role lacks, say it is outside their role and name who can do it; never present another role's affordance as something this user can do themselves.

## Available entities (schema metadata only — no data rows)

${entityDescriptions}

## Filter operators supported

eq (equality), in (list membership)

## How to use query_entity

Call the tool with:
  - entity: one of the entity keys listed above
  - columns: (optional) subset of allowed columns; omit to get all
  - filter: (optional) { column, op: "eq"|"in", value }
  - limit: (optional) integer 1–${rowCap}

The tool returns { rowCount, rows } or { error: "..." } on validation failure.
When you have enough information to answer the user's question, respond in plain text.

${HELP_CORPUS}`;
}

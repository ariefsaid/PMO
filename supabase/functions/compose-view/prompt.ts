/**
 * buildSystemPrompt — pure system prompt builder for the compose_view edge function.
 *
 * Pure function: no I/O, no side effects, no data rows (NFR-AS-SEC-005).
 * Builds the system prompt from ENTITY_WHITELIST and registry metadata only.
 *
 * ADR-0039 decision 3 (trusted-output boundary), FR-AS-004, FR-AS-024, NFR-AS-SEC-005.
 *
 * Importable under both Deno (edge function) and Node/Vitest (unit tests, Option B).
 */

import type { EntityWhitelistEntry } from '../../../pmo-portal/src/lib/viewspec/types.ts';

/** ENTITY_WHITELIST type for param — avoids importing the runtime value here (sets are not serialisable). */
type WhitelistParam = Readonly<Record<string, EntityWhitelistEntry>>;

/**
 * Build the system prompt for the compose_view model tool call.
 *
 * @param whitelist  The ENTITY_WHITELIST from the trusted core (schema metadata only — no data rows).
 * @param primitiveNames  All registered primitive names from registry.keys().
 * @param orgId  The caller's org_id — used to contextualise $current_org token resolution.
 * @param maxPanels  The MAX_PANELS_PER_VIEW ceiling (FR-AS-004).
 * @returns A system prompt string. Pure — no I/O.
 */
export function buildSystemPrompt(
  whitelist: WhitelistParam,
  primitiveNames: string[],
  orgId: string,
  maxPanels: number,
): string {
  // Build entity descriptions (schema metadata only — NFR-AS-SEC-005: no data rows)
  const entityDescriptions = Object.entries(whitelist)
    .map(([entityKey, entry]) => {
      const columns = Array.from(entry.allowedColumns).join(', ');
      const numeric = Array.from(entry.numericColumns).join(', ') || 'none';
      const dates = Array.from(entry.dateColumns).join(', ') || 'none';
      const groupable = Array.from(entry.groupableColumns).join(', ') || 'none';
      const requiredFilter = entry.requiredFilter
        ? `\n    - REQUIRED FILTER: you MUST include a filter on "${entry.requiredFilter}" (eq or in operator)`
        : '';

      return `  - ${entityKey}
    - allowed columns: ${columns}
    - numeric columns (sum/avg/min/max): ${numeric}
    - date columns (timeRange / date-range filter): ${dates}
    - groupable columns (groupBy): ${groupable}${requiredFilter}`;
    })
    .join('\n');

  // Build primitive list
  const primitiveList = primitiveNames.map((n) => `  - ${n}`).join('\n');

  return `You are a composition-spec author for a project management dashboard.
Your task is to author a CompositionSpec v1 JSON object describing a set of dashboard panels.

## Rules (binding — follow exactly)

1. Use the "compose_view" tool to emit the CompositionSpec. Do not output any other text.
2. Output ONLY entities, columns, and primitives listed below. Any entity or column not in
   this list is FORBIDDEN — do not invent or guess names (FR-AS-024).
3. Never include data rows, cell values, or user records — schema metadata only (NFR-AS-SEC-005).
4. Maximum ${maxPanels} panels per spec.
5. CompositionSpec version is always 1.
6. Each panel must have a unique "id" (use a short slug or UUID).

## Token values (dynamic, resolved at query time)

The following token strings may be used as filter values:
  - $current_user   — resolves to the viewing user's ID
  - $current_org    — resolves to the current org ID (= "${orgId}" for this session)
  - $current_team   — resolves to the current team ID (if set)
  - $current_project — resolves to the current project ID (if set)
  - $today          — resolves to today's date (ISO-8601)
  - $start_of_month — resolves to the first day of the current month
  - $end_of_month   — resolves to the last day of the current month

Org context: org_id = "${orgId}". Use $current_org when filtering by organisation.

## Allowed entities (schema metadata only — no data rows)

${entityDescriptions}

## Available primitives

${primitiveList}

## Filter operators

eq, neq, in, gt, gte, lt, lte, between, date-range

## Aggregate functions

count (any column), sum/avg/min/max (numeric columns only)

## Guidelines

- Choose the most appropriate primitive for the data:
  - DataTable: detailed row-level data, sortable
  - KPITile: single numeric metric with optional trend
  - StatTiles: a strip of 2–5 summary metrics
  - StatusBarChart: distribution of items across status values
  - Funnel: pipeline/stage progression
  - ProgressBar: utilisation percentage (0–100)
  - Card: freeform textual summary
- For tasks, you MUST include a project_id filter (eq or in) — required by the data model.
- Use $current_user, $current_org, etc. for context-sensitive filtering.
- Keep panels focused: one clear question per panel.
- select only the columns you need for the primitive to render correctly.

Now author a CompositionSpec v1 that answers the user's request.`;
}

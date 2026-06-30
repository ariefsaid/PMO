/**
 * ToolCallCard — compact evidence card for a tool-call AgentEvent.
 * Shows a human-readable label instead of raw payload JSON.
 * D-A2-7: "Looked up {entity} · N rows" pattern; never raw JSON.
 * FR-AP-015; AC-AP-013.
 */
import React from 'react';

/**
 * Derives a human-readable label from the tool payload.
 * Single source of truth per §3 of the implementation plan.
 */
function toolLabel(payload: unknown): string {
  const p = payload as { entity?: string; rowCount?: number } | undefined;
  if (p?.entity) {
    return `Looked up ${p.entity}${typeof p.rowCount === 'number' ? ` · ${p.rowCount} rows` : ''}`;
  }
  return 'Checking your data…';
}

interface ToolCallCardProps {
  payload: unknown;
}

export const ToolCallCard: React.FC<ToolCallCardProps> = ({ payload }) => {
  const label = toolLabel(payload);
  return (
    <div
      className="flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 py-1.5"
      aria-label={label}
    >
      {/* Decorative glyph — aria-hidden so the accessible name comes from aria-label */}
      <span aria-hidden className="text-muted-foreground">
        &#10003;
      </span>
      <span className="tabular-nums text-xs text-muted-foreground">{label}</span>
    </div>
  );
};

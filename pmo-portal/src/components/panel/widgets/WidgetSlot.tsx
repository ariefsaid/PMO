/**
 * WidgetSlot — the client-side trust boundary for agent-emitted widget
 * payloads (FR-ATC-004/005/006, NFR-ATC-SEC-002, NFR-ATC-A11Y-003).
 *
 * The `widget` prop is typed `unknown` on purpose: this component is the
 * boundary and must never assume the payload is well-formed, even though
 * the server already validated it before emit (ADR-0039/ADR-0045 §1 —
 * the untrusted-output boundary is enforced TWICE). A payload that fails
 * the SAME zod schema the server uses renders a fixed, safe text fallback
 * — never a crash, never a partial render, never executable content (no
 * `dangerouslySetInnerHTML`, no `eval`, no iframe anywhere in this module).
 */
import React from 'react';
import { WIDGET_PAYLOAD_SCHEMA, type WidgetPayload } from '@/src/lib/agent/widgets/schema';
import { renderWidget } from './registry';

export const WidgetSlot: React.FC<{ widget: unknown }> = ({ widget }) => {
  const parsed = WIDGET_PAYLOAD_SCHEMA.safeParse(widget); // FR-ATC-004 — SAME schema, second gate
  if (!parsed.success) {
    return (
      <div
        role="note"
        className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground"
      >
        This result couldn&apos;t be displayed.
      </div>
      // FR-ATC-006 / NFR-ATC-SEC-002 — fixed safe string, real text node (A11Y-003)
    );
  }
  // `parsed.data` is zod's own `z.infer` output, which this repo's non-strict
  // tsconfig widens to optional fields (see schema.ts's drift-guard comment)
  // — the re-assertion to the hand-declared WidgetPayload is a type-only
  // narrowing of an ALREADY-VALIDATED value (zod's .safeParse already ran,
  // parsed.success is true); it does not skip or weaken the runtime check.
  return renderWidget(parsed.data as WidgetPayload); // FR-ATC-005 — registry dispatch
};

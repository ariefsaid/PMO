/**
 * pushErrorCopy.ts — the ONE translation from a persisted `*_erp_mirror.push_error` to something a
 * human reads, plus the two properties every push surface must key its affordances on.
 *
 * ⚑ WHY THIS EXISTS (rendered Discover pass, 2026-07-22 — I-5/I-6/I-7/I-14/I-15).
 * `push_error` is a MACHINE token. The budget banner rendered it verbatim (`budget-category-unmapped`)
 * and the timesheet badge rendered the writer's `"<code>: <message>"` concatenation verbatim
 * (`activity-type-unconfigured: binding config has no default_activity_type`). Both put an adapter's
 * internal vocabulary in front of an operator on the primary money surfaces. Worse, both offered
 * **Retry** for causes a retry can never fix — while the budget surface already gets exactly this
 * contract right for `unstamped-activation` (explain the real route, offer no button that can only
 * fail). Retryability is a property of the CODE, not of the component that happens to display it, so
 * it is decided once, here, and proven once, here.
 *
 * Three facts per code:
 *   • `message`  — a sentence. NEVER a token (`RAW_ADAPTER_TOKEN` is asserted against in the tests).
 *   • `retryable`— can re-running the SAME command plausibly land it without a change elsewhere?
 *                  Fail OPEN on an unknown code: stranding an operator is worse than a wasted click.
 *   • `transport`— did it fail to REACH ERPNext (nothing on screen was fixable), or did ERPNext /
 *                  the gate understand it and refuse (something above may need fixing)? I-6.
 *
 * `remedy` is what must change first; it is always present when `retryable` is false, because a
 * withheld button with no route out is a dead end (the C-3 lesson, applied to error copy).
 */

/**
 * A raw adapter token: two-or-more lowercase/digit segments joined by hyphens, standing alone as a
 * word. Surfaces assert against this so a NEW code can never quietly reach the DOM by being added to
 * a writer and forgotten here.
 */
export const RAW_ADAPTER_TOKEN = /(?:^|[\s(])[a-z0-9]+(?:-[a-z0-9]+)+(?=$|[\s.,;:)])/;

export interface PushErrorCopy {
  /** The classified code, for logic/tests. `null` when nothing was recorded. */
  code: string | null;
  /** A human sentence. Never contains a raw adapter token. */
  message: string;
  /** May re-running the same command plausibly succeed? */
  retryable: boolean;
  /** Did it fail to REACH ERPNext (as opposed to being refused by a rule)? */
  transport: boolean;
  /** What must change first. Always set when `retryable` is false. */
  remedy: string | null;
}

interface Entry {
  message: string;
  retryable: boolean;
  transport?: boolean;
  remedy?: string;
}

const CODES: Record<string, Entry> = {
  // ── budget push ──────────────────────────────────────────────────────────────────────────────
  'budget-category-unmapped': {
    // Retryable ON PURPOSE: this is precisely the case HIGH-D exists for — the Admin maps the missing
    // categories, then re-drives under their own JWT (the sweep backstop excludes `held`).
    message: 'One or more budget categories have no ERP account mapped, so ERPNext cannot accept the budget.',
    retryable: true,
    remedy: 'Map every listed category to an ERP account, then retry.',
  },
  'budget-multi-fiscal-year': {
    message: 'This budget spans more than one fiscal year, which ERPNext records as one budget per year.',
    retryable: false,
    remedy: 'Split the budget so each version covers a single fiscal year, then activate it again.',
  },
  'budget-draft-rival-on-grain': {
    message: 'ERPNext already holds an unsubmitted budget for this project and fiscal year.',
    retryable: false,
    remedy: 'In ERPNext, submit or delete that draft budget — until then every push is refused as a duplicate.',
  },
  'budget-enforcement-absent': {
    // HIGH-1: the previous ERP budget was cancelled and its replacement never landed.
    message: 'ERPNext is currently enforcing no budget at all for this project — the previous one was withdrawn and its replacement never landed.',
    retryable: true,
  },
  // ── timesheet push ───────────────────────────────────────────────────────────────────────────
  'cross-org-link-rejected': {
    message: 'This timesheet references a record that belongs to a different organisation, so it was refused.',
    retryable: false,
    remedy: 'This is a linkage fault in the underlying data — raise it with an administrator rather than retrying.',
  },
  'employee-unlinked': {
    message: 'This person is not linked to an ERP employee record, so their hours have nowhere to go.',
    retryable: false,
    remedy: 'Confirm their employee link in the queue above; the push is then driven again automatically.',
  },
  'project-unmapped': {
    message: 'A project on this timesheet is not mapped to an ERP project.',
    retryable: false,
    remedy: 'Map the project to its ERP counterpart before pushing these hours.',
  },
  'activity-type-unconfigured': {
    message: 'The ERPNext connection has no default activity type, so hours cannot be recorded against one.',
    retryable: false,
    remedy: 'Set a default activity type on the ERPNext connection — this is ERP-side configuration, not something a retry can supply.',
  },
  // ── shared ───────────────────────────────────────────────────────────────────────────────────
  'commit-rejected': {
    message: 'ERPNext understood the request and refused it.',
    retryable: true,
  },
  'config-rejected': {
    message: 'The ERPNext connection is not usable — it is inactive, or its version no longer matches.',
    retryable: false,
    remedy: 'Reconnect ERPNext from the integrations settings before pushing again.',
  },
  'command-held': {
    message: 'This push is held for a person to decide — a machine must not resolve it on its own.',
    retryable: false,
    remedy: 'An administrator must release the hold once the underlying condition is resolved.',
  },
  'external-unreachable': {
    message: 'ERPNext could not be reached, so the push never arrived.',
    retryable: true,
    transport: true,
  },
  DISPATCH_FAILED: {
    message: 'The push failed before ERPNext answered.',
    retryable: true,
    transport: true,
  },
};

/**
 * Splits the writer's persisted shape. `markTimesheetPushOutcome` stores `"<code>: <message>"`;
 * `recordBudgetPushFailure` stores a bare code (or `"<code>: <redacted detail>"` for
 * `budget-enforcement-absent`). Everything after the first `:` is adapter/ERP prose and is DROPPED —
 * it is the half that leaks internals, and the classified sentence already says what happened.
 */
function splitCode(raw: string): string {
  const head = raw.split(':', 1)[0]!.trim();
  return head;
}

export function describePushError(raw: string | null | undefined): PushErrorCopy {
  if (!raw || raw.trim() === '') {
    return {
      code: null,
      message: 'The push did not complete, and no reason was recorded for it.',
      // Fail OPEN: an unrecorded reason is not evidence that a retry is futile.
      retryable: true,
      transport: false,
      remedy: null,
    };
  }

  const code = splitCode(raw);
  const entry = CODES[code];
  if (entry) {
    return {
      code,
      message: entry.message,
      retryable: entry.retryable,
      transport: entry.transport ?? false,
      remedy: entry.remedy ?? null,
    };
  }

  // ⚑ Unknown code. It is NEVER printed — a token an operator cannot act on is noise that looks like
  // information. It is named as unclassified, and stays retryable so a new failure class cannot strand
  // anyone before someone gets round to classifying it here.
  return {
    code,
    message: 'The push failed for a reason this screen could not be classified against a known cause.',
    retryable: true,
    transport: false,
    remedy: null,
  };
}

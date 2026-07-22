// AC-TSP-031 [Deno unit] — adapter-dispatch/dispatchErrorStatus.ts: one code→status map for BOTH
// failure exits (adapter-select pre-flight + dispatch commit).
//
// The defect this pins: the timesheet push's fail-closed pre-flight rejections are raised at
// adapter-select, which answered a flat 400 — "malformed request" — for a business rule the server
// understood and refused. Every other pre-flight rejection on this surface answers 422.
//
// Verify: cd supabase/functions/adapter-dispatch && deno test --allow-env --allow-net --allow-read dispatchErrorStatus.test.ts
import { dispatchErrorStatus, isBusinessRejectionCode } from './dispatchErrorStatus.ts';

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

Deno.test('AC-TSP-031: every classified pre-flight BUSINESS rejection is 422, from EITHER exit', () => {
  for (const code of [
    'commit-rejected',
    'config-rejected',
    'cross-org-link-rejected',
    'employee-unlinked',
    'project-unmapped',
    'activity-type-unconfigured',
    'budget-category-unmapped',
    'budget-multi-fiscal-year',
  ]) {
    assert(dispatchErrorStatus(code, 400) === 422, `${code} at adapter-select must be 422, got ${dispatchErrorStatus(code, 400)}`);
    assert(dispatchErrorStatus(code, 500) === 422, `${code} at dispatch must be 422, got ${dispatchErrorStatus(code, 500)}`);
    assert(isBusinessRejectionCode(code), `${code} must classify as a business rejection`);
  }
});

Deno.test('AC-TSP-031: the transport + conflict classes keep their own statuses', () => {
  assert(dispatchErrorStatus('external-unreachable', 400) === 502, 'unreachable is 502');
  assert(dispatchErrorStatus('command-held', 500) === 409, 'held is a 409 conflict');
  assert(dispatchErrorStatus('command-in-flight-for-record', 500) === 409, 'in-flight is a 409 conflict');
});

Deno.test('AC-TSP-031: an UNCLASSIFIED code keeps the caller\'s own fallback — never optimistically re-labelled', () => {
  assert(dispatchErrorStatus('BINDING_NOT_FOUND', 400) === 400, 'adapter-select fallback stays 400');
  assert(dispatchErrorStatus('42501', 500) === 500, 'dispatch fallback stays 500');
  assert(dispatchErrorStatus(undefined, 500) === 500, 'a code-less failure keeps the fallback');
  assert(!isBusinessRejectionCode(undefined), 'undefined is not a business rejection');
});

// ⚑ HIGH-1 (audit round 5) — a DRAFT Budget occupying the grain is a business refusal, not a malformed
// request: the body was fine, the client's own ERP state refuses it, and no retry can change that until
// a human submits or deletes that draft. It is raised inside ADAPTER SELECT (`resolveBudgetRefs`), whose
// unclassified fallback is 400 — so without being classified here the operator got "bad request" for a
// state that has a precise, named remedy.
Deno.test('AC-BUD-033 `budget-draft-rival-on-grain` is a 422 business rejection at BOTH exits, never the 400/500 fallback', () => {
  assert(dispatchErrorStatus('budget-draft-rival-on-grain', 400) === 422, 'the adapter-select exit must answer 422, not its 400 fallback');
  assert(dispatchErrorStatus('budget-draft-rival-on-grain', 500) === 422, 'the dispatch exit must answer 422, not its 500 fallback');
  assert(isBusinessRejectionCode('budget-draft-rival-on-grain'), 'it is a classified business rejection');
});

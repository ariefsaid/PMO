// compose-view/index.ts body-shape guard [Deno unit] — a parsed JSON body that is not a
// non-null object (the literal JSON `null`, a string, number, boolean, or array) is rejected
// 400 before the handler is reached, instead of surfacing as an unhandled failure inside the
// handler (T-10 #1538 slice 2). Proven against the REAL shipped entrypoint module: the guard
// is the same exported function the Deno.serve wrapper consults, never a copy.
//
// Verify: cd supabase/functions/compose-view && deno test index.test.ts --config deno.json
//
// Every case is a registered Deno.test so a green run reports the cases it ran — top-level
// asserts still fail the run on throw, but display as "0 passed | 0 failed", the same
// "looks like an empty suite" trap the pgTAP gates warn about.

// Stub Deno.serve BEFORE the dynamic import of index.ts (the module wires its handler through
// serveWithErrorReporting at top level — mirror of clickup-webhook/index.test.ts's stance).
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { isComposeViewRequestBody } = await import('./index.ts');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const NON_OBJECT_BODIES: Array<[string, unknown]> = [
  ['JSON null', null],
  ['a JSON string', 'show projects'],
  ['a JSON number', 42],
  ['a JSON boolean', true],
  ['a JSON array', [{ prompt: 'show projects' }]],
];

Deno.test('body-shape guard rejects every parsed body that is not a non-null object', () => {
  for (const [label, value] of NON_OBJECT_BODIES) {
    assert(!isComposeViewRequestBody(value), `guard must reject ${label}`);
  }
});

Deno.test('body-shape guard accepts a well-formed body object', () => {
  // Extra/mistyped properties are the handler's concern, not the shape guard's.
  assert(
    isComposeViewRequestBody({ prompt: 'show projects', orgId: 'org-1' }),
    'guard must accept a well-formed body object',
  );
  assert(isComposeViewRequestBody({ prompt: 123 }), 'guard accepts any object; field typing is the handler gate');
});

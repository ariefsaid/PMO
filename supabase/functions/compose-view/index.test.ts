// compose-view/index.ts body-shape guard [Deno unit] — a parsed JSON body that is not a
// non-null object (the literal JSON `null`, a string, number, boolean, or array) is rejected
// 400 before the handler is reached, instead of surfacing as an unhandled failure inside the
// handler (T-10 #1538 slice 2). Proven against the REAL shipped entrypoint module: the guard
// is the same exported function the Deno.serve wrapper consults, never a copy.
//
// Verify: cd supabase/functions/compose-view && deno test index.test.ts --config deno.json

// Stub Deno.serve BEFORE the dynamic import of index.ts (the module wires its handler through
// serveWithErrorReporting at top level — mirror of clickup-webhook/index.test.ts's stance).
(Deno as unknown as { serve: (...a: unknown[]) => unknown }).serve = () => ({ finished: Promise.resolve() });
const { isComposeViewRequestBody } = await import('./index.ts');

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

// A parsed body that is not a non-null object must be rejected.
for (const [label, value] of [
  ['JSON null', null],
  ['a JSON string', 'show projects'],
  ['a JSON number', 42],
  ['a JSON boolean', true],
  ['a JSON array', [{ prompt: 'show projects' }]],
] as Array<[string, unknown]>) {
  assert(!isComposeViewRequestBody(value), `guard must reject ${label}`);
}

// A well-formed body object passes (extra properties are the handler's concern, not the shape guard's).
assert(
  isComposeViewRequestBody({ prompt: 'show projects', orgId: 'org-1' }),
  'guard must accept a well-formed body object',
);
assert(isComposeViewRequestBody({ prompt: 123 }), 'guard accepts any object; field typing is the handler gate');

console.log('compose-view/index.test.ts: body-shape guard OK');

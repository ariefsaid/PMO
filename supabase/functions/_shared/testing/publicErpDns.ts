/** Test-only resolver fixture for edge suites that mock ERP HTTP but do not exercise DNS. */
const deno = Deno as unknown as {
  test: (...args: unknown[]) => unknown;
  resolveDns: typeof Deno.resolveDns;
};
const registerTest = deno.test.bind(Deno) as (definition: Record<string, unknown>) => unknown;

deno.test = ((nameOrDefinition: string | Record<string, unknown>, fn?: (t?: unknown) => unknown) => {
  const definition = typeof nameOrDefinition === 'string'
    ? { name: nameOrDefinition, fn }
    : nameOrDefinition;
  const testFn = definition.fn as (t?: unknown) => unknown;
  return registerTest({
    ...definition,
    async fn(t?: unknown) {
      const originalResolveDns = deno.resolveDns;
      deno.resolveDns = (async (_hostname: string, _recordType: string) => ['203.0.113.10']) as typeof Deno.resolveDns;
      try {
        await testFn(t);
      } finally {
        deno.resolveDns = originalResolveDns;
      }
    },
  });
}) as (...args: unknown[]) => unknown;

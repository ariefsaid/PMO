/**
 * The slice of the Deno runtime global that the edge-function modules shared with the app
 * (`supabase/functions/_shared/*`, `adapter-dispatch/*`) read. Lets `tsc` check those modules
 * under the app's Node/browser config; at runtime they read the real Deno global (or a test's
 * stand-in on `globalThis`).
 */
declare const Deno: {
  env: { get(name: string): string | undefined };
  errors: { NotFound: new (message?: string) => Error };
};

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { getCallerJwt, runWithDeputy } from "../server/lib/deputy-store";
import { createCallerClient, createVerifierClient } from "../server/lib/supabase";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const originalEnv = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

afterEach(() => {
  process.env.SUPABASE_URL = originalEnv.SUPABASE_URL;
  process.env.SUPABASE_ANON_KEY = originalEnv.SUPABASE_ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = originalEnv.SUPABASE_SERVICE_ROLE_KEY;
});

describe("deputy context", () => {
  it("AC-402 exposes the raw caller JWT only inside runWithDeputy", async () => {
    expect(getCallerJwt()).toBeUndefined();

    await runWithDeputy(
      {
        rawJwt: "raw-caller-jwt",
        userId: "user-1",
        email: "user@example.com",
        orgId: "org-1",
        role: "Admin",
      },
      async () => {
        expect(getCallerJwt()).toBe("raw-caller-jwt");
        await Promise.resolve();
        expect(getCallerJwt()).toBe("raw-caller-jwt");
      },
    );

    expect(getCallerJwt()).toBeUndefined();
  });

  it("AC-402 builds the caller client with anon+JWT and confines service_role construction to createVerifierClient", async () => {
    process.env.SUPABASE_URL = "http://127.0.0.1:54321";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    const callerClient = createCallerClient("raw-caller-jwt") as unknown as {
      supabaseKey: string;
      headers: { Authorization?: string };
      rest: { headers: Headers };
    };
    expect(callerClient.supabaseKey).toBe("anon-key");
    expect(callerClient.headers.Authorization).toBe("Bearer raw-caller-jwt");
    expect(callerClient.rest.headers.get("Authorization")).toBe("Bearer raw-caller-jwt");

    const verifierClient = createVerifierClient() as unknown as { supabaseKey: string };
    expect(verifierClient.supabaseKey).toBe("service-role-key");

    const serverFiles = [
      "server/lib/deputy-store.ts",
      "server/lib/supabase.ts",
      "server/middleware/deputy.ts",
      "server/plugins/agent-native.ts",
      "server/actions/pmo-query.ts",
    ];
    const strippedSources = await Promise.all(
      serverFiles.map(async (file) => [file, stripComments(await readFile(resolve(projectRoot, file), "utf8"))] as const),
    );

    const serviceRoleReferencesOutsideSupabase = strippedSources
      .filter(([file]) => file !== "server/lib/supabase.ts")
      .filter(([, source]) => /SUPABASE_SERVICE_ROLE_KEY|createVerifierClient/.test(source));
    expect(serviceRoleReferencesOutsideSupabase).toEqual([]);

    const supabaseSource = strippedSources.find(([file]) => file === "server/lib/supabase.ts")?.[1] ?? "";
    expect(supabaseSource).toMatch(/function createVerifierClient\(/);
    expect(supabaseSource).toMatch(/const serviceRoleKey = process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    expect(supabaseSource).toMatch(/function createCallerClient\(rawJwt: string\)/);
    expect(supabaseSource).toMatch(/const anonKey = process\.env\.SUPABASE_ANON_KEY/);
    expect(supabaseSource).toMatch(/Authorization: `Bearer \$\{rawJwt\}`/);
  });
});

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/.*$/gm, "");
}

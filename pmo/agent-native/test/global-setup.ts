/**
 * globalSetup — boot the Nitro sidecar once for the gate test run.
 *
 * Spawns `nitro dev --port 8100` as a child process, waits for the server to
 * answer on the health/action URL, and tears it down when the run finishes.
 * The full deputy chain (deputy middleware → AsyncLocalStorage → agent-native
 * handler → pmo_query action → Supabase RLS) is exactly what the gate must
 * exercise, so we drive the action over real HTTP rather than calling `run`
 * directly.
 *
 * The base URL is exposed to tests via the `SIDECAR_URL` env var (Vitest keeps
 * the globalSetup process env and the test-file env in the same process for our
 * config — but to be robust we also export a well-known constant).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SIDECAR_URL = "http://127.0.0.1:8100";

let server: ChildProcess | undefined;

async function waitForServer(url: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const anon =
    process.env.SUPABASE_ANON_KEY ??
    // fall back to the local-dev anon key baked into .env (loaded below)
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
  while (Date.now() < deadline) {
    try {
      // A bare GET on the action endpoint returns 405 once the server is up.
      const res = await fetch(`${url}/_agent-native/actions/pmo_query`, {
        method: "GET",
        headers: { apikey: anon },
      });
      // 405 (method not allowed) means the route is mounted and serving.
      if (res.status === 405 || res.status === 401 || res.status === 400) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Nitro sidecar did not become ready at ${url} within ${timeoutMs}ms`);
}

export async function setup(): Promise<void> {
  // Load .env into this process so the spawned nitro inherits it.
  await loadEnv();
  // Make sure the gate test can read the base URL regardless of env propagation.
  process.env.SIDECAR_URL = SIDECAR_URL;

  server = spawn(
    "node",
    [resolve(projectRoot, "node_modules/nitro/dist/cli/index.mjs"), "dev", "--port", "8100"],
    {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PORT: "8100" },
    },
  );

  // Surface server logs if boot fails.
  server.stdout?.on("data", (d: Buffer) => process.stderr.write(`[nitro] ${d}`));
  server.stderr?.on("data", (d: Buffer) => process.stderr.write(`[nitro!] ${d}`));

  await waitForServer(SIDECAR_URL);
  process.stderr.write(`[globalSetup] Nitro sidecar ready at ${SIDECAR_URL}\n`);
}

export async function teardown(): Promise<void> {
  if (server) {
    process.stderr.write("[globalSetup] shutting down Nitro sidecar\n");
    server.kill("SIGTERM");
    await new Promise<void>((res) => {
      server?.once("exit", () => res());
      setTimeout(() => {
        server?.kill("SIGKILL");
        res();
      }, 10_000);
    });
    server = undefined;
  }
}

/** Minimal .env loader (no dotenv dep) — only SUPABASE_* / keys needed by nitro. */
async function loadEnv(): Promise<void> {
  const { readFile } = await import("node:fs/promises");
  try {
    const raw = await readFile(resolve(projectRoot, ".env"), "utf8");
    for (const line of raw.split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && m[1] && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {
    // .env optional if env already exported
  }
}

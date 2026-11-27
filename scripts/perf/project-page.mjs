/* global window, document, MutationObserver */
/** Production navigation probe. Run under scripts/with-db-lock.sh after vite build.
 * PERF_URL, PERF_ROUTE, PERF_EMAIL, PERF_PASSWORD, PERF_OUTPUT are explicit inputs.
 * Output contains private runtime diagnostics; always choose an ignored/external directory.
 * Five fresh contexts per mode; auth is installed before navigation, HTTP cache disabled.
 */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(resolve("pmo-portal/package.json"));
const { chromium } = require("playwright");
const base = process.env.PERF_URL ?? "http://localhost:3218";
const output = process.env.PERF_OUTPUT;
if (!output || !process.env.PERF_EMAIL || !process.env.PERF_PASSWORD)
  throw Error(
    "Supply PERF_OUTPUT (private directory), PERF_EMAIL and PERF_PASSWORD",
  );
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const login = await browser.newContext();
const page = await login.newPage();
let apiHeaders, apiUrl;
page.on("request", (r) => {
  if (r.url().includes("/rest/v1/profiles")) {
    apiHeaders = r.headers();
    apiUrl = r.url();
  }
});
await page.goto(base + "/login");
await page.getByLabel(/email/i).fill(process.env.PERF_EMAIL);
await page.getByLabel(/password/i).fill(process.env.PERF_PASSWORD);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(base + "/", { timeout: 60000 });
await page.waitForTimeout(3000);
if (apiUrl && !["localhost", "127.0.0.1"].includes(new URL(apiUrl).hostname))
  throw Error("Probe requires local database");
if (!apiUrl) throw Error("Profile request not observed");
const profileResponse = await login.request.get(apiUrl, {
  headers: apiHeaders,
});
const payload = await profileResponse.json();
const profile = Array.isArray(payload) ? payload[0] : payload;
if (!profile) throw Error("No profile");
const endpoint = new URL(apiUrl);
endpoint.search = "id=eq." + profile.id;
const changed = await login.request.patch(endpoint.href, {
  headers: apiHeaders,
  data: { locale: "id" },
});
if (!changed.ok())
  throw Error(
    "Cannot set profile locale: " +
      changed.status() +
      " " +
      (await changed.text()),
  );
const storageState = await login.storageState();
await login.close();
const results = [];
try {
  for (const throttled of process.env.PERF_MODE === "4x"
    ? [true]
    : process.env.PERF_MODE === "1x"
      ? [false]
      : [true, false])
    for (let run = 1; run <= Number(process.env.PERF_RUNS ?? 5); run++) {
      const context = await browser.newContext({
        storageState,
        viewport: { width: 1440, height: 1000 },
        locale: "en-US",
        timezoneId: "UTC",
        serviceWorkers: "block",
      });
      await context.addInitScript(() => {
        window.__perf = { marks: [], longTasks: [], commits: [] };
        window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
          supportsFiber: true,
          inject: () => 1,
          onCommitFiberRoot: (_id, root) => {
            const names = [];
            function walk(f) {
              if (!f) return;
              const n = f.type?.displayName || f.type?.name;
              if (n) names.push({ name: n, mount: !f.alternate });
              walk(f.child);
              walk(f.sibling);
            }
            walk(root.current);
            window.__perf.commits.push({ at: performance.now(), names });
          },
          onCommitFiberUnmount: () => {},
        };
        new PerformanceObserver((l) =>
          l.getEntries().forEach((e) =>
            window.__perf.longTasks.push({
              at: e.startTime,
              duration: e.duration,
              name: e.name,
            }),
          ),
        ).observe({ type: "longtask", buffered: true });
        const seen = new Set();
        function check() {
          for (const [name, selector] of [
            ["shell", "nav"],
            ["heading", "main h1:not(.sr-only)"],
            ["period", "button,[role=combobox],label"],
          ]) {
            if (seen.has(name)) continue;
            const elements = [...document.querySelectorAll(selector)];
            if (
              elements.some(
                (e) =>
                  e.getBoundingClientRect().height > 0 &&
                  (name !== "period" || /Periode/.test(e.textContent)),
              )
            ) {
              seen.add(name);
              window.__perf.marks.push({ name, at: performance.now() });
            }
          }
        }
        new MutationObserver(check).observe(document, {
          childList: true,
          subtree: true,
          attributes: true,
        });
      });
      const p = await context.newPage();
      if (process.env.PERF_STATEMENT_FIXTURE === "1") {
        const { installRoutes } =
          await import("../../pmo-portal/e2e/support/financial-statement-fixtures.ts");
        await installRoutes(p, {
          projectId: "41000000-0000-0000-0000-000000000001",
        });
      }
      const cdp = await context.newCDPSession(p);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      await cdp.send("Emulation.setCPUThrottlingRate", {
        rate: throttled ? 4 : 1,
      });
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: throttled ? 165 : 0,
        downloadThroughput: throttled ? (9000000 / 8) * 0.9 : -1,
        uploadThroughput: throttled ? (1500000 / 8) * 0.9 : -1,
        connectionType: "cellular4g",
      });
      const requests = [];
      cdp.on("Network.requestWillBeSent", (e) =>
        requests.push({
          method: e.request.method,
          time: e.timestamp,
          wall: e.wallTime,
          path: new URL(e.request.url).pathname,
          initiator: e.initiator,
        }),
      );
      const trace = [];
      cdp.on("Tracing.dataCollected", (e) => trace.push(...e.value));
      await cdp.send("Tracing.start", {
        categories:
          "devtools.timeline,v8.execute,blink.user_timing,disabled-by-default-devtools.timeline,disabled-by-default-v8.cpu_profiler",
        options: "sampling-frequency=10000",
      });
      await cdp.send("Profiler.enable");
      await cdp.send("Profiler.start");
      await p.goto(
        base +
          (process.env.PERF_ROUTE ??
            "/projects/41000000-0000-0000-0000-000000000001/overview"),
        { waitUntil: "domcontentloaded", timeout: 120000 },
      );
      let periodError = null;
      try {
        await p
          .getByText("Periode", { exact: true })
          .first()
          .waitFor({ state: "visible", timeout: 30000 });
      } catch (error) {
        periodError = error.message;
      }
      await p.screenshot({
        path: resolve(output, (throttled ? "4x" : "1x") + "-" + run + ".png"),
      });
      await p.waitForTimeout(1500);
      const data = await p.evaluate(() => ({
        ...window.__perf,
        lifecycle: performance
          .getEntriesByType("mark")
          .filter((e) => e.name.startsWith("perf:"))
          .map((e) => ({ name: e.name, at: e.startTime })),
        paints: performance
          .getEntriesByType("paint")
          .map((e) => ({ name: e.name, at: e.startTime })),
        timeOrigin: performance.timeOrigin,
        language: document.documentElement.lang,
      }));
      const cpu = await cdp.send("Profiler.stop");
      const ended = new Promise((r) => cdp.once("Tracing.tracingComplete", r));
      await cdp.send("Tracing.end");
      await ended;
      const label = (throttled ? "4x" : "1x") + "-" + run;
      const result = {
        browser: browser.version(),
        fixture: process.env.PERF_STATEMENT_FIXTURE === "1",
        throttle: {
          cpu: throttled ? 4 : 1,
          latency: throttled ? 165 : 0,
          downloadBytesPerSecond: throttled ? 1012500 : -1,
        },
        label,
        periodError,
        ...data,
        requests: requests.map((r) => ({
          ...r,
          at: r.wall * 1000 - data.timeOrigin,
        })),
      };
      results.push(result);
      await writeFile(resolve(output, label + ".json"), JSON.stringify(result));
      await writeFile(
        resolve(output, label + ".trace.json"),
        JSON.stringify({ traceEvents: trace }),
      );
      await writeFile(
        resolve(output, label + ".cpuprofile"),
        JSON.stringify(cpu.profile),
      );
      console.log(
        JSON.stringify({
          label,
          marks: data.marks,
          paints: data.paints,
          longTasks: data.longTasks.length,
          language: data.language,
        }),
      );
      await context.close();
    }
  await writeFile(resolve(output, "results.json"), JSON.stringify(results));
} finally {
  const cleanup = await browser.newContext({ storageState });
  const restored = await cleanup.request.patch(endpoint.href, {
    headers: apiHeaders,
    data: { locale: profile.locale },
  });
  if (!restored.ok())
    console.error("Profile restore failed", restored.status());
  await browser.close();
}

/** Build-only diagnostic marks. Source bytes are restored even on build failure.
 * Run from repo root before project-page.mjs; no runtime behavior is changed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const files = [
  "pmo-portal/App.tsx",
  "pmo-portal/pages/project-detail/ProjectDetail.tsx",
  "pmo-portal/src/lib/queryClient.ts",
  "pmo-portal/src/auth/RequireAuth.tsx",
];
const originals = files.map((path) => readFileSync(path, "utf8"));
try {
  for (let i = 0; i < files.length; i++) {
    let source = originals[i];
    for (const name of i === 0
      ? ["Shell", "ShellChrome", "ShellGate"]
      : i === 1
        ? ["ProjectDetail"]
        : []) {
      const needle = name + ": React.FC = () => {";
      if (!source.includes(needle))
        throw Error("Instrumentation target changed: " + name);
      source = source.replace(
        needle,
        needle +
          `\n React.useLayoutEffect(() => { performance.mark("perf:${name}:mount"); return () => { performance.mark("perf:${name}:unmount"); }; }, []);\n performance.mark("perf:${name}:render");`,
      );
    }
    if (i === 2)
      source += `\nqueryClient.getQueryCache().subscribe(e => { performance.mark("perf:query:"+e.type+":"+e.query.queryKey[0]+":"+("action" in e ? e.action.type : "")); });\n`;
    if (i === 3)
      source = source.replace(
        "if (loading) return <AuthLoading />;",
        `performance.mark("perf:RequireAuth:loading="+loading+":orgReady="+orgDefaultsReady);\n  if (loading) return <AuthLoading />;`,
      );
    writeFileSync(files[i], source);
  }
  const result = spawnSync("npx", ["vite", "build", "--sourcemap"], {
    cwd: "pmo-portal",
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) throw Error("Build failed: " + result.status);
} finally {
  files.forEach((path, i) => writeFileSync(path, originals[i]));
}

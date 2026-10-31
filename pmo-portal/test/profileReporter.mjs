// profileReporter.mjs — one-off suite profiler for issue #1584 scope item 4
// (unit-suite speed). NOT part of any gate; run explicitly:
//
//   VITEST_PROFILE_OUT=/tmp/profile.json \
//     npx vitest run --reporter=default --reporter=./test/profileReporter.mjs
//
// Captures per-file Vitest diagnostics (environment setup, prepare, collect,
// setup file, run time) + the heaviest imported modules per file, then writes
// JSON to $VITEST_PROFILE_OUT (default: /tmp/vitest-profile.json) and prints a
// summary. Read-only observer — it never mutates results.
const TOP_IMPORTS_PER_FILE = 5;
const TOP_FILES_PRINTED = 25;

const countTests = (task) => {
  let n = 0;
  for (const child of task.tasks ?? []) n += child.type === 'test' ? 1 : countTests(child);
  return n;
};

export default class ProfileReporter {
  onInit(vitest) {
    this.vitest = vitest;
  }

  onTestRunStart() {
    this.startedAt = Date.now();
    this.files = [];
  }

  onTestModuleEnd(testModule) {
    // raw File task: setupDuration, collectDuration, prepareDuration,
    // environmentLoad, result.duration.
    const t = testModule.task;
    const d = testModule.diagnostic();
    const imports = Object.entries(d.importDurations ?? {})
      .map(([id, t]) => ({ id, selfTime: t.selfTime, totalTime: t.totalTime, external: t.external ?? false }))
      .sort((a, b) => b.totalTime - a.totalTime)
      .slice(0, TOP_IMPORTS_PER_FILE);
    this.files.push({
      file: testModule.moduleId,
      project: testModule.project.name,
      tests: countTests(t),
      duration: d.duration,
      environmentSetup: d.environmentSetupDuration,
      prepare: d.prepareDuration,
      collect: d.collectDuration,
      setupFile: d.setupDuration,
      importDurations: imports,
    });
  }

  async onTestRunEnd(testModules, unhandledErrors, reason) {
    const wallMs = Date.now() - this.startedAt;
    // importDurations are finalised only at run end — backfill from the final
    // TestModule wrappers (per-file phase numbers above were final at module end).
    const finalImports = new Map();
    for (const m of testModules) {
      try {
        finalImports.set(m.moduleId, m.diagnostic().importDurations ?? {});
      } catch {
        // profiling only
      }
    }
    const sum = (sel) => this.files.reduce((a, f) => a + (f[sel] ?? 0), 0);
    const byProject = {};
    for (const f of this.files) {
      const p = (byProject[f.project] ??= { files: 0, tests: 0, environmentSetup: 0, prepare: 0, collect: 0, setupFile: 0, duration: 0 });
      p.files += 1;
      p.tests += f.tests;
      for (const k of ['environmentSetup', 'prepare', 'collect', 'setupFile', 'duration']) p[k] += f[k] ?? 0;
    }
    // Transform flavour for the heaviest collectors (experimental API; optional).
    const transformProbe = [];
    const heaviest = [...this.files].sort((a, b) => (b.collect ?? 0) - (a.collect ?? 0)).slice(0, 8);
    for (const f of heaviest) {
      try {
        const d = await this.vitest.experimental_getSourceModuleDiagnostic(f.file);
        const modules = [...(d?.modules ?? []), ...(d?.untrackedModules ?? [])];
        transformProbe.push({
          file: f.file,
          transformTimeSumMs: Math.round(modules.reduce((a, m) => a + (m.transformTime ?? 0), 0)),
          moduleCount: modules.length,
        });
      } catch {
        // experimental API unavailable — profiling only, ignore
      }
    }

    const perFileWall = (f) =>
      (f.environmentSetup ?? 0) + (f.prepare ?? 0) + (f.collect ?? 0) + (f.setupFile ?? 0) + (f.duration ?? 0);
    for (const f of this.files) {
      const imports = finalImports.get(f.file) ?? {};
      f.importDurations = Object.entries(imports)
        .map(([id, t]) => ({ id, selfTime: t.selfTime, totalTime: t.totalTime, external: t.external ?? false }))
        .sort((a, b) => b.totalTime - a.totalTime)
        .slice(0, TOP_IMPORTS_PER_FILE);
    }
    const summary = {
      reason,
      wallMs,
      startedAt: this.startedAt,
      files: this.files.length,
      tests: this.files.reduce((a, f) => a + f.tests, 0),
      unhandledErrors: unhandledErrors?.length ?? 0,
      totalsMs: {
        environmentSetup: sum('environmentSetup'),
        prepare: sum('prepare'),
        collect: sum('collect'),
        setupFile: sum('setupFile'),
        run: sum('duration'),
      },
      byProject,
      transformProbe,
      perFile: this.files.map((f) => ({ ...f, wall: perFileWall(f) })).sort((a, b) => b.wall - a.wall),
    };
    const out = process.env.VITEST_PROFILE_OUT ?? '/tmp/vitest-profile.json';
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(summary, null, 1));
      console.log(`[profileReporter] wrote ${out} (${summary.files} files, ${summary.tests} tests)`);
    } catch (e) {
      console.error(`[profileReporter] FAILED to write ${out}: ${e.message}`);
    }
    console.log(`[profileReporter] wall=${(wallMs / 1000).toFixed(1)}s totalsMs=`, summary.totalsMs);
    console.log(`[profileReporter] byProject=`, byProject);
    console.log(`[profileReporter] top ${TOP_FILES_PRINTED} files by per-file wall:`);
    for (const f of summary.perFile.slice(0, TOP_FILES_PRINTED)) {
      console.log(
        `  ${String(f.wall).padStart(7)}ms  ${f.project.padEnd(5)}  ${f.tests}t  ${f.file.replace(/^.*pmo-portal\//, '')}`,
      );
    }
  }
}

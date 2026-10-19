import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Reporter, TestCase, TestModule } from 'vitest/node';

type RunEnd = NonNullable<Reporter['onTestRunEnd']>;
type RunEndReason = Parameters<RunEnd>[2];
type Shard = { index: number; total: number } | null;

type UnitResult = {
  project: string;
  file: string;
  fullTitle: string;
  titlePath: string[];
  repeatIndex: number;
  mode: TestCase['options']['mode'];
  status: 'passed' | 'failed' | 'skipped' | 'not_run';
};

function validText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !containsControlCharacters(value);
}

function containsControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
  });
}

function compareCodepoint(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizedRelativeFile(value: string): string | null {
  if (containsControlCharacters(value)) return null;
  const slashPath = value.replaceAll('\\', '/');
  if (slashPath.startsWith('/') || /^[a-zA-Z]:\//.test(slashPath)) return null;
  const parts = slashPath.split('/');
  const parentCount = parts.filter((part) => part === '..').length;
  if (parentCount > 1 || parts.some((part, index) => part === '..' && index !== 0)) return null;
  const normalized = path.posix.normalize(slashPath);
  if (!normalized || normalized === '.' || normalized.startsWith('../..')) return null;
  return normalized;
}

function titlePathFor(testCase: TestCase): string[] | null {
  const suites: string[] = [];
  let parent = testCase.parent;
  while (parent.type === 'suite') {
    suites.unshift(parent.name);
    parent = parent.parent;
  }
  const titlePath = [...suites, testCase.name];
  return titlePath.length > 0 && titlePath.every(validText) ? titlePath : null;
}

function resultFor(testCase: TestCase): UnitResult | null {
  const project = testCase.project.name;
  const file = normalizedRelativeFile(testCase.module.relativeModuleId);
  const titlePath = titlePathFor(testCase);
  const fullTitle = testCase.fullName;
  if (!validText(project) || !file || !titlePath || !validText(fullTitle)) return null;
  const state = testCase.result().state;
  const status = state === 'pending' ? 'not_run' : state;
  return {
    project,
    file,
    fullTitle,
    titlePath,
    repeatIndex: 0,
    mode: testCase.options.mode,
    status,
  };
}

function shardFromArgs(args: readonly string[]): Shard | undefined {
  let value: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--shard=')) value = args[index].slice('--shard='.length);
    else if (args[index] === '--shard') value = args[index + 1];
  }
  if (value === undefined) return null;
  const match = /^(\d+)\/(\d+)$/.exec(value);
  if (!match) return undefined;
  const index = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(index) || !Number.isSafeInteger(total) || index < 1 || total < 1 || index > total) return undefined;
  return { index, total };
}

function reportFilename(shard: Shard | undefined): string {
  if (!shard) return 'unit-shard-unassigned.json';
  return `unit-shard-${shard.index}-of-${shard.total}.json`;
}

export default class UnitShardReporter implements Reporter {
  async onTestRunEnd(...args: Parameters<RunEnd>): Promise<void> {
    const [testModules, unhandledErrors, reason] = args;
    const shard = shardFromArgs(process.argv);
    const tests: UnitResult[] = [];
    let invalidResultCount = 0;
    for (const testModule of testModules) {
      for (const testCase of testModule.children.allTests()) {
        const result = resultFor(testCase);
        if (result) tests.push(result);
        else invalidResultCount += 1;
      }
    }
    tests.sort((left, right) => compareCodepoint(
      JSON.stringify([left.project, left.file, left.fullTitle, left.repeatIndex]),
      JSON.stringify([right.project, right.file, right.fullTitle, right.repeatIndex]),
    ));
    const collectionOutcome = testModules.length > 0
      && testModules.every((module: TestModule) => module.errors().length === 0)
      && unhandledErrors.length === 0
      && invalidResultCount === 0
      ? 'complete'
      : 'incomplete';
    const runOutcome: RunEndReason = shard === undefined ? 'failed' : reason;
    const artifact = {
      schemaVersion: 1,
      shard: shard ?? null,
      collectionOutcome,
      runOutcome,
      tests,
    };
    await writeFile(path.join(process.cwd(), reportFilename(shard)), `${JSON.stringify(artifact, null, 2)}\n`);
  }
}

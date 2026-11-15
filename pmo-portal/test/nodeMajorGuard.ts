// #2215: unit tests give false reds on a Node major other than the one CI runs (localStorage differs
// under Node 26). The expected major is parsed from package.json `engines.node`, never hand-copied.
import pkg from '../package.json';

export function expectedNodeMajor(enginesNode: string): number {
  const match = /(\d+)\./.exec(enginesNode) ?? /(\d+)/.exec(enginesNode);
  if (!match) throw new Error(`cannot read a Node major from package.json engines.node "${enginesNode}"`);
  return Number(match[1]);
}

export function assertNodeMajor(actualVersion: string, enginesNode: string = pkg.engines.node): void {
  const expected = expectedNodeMajor(enginesNode);
  const actual = Number(actualVersion.replace(/^v/, '').split('.')[0]);
  if (actual !== expected) {
    throw new Error(`Vitest needs Node ${expected} (package.json engines "${enginesNode}"), found Node ${actual}; switch Node major and rerun.`);
  }
}

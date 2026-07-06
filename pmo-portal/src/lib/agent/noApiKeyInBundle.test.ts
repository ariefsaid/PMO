/**
 * AC-AR-010 / AC-MC-010: no ANTHROPIC_API_KEY or OPENROUTER_API_KEY literal appears
 * anywhere under pmo-portal/.
 * NFR-AR-SEC-001 / NFR-MC-SEC-001: keys live only in the respective edge-function secret.
 */
import { it, expect } from 'vitest';
import { runNegativeGrep } from './testGrep';

it('AC-AR-010 no ANTHROPIC_API_KEY literal appears anywhere under pmo-portal/', () => {
  // Exclude this test file itself (the key appears here only inside the grep argument string).
  const matches = runNegativeGrep('ANTHROPIC_API_KEY', {
    cwd: process.cwd(),
    excludeGlobs: ['noApiKeyInBundle.test.ts'],
  });
  expect(matches.trim()).toBe('');
});

it('AC-MC-010 no OPENROUTER_API_KEY literal appears anywhere under pmo-portal/', () => {
  const matches = runNegativeGrep('OPENROUTER_API_KEY', {
    cwd: process.cwd(),
    // errorLog.test.ts / errorEvent.test.ts / telegramNotify.test.ts reference the
    // MISSING_OPENROUTER_API_KEY error CODE string (harden #1 / observability floor
    // DC-OF-001) — not the key value or an env-var read, so it carries no bundling
    // risk; excluded the same way this gate excludes itself.
    //
    // The agent eval harness (evals/** — ADR-0052) references OPENROUTER_API_KEY as an
    // env-var NAME only in its README (the env-var contract for the optional llmJudge
    // scorer), never a key value. The harness is NOT part of the FE bundle (it lives
    // under evals/, is excluded from the default Vitest project + the production build,
    // and runs only via `npm run test:evals` in the dedicated nightly/dispatch workflow).
    // Excluded here on the same intent-preserving basis as errorLog.test.ts.
    excludeGlobs: ['noApiKeyInBundle.test.ts', 'errorLog.test.ts', 'errorEvent.test.ts', 'telegramNotify.test.ts', 'README.md'],
    excludeDirs: ['evals'],
  });
  expect(matches.trim()).toBe('');
});

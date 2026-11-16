/**
 * #2047 / #2392 — the panel's own strings come from the `assistantPanel` catalogue, never from a
 * literal in the component: a literal renders English under Bahasa. Red when a listed English
 * string reappears in a panel source, or a key lacks a real Indonesian value.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');
const en = JSON.parse(read('../../../public/locales/en/assistantPanel.json'));
const id = JSON.parse(read('../../../public/locales/id/assistantPanel.json'));

const KEYS = [
  'panelTitle', 'send', 'stop', 'retry', 'placeholder', 'working', 'errorTitle', 'errorBody',
  'sendLabel', 'stopLabel', 'askLabel',
];
const SOURCES = ['AssistantPanel.tsx', 'PromptBar.tsx', 'Thinking.tsx'];
const ENGLISH_LITERALS = [
  />\s*Assistant\s*</, />\s*Send\s*</, />\s*Stop\s*</, />\s*Retry\s*</,
  /Something went wrong/, /Couldn't get an answer/, /Working on your answer['…]/,
  /'Ask a question…'/, /aria-label="(Retry|Send message|Stop generating|Ask a question)"/,
  /^\s*(Assistant|Send|Stop|Retry)\s*$/m,
];

describe('assistant panel strings are translated', () => {
  it.each(KEYS)('key %s has an Indonesian value that differs from English', (k) => {
    expect(typeof en[k]).toBe('string');
    expect(typeof id[k]).toBe('string');
    expect(id[k].length).toBeGreaterThan(0);
    expect(id[k]).not.toBe(en[k]);
  });

  it.each(SOURCES)('%s carries no English literal for a panel string', (f) => {
    // An English default inside a `t(key, "default")` call is the fallback, not a literal.
    const src = read(f).replace(/\bt\(\s*'[^']+'\s*,\s*("[^"]*"|'[^']*')\s*\)/g, 't()');
    for (const re of ENGLISH_LITERALS) expect(src, String(re)).not.toMatch(re);
  });
});

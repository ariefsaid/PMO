/**
 * THE NOTIFICATION TRANSLATION GATE. Every title a migration writes into a notification has a template in
 * `notificationTitles.ts`, and every template has text in BOTH languages. A producer added without a template fails here, and
 * so does a template missing a language, so a Bahasa screen never carries an English notification headline.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import en from '../../../public/locales/en/notifications.json';
import id from '../../../public/locales/id/notifications.json';
import { matchNotificationTitle, NOTIFICATION_NOUN_KEYS, NOTIFICATION_TITLE_KEYS } from './notificationTitles';

const text = (catalogue: Record<string, unknown>, path: string): unknown => path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], catalogue);

describe('notification templates carry both languages', () => {
  it.each(NOTIFICATION_TITLE_KEYS)('title %s has English and Bahasa Indonesia text', (key) => {
    for (const [lang, catalogue] of [['en', en], ['id', id]] as const) {
      const value = text(catalogue, `titles.${key}`);
      expect(typeof value === 'string' && value.trim().length > 0, `${lang}: titles.${key}`).toBe(true);
    }
    expect(text(id, `titles.${key}`), `titles.${key} is still English in the Indonesian catalogue`).not.toBe(text(en, `titles.${key}`));
  });

  it.each(NOTIFICATION_NOUN_KEYS)('noun %s has both languages, capitalised and lower-case', (key) => {
    for (const catalogue of [en, id]) {
      expect(typeof text(catalogue, `nouns.${key}`)).toBe('string');
      expect(typeof text(catalogue, `nounsLower.${key}`)).toBe('string');
    }
  });
});

describe('every title the migrations write has a template', () => {
  const dir = join(__dirname, '../../../../supabase/migrations');
  const titles = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, file), 'utf8');
    // notify_workflow_user(org, owner, '<title>', ...) with a plain literal title.
    for (const m of sql.matchAll(/notify_workflow_user\(\s*[\w.]+\s*,\s*[\w.]+\s*,\s*'((?:[^']|'')+)'\s*,/g)) titles.add(m[1].replaceAll("''", "'"));
    // insert into public.notifications (...) values|select (..., '<severity>', '<title>', ...): the first severity literal after it.
    for (const m of sql.matchAll(/insert into (?:public\.)?notifications\b[\s\S]{0,400}?'(?:info|warning|critical)'\s*,\s*'((?:[^']|'')+)'\s*,/g)) titles.add(m[1].replaceAll("''", "'"));
  }
  it('finds the producers', () => expect(titles.size).toBeGreaterThan(15));
  it.each([...titles].sort())('title %j is a registered template', (title) => {
    expect(matchNotificationTitle(title), `no template for "${title}": add it to notificationTitles.ts and both catalogues`).not.toBeNull();
  });
});

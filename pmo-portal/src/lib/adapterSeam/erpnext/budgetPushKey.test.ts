/**
 * budgetPushKey.test.ts — P3c, the DETERMINISTIC activation key (AC-BUD-021, FR-BUD-141, ADR-0059 §4).
 *
 * These assert the two properties the key exists for, both of which are money-wrong when broken:
 *  1. the two originators (the activation consequence and the sweep backstop) derive the SAME key from
 *     the SAME DB truth — including when `budget_versions.activated_at` reaches them RENDERED
 *     DIFFERENTLY, which it does: PostgREST hands the browser `2026-07-16T10:00:00+00:00` while a
 *     server-side/SQL read of the same instant renders `2026-07-16 10:00:00+00`. Two spellings of one
 *     instant ⇒ two keys ⇒ the outbox's `unique (org_id, domain, pmo_record_id, idempotency_key)` does
 *     not fire ⇒ TWO ERP Budgets for one activation;
 *  2. a RE-activation is a DISTINCT key (the OQ-BUD-2 trap): `activate_budget_version` does not check the
 *     current status, so rolling back to an Archived version re-activates it. Keyed on the version id
 *     alone that collides (23505) with that version's ORIGINAL push and is silently suppressed — leaving
 *     ERPNext enforcing the NEWER version's figures while PMO says otherwise.
 */
import { describe, it, expect } from 'vitest';
import { budgetPushKey } from './budgetPushKey';

const VERSION = '3f1b0c9e-1a2b-4c3d-8e4f-5a6b7c8d9e0f';
const OTHER_VERSION = '7c8d9e0f-1a2b-4c3d-8e4f-3f1b0c9e5a6b';

describe('budgetPushKey (AC-BUD-021 — the deterministic activation key)', () => {
  it('AC-BUD-021 derives `bud:<version id>:<activated_at epoch ms>`', () => {
    expect(budgetPushKey(VERSION, '2026-07-16T10:00:00.000Z')).toBe(`bud:${VERSION}:1784196000000`);
  });

  it('AC-BUD-021 both originators derive the IDENTICAL key from the same instant rendered differently', () => {
    const foreground = budgetPushKey(VERSION, '2026-07-16T10:00:00+00:00'); // PostgREST → the browser
    const sweep = budgetPushKey(VERSION, '2026-07-16 10:00:00+00'); // a server-side/SQL read
    const utcZ = budgetPushKey(VERSION, '2026-07-16T10:00:00Z');
    const offset = budgetPushKey(VERSION, '2026-07-16T17:00:00+07:00'); // the SAME instant, another zone

    expect(foreground).toBe(sweep);
    expect(foreground).toBe(utcZ);
    expect(foreground).toBe(offset);
  });

  it('AC-BUD-021 ⚑ a RE-activation (a new stamp) is a DISTINCT command — never silently suppressed', () => {
    const original = budgetPushKey(VERSION, '2026-07-16T10:00:00.000Z');
    const rollbackReactivation = budgetPushKey(VERSION, '2026-07-20T09:00:00.000Z');
    expect(rollbackReactivation).not.toBe(original);
  });

  it('AC-BUD-021 two versions activated at the same instant get distinct keys', () => {
    expect(budgetPushKey(VERSION, '2026-07-16T10:00:00.000Z')).not.toBe(
      budgetPushKey(OTHER_VERSION, '2026-07-16T10:00:00.000Z'),
    );
  });

  it('AC-BUD-021 sub-second precision is preserved (two activations in the same second differ)', () => {
    expect(budgetPushKey(VERSION, '2026-07-16T10:00:00.000Z')).not.toBe(
      budgetPushKey(VERSION, '2026-07-16T10:00:00.500Z'),
    );
  });

  it('AC-BUD-021 ⚑ FAILS CLOSED on an absent stamp — never a shared `bud:<id>:null` key', () => {
    // A never-activated version has activated_at NULL. Minting a key from it would give EVERY future
    // activation of that version the same key, so only the first would ever reach ERP.
    for (const absent of [null, undefined, '']) {
      expect(() => budgetPushKey(VERSION, absent)).toThrowError(/activation stamp/i);
    }
    try {
      budgetPushKey(VERSION, null);
      throw new Error('expected a throw');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('commit-rejected');
    }
  });

  it('AC-BUD-021 ⚑ FAILS CLOSED on an unparseable stamp — never `bud:<id>:NaN`', () => {
    expect(() => budgetPushKey(VERSION, 'not-a-timestamp')).toThrowError(/activation stamp/i);
  });
});

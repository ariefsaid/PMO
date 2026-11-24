import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { can } from '@/src/auth/policy';
import type { Role } from '@/src/auth/AuthContext';
import { ALL_ROLES } from '@/src/auth/coarseRoles';
import en from '@/public/locales/en/common.json';
import id from '@/public/locales/id/common.json';
import billingStepsEn from '@/public/locales/en/billingSteps.json';
import billingStepsId from '@/public/locales/id/billingSteps.json';
import siteReportEn from '@/public/locales/en/siteReport.json';
import siteReportId from '@/public/locales/id/siteReport.json';

vi.mock('@/src/lib/supabase/client', () => ({ supabase: {} }));

import { ORG_SWITCHES } from '@/src/lib/repositories/orgSwitches';
import { ORG_SETTINGS, ORG_SETTING_GROUPS, orgSettingKeys } from './orgSettingsCatalogue';
import { orgSettingText } from './orgSettingsText';

const APP = fileURLToPath(new URL('../..', import.meta.url));
const MIGRATIONS = path.join(APP, '../supabase/migrations');

/**
 * What the code says is an organisation setting, found mechanically so a new one cannot ship unlisted (#2746). Four sources:
 *  1. a setting hook: an exported `use…Settings`, `use…Setting` or `use…Enabled` (not a Save/Set/Update hook or a `…Mutations` bundle)
 *     in `src/hooks` or a `pages/**` hook file;
 *  2. a settings table: every `create table … <name>_setting(s)` in the migrations;
 *  3. an `organizations` switch column: every `alter table organizations … add column <name>_enabled`;
 *  4. an audited setting: every column named in an `audit_org_setting_change(...)` trigger (ADR-0121 says a new setting adds its name there).
 * An entry claims one in `covers`; `IGNORED` states, with a reason, the few that are not a setting a person can change.
 */
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const p = path.join(dir, e.name);
  return e.isDirectory() ? (e.name === 'node_modules' || e.name === 'rollback' ? [] : walk(p)) : [p];
});

export function deriveSettingNames(sources: { hookFiles: string[]; migrations: string[] }): string[] {
  const names = new Set<string>();
  for (const src of sources.hookFiles) {
    for (const m of src.matchAll(/export (?:async )?function (use\w*(?:Settings?|Enabled))\b/g)) {
      if (!/^use(Save|Set|Update)/.test(m[1]) && !/Mutations$/.test(m[1])) names.add(m[1]);
    }
  }
  for (const sql of sources.migrations) {
    for (const m of sql.matchAll(/create table (?:if not exists )?(?:public\.)?(\w*settings?)\b/gi)) names.add(m[1]);
    for (const m of sql.matchAll(/alter table (?:public\.)?organizations\b[^;]*?add column (?:if not exists )?(\w+_enabled)\b/gis)) names.add(`organizations.${m[1]}`);
    for (const m of sql.matchAll(/create (?:or replace )?trigger \w+[^;]*?\bon (?:public\.)?(\w+)[^;]*?execute function public\.audit_org_setting_change\(([^)]*)\)/gis)) {
      if (m[1] === 'organizations') for (const col of m[2].matchAll(/'(\w+)'/g)) names.add(`organizations.${col[1]}`);
      else names.add(m[1]);
    }
  }
  return [...names].sort();
}

export function unclaimed(derived: string[], claimed: Set<string>, ignored: Record<string, string>): string[] {
  return derived.filter((n) => !claimed.has(n) && !(n in ignored));
}

/** Derived names that are not a setting a person can change, each with why. */
const IGNORED: Record<string, string> = {
  equipment_costing_settings: 'no screen writes it; the equipment cost report reads it',
  org_imprest_settings: 'no screen writes it; the imprest module reads it',
};

const derived = (): string[] => deriveSettingNames({
  hookFiles: [...walk(path.join(APP, 'src/hooks')), ...walk(path.join(APP, 'pages')).filter((f) => /\/use\w+\.tsx?$/.test(f))]
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f)).map((f) => fs.readFileSync(f, 'utf8')),
  migrations: fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).map((f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8')),
});

describe('organisation settings catalogue (#2746)', () => {
  it('AC-OSM-030 every setting hook, settings table, switch column and audited column has an entry', () => {
    const claimed = new Set(Object.values(ORG_SETTINGS).flatMap((e) => e.covers));
    expect(unclaimed(derived(), claimed, IGNORED)).toEqual([]);
  });

  it('AC-OSM-030 the derivation finds the settings it is meant to (not an empty scan)', () => {
    const names = derived();
    expect(names).toEqual(expect.arrayContaining([
      'useHidePricesEnabled', 'useEquipmentPlanSettings', 'labour_cost_settings', 'organizations.crew_loans_enabled', 'organizations.attendance_target_rate',
    ]));
    expect(names.length).toBeGreaterThan(40);
  });

  it('AC-OSM-030 a setting with no entry is reported (the check can fail)', () => {
    const found = deriveSettingNames({
      hookFiles: ['export function useBrandNewSetting() {}', 'export function useSaveBrandNewSetting() {}'],
      migrations: [
        'create table public.brand_new_settings (id int);',
        'alter table public.organizations\n  add column brand_new_enabled boolean not null default false;',
        "create trigger zz after update on public.organizations for each row execute function public.audit_org_setting_change('brand_new_limit');",
      ],
    });
    expect(found).toEqual(['brand_new_settings', 'organizations.brand_new_enabled', 'organizations.brand_new_limit', 'useBrandNewSetting']);
    expect(unclaimed(found, new Set(['useBrandNewSetting']), {})).toEqual(['brand_new_settings', 'organizations.brand_new_enabled', 'organizations.brand_new_limit']);
  });

  it('AC-OSM-030 every ignored name still exists in the code (no stale reason)', () => {
    expect(Object.keys(IGNORED).filter((n) => !derived().includes(n))).toEqual([]);
  });

  it('AC-OSM-031 every setting names its job group, its writers and a route inside the app', () => {
    for (const key of orgSettingKeys) {
      const e = ORG_SETTINGS[key];
      expect(ORG_SETTING_GROUPS, key).toContain(e.group);
      expect(e.writers.length, key).toBeGreaterThan(0);
      expect(e.route, key).toMatch(/^\/[a-z-]/);
    }
  });

  it('AC-OSM-031 every switch on the module has exactly one entry, and each entry names a real switch', () => {
    const claimed = Object.values(ORG_SETTINGS).flatMap((e) => ('switch' in e ? [e.switch] : []));
    expect([...claimed].sort()).toEqual(Object.keys(ORG_SWITCHES).sort());
  });

  it('AC-OSM-031 a migrated entry lists the same writers as its switch', () => {
    for (const e of Object.values(ORG_SETTINGS)) if ('switch' in e) expect([...e.writers]).toEqual([...ORG_SWITCHES[e.switch].writers]);
  });

  it.each(orgSettingKeys.filter((k) => 'manage' in ORG_SETTINGS[k]))('AC-OSM-031 can("manage") for %s allows exactly its declared writers', (key) => {
    const e = ORG_SETTINGS[key] as { manage: Parameters<typeof can>[1]; writers: readonly Role[] };
    const allowed = (ALL_ROLES as readonly Role[]).filter((realRole) => can('manage', e.manage, { realRole }));
    expect([...allowed].sort()).toEqual([...e.writers].sort());
  });

  it('AC-OSM-032 every setting has a name and a summary in English and in Bahasa', () => {
    const text = orgSettingText(((k: string, d: string) => d) as never);
    const commonItems = (en as unknown as { allSettings: { item: Record<string, { name: string; summary: string }> } }).allSettings.item;
    const commonItemsId = (id as unknown as { allSettings: { item: Record<string, { name: string; summary: string }> } }).allSettings.item;
    const items: Record<string, { name: string; summary: string }> = { ...commonItems, workOrderChecklist: billingStepsEn.settings.workOrderChecklist, qsReportRevenue: { name: siteReportEn.revenue.qsAccess, summary: siteReportEn.revenue.qsAccessHelp } };
    const itemsId: Record<string, { name: string; summary: string }> = { ...commonItemsId, workOrderChecklist: billingStepsId.settings.workOrderChecklist, qsReportRevenue: { name: siteReportId.revenue.qsAccess, summary: siteReportId.revenue.qsAccessHelp } };
    for (const key of orgSettingKeys) {
      expect(text[key].name, key).toBeTruthy();
      expect(items[key]?.name, `en ${key}`).toBe(text[key].name);
      expect(items[key]?.summary, `en ${key}`).toBe(text[key].summary);
      expect(itemsId[key]?.name, `id ${key}`).toBeTruthy();
      expect(itemsId[key]?.summary, `id ${key}`).toBeTruthy();
    }
    expect(Object.keys(items).sort()).toEqual([...orgSettingKeys].sort());
  });

  it('AC-OSM-032 report revenue setting copy comes from the site-report feature namespace', () => {
    const t = vi.fn((key: string, fallback: string) => fallback);
    orgSettingText(t as never);
    expect(t).toHaveBeenCalledWith('siteReport:revenue.qsAccess', expect.any(String));
    expect(t).toHaveBeenCalledWith('siteReport:revenue.qsAccessHelp', expect.any(String));
  });

  it('AC-OSM-032 checklist setting copy comes from the billing-steps feature namespace', () => {
    const t = vi.fn((key: string, fallback: string) => fallback);
    orgSettingText(t as never);
    expect(t).toHaveBeenCalledWith('billingSteps:settings.workOrderChecklist.name', expect.any(String));
    expect(t).toHaveBeenCalledWith('billingSteps:settings.workOrderChecklist.summary', expect.any(String));
  });
});

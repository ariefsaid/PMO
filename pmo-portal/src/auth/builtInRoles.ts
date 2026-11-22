import type { Role } from './AuthContext';

/**
 * The built-in role set (#2709): 28 stable role keys in three tiers, each starting from ONE of today's five access levels.
 * `baseLevelOf(key)` is the single frontend mirror of the database's `built_in_role_base(key)`; `builtInRoles.test.ts`
 * fails if this table and the seed in migration 1200 differ. The access level still drives every existing rule
 * (`policy.ts`); the database is the authority (ADR-0016), this is an affordance projection.
 */
export type BuiltInRoleTier = 'manager' | 'officer' | 'field';

/** Each capability is read by one database gate; `daily_report_*` are held for a ruling (supabase/tests/2716). `billing_steps_*`: migration 1771. */
export type RoleCapability =
  | 'sees_prices'
  | 'daily_report_enter'
  | 'daily_report_validate'
  | 'people_documents_view'
  | 'medical_documents_view'
  | 'billing_steps_view'
  | 'billing_steps_run';

export interface BuiltInRole {
  key: string;
  base: Role;
  tier: BuiltInRoleTier;
  functionKey: string;
  sortOrder: number;
  nameEn: string;
  nameId: string;
}

export const BUILT_IN_ROLES: readonly BuiltInRole[] = [
  { key: 'executive', base: 'Executive', tier: 'manager', functionKey: 'leadership', sortOrder: 10, nameEn: 'Executive', nameId: 'Eksekutif' },
  { key: 'administrator', base: 'Admin', tier: 'manager', functionKey: 'administration', sortOrder: 20, nameEn: 'Administrator', nameId: 'Administrator' },
  { key: 'project_manager', base: 'Project Manager', tier: 'manager', functionKey: 'project', sortOrder: 30, nameEn: 'Project Manager', nameId: 'Manajer Proyek' },
  { key: 'deputy_project_manager', base: 'Project Manager', tier: 'manager', functionKey: 'project', sortOrder: 40, nameEn: 'Deputy Project Manager', nameId: 'Wakil Manajer Proyek' },
  { key: 'project_administrator', base: 'Engineer', tier: 'officer', functionKey: 'project', sortOrder: 50, nameEn: 'Project Administrator', nameId: 'Administrator Proyek' },
  { key: 'project_control_manager', base: 'Project Manager', tier: 'manager', functionKey: 'project_control', sortOrder: 60, nameEn: 'Project Control Manager', nameId: 'Manajer Pengendalian Proyek' },
  { key: 'engineer', base: 'Engineer', tier: 'officer', functionKey: 'project_control', sortOrder: 70, nameEn: 'Engineer', nameId: 'Insinyur' },
  { key: 'planner', base: 'Engineer', tier: 'officer', functionKey: 'project_control', sortOrder: 80, nameEn: 'Planner', nameId: 'Perencana' },
  { key: 'quantity_surveyor', base: 'Engineer', tier: 'officer', functionKey: 'project_control', sortOrder: 90, nameEn: 'Quantity Surveyor', nameId: 'Juru Ukur Kuantitas' },
  { key: 'billing_officer', base: 'Finance', tier: 'officer', functionKey: 'project_control', sortOrder: 100, nameEn: 'Billing Officer', nameId: 'Petugas Penagihan' },
  { key: 'construction_manager', base: 'Project Manager', tier: 'manager', functionKey: 'construction', sortOrder: 110, nameEn: 'Construction Manager', nameId: 'Manajer Konstruksi' },
  { key: 'site_supervisor', base: 'Engineer', tier: 'officer', functionKey: 'construction', sortOrder: 120, nameEn: 'Site Supervisor', nameId: 'Pengawas Lapangan' },
  { key: 'foreman', base: 'Engineer', tier: 'field', functionKey: 'construction', sortOrder: 130, nameEn: 'Foreman', nameId: 'Mandor' },
  { key: 'material_coordinator', base: 'Engineer', tier: 'officer', functionKey: 'materials', sortOrder: 140, nameEn: 'Material Coordinator', nameId: 'Koordinator Material' },
  { key: 'storekeeper', base: 'Engineer', tier: 'officer', functionKey: 'materials', sortOrder: 150, nameEn: 'Storekeeper', nameId: 'Penjaga Gudang' },
  { key: 'procurement_manager', base: 'Project Manager', tier: 'manager', functionKey: 'procurement', sortOrder: 160, nameEn: 'Procurement Manager', nameId: 'Manajer Pengadaan' },
  { key: 'buyer', base: 'Engineer', tier: 'officer', functionKey: 'procurement', sortOrder: 170, nameEn: 'Buyer', nameId: 'Pembeli' },
  { key: 'finance_manager', base: 'Finance', tier: 'manager', functionKey: 'finance', sortOrder: 180, nameEn: 'Finance Manager', nameId: 'Manajer Keuangan' },
  { key: 'finance_officer', base: 'Finance', tier: 'officer', functionKey: 'finance', sortOrder: 190, nameEn: 'Finance Officer', nameId: 'Petugas Keuangan' },
  { key: 'quality_manager', base: 'Project Manager', tier: 'manager', functionKey: 'quality', sortOrder: 200, nameEn: 'Quality Manager', nameId: 'Manajer Mutu' },
  { key: 'quality_inspector', base: 'Engineer', tier: 'officer', functionKey: 'quality', sortOrder: 210, nameEn: 'Quality Inspector', nameId: 'Inspektur Mutu' },
  { key: 'safety_manager', base: 'Project Manager', tier: 'manager', functionKey: 'safety', sortOrder: 220, nameEn: 'Safety Manager', nameId: 'Manajer K3' },
  { key: 'safety_officer', base: 'Engineer', tier: 'officer', functionKey: 'safety', sortOrder: 230, nameEn: 'Safety Officer', nameId: 'Petugas K3' },
  { key: 'equipment_manager', base: 'Project Manager', tier: 'manager', functionKey: 'equipment', sortOrder: 240, nameEn: 'Equipment Manager', nameId: 'Manajer Peralatan' },
  { key: 'equipment_officer', base: 'Engineer', tier: 'officer', functionKey: 'equipment', sortOrder: 250, nameEn: 'Equipment Officer', nameId: 'Petugas Peralatan' },
  { key: 'hr_manager', base: 'Project Manager', tier: 'manager', functionKey: 'hr', sortOrder: 260, nameEn: 'HR Manager', nameId: 'Manajer SDM' },
  { key: 'hr_officer', base: 'Engineer', tier: 'officer', functionKey: 'hr', sortOrder: 270, nameEn: 'HR Officer', nameId: 'Petugas SDM' },
  { key: 'field_user', base: 'Engineer', tier: 'field', functionKey: 'field', sortOrder: 280, nameEn: 'Field user', nameId: 'Pengguna Lapangan' },
];

/** role key -> capabilities that differ from the base level (mirror of `built_in_role_capabilities`). */
export const ROLE_CAPABILITIES: readonly (readonly [string, RoleCapability])[] = [
  ['executive', 'sees_prices'],
  ['administrator', 'sees_prices'],
  ['project_manager', 'sees_prices'],
  ['deputy_project_manager', 'sees_prices'],
  ['project_control_manager', 'sees_prices'],
  ['construction_manager', 'sees_prices'],
  ['procurement_manager', 'sees_prices'],
  ['finance_manager', 'sees_prices'],
  ['quality_manager', 'sees_prices'],
  ['safety_manager', 'sees_prices'],
  ['equipment_manager', 'sees_prices'],
  ['hr_manager', 'sees_prices'],
  ['buyer', 'sees_prices'],
  ['finance_officer', 'sees_prices'],
  ['billing_officer', 'sees_prices'],
  ['quantity_surveyor', 'daily_report_enter'],
  ['site_supervisor', 'daily_report_validate'],
  ['project_control_manager', 'daily_report_validate'],
  ['administrator', 'people_documents_view'],
  ['hr_manager', 'people_documents_view'],
  ['hr_officer', 'people_documents_view'],
  ['administrator', 'medical_documents_view'],
  ['hr_manager', 'medical_documents_view'],
  ['hr_officer', 'medical_documents_view'],
  ['executive', 'billing_steps_view'],
  ['administrator', 'billing_steps_view'],
  ['project_manager', 'billing_steps_view'],
  ['deputy_project_manager', 'billing_steps_view'],
  ['project_control_manager', 'billing_steps_view'],
  ['construction_manager', 'billing_steps_view'],
  ['procurement_manager', 'billing_steps_view'],
  ['finance_manager', 'billing_steps_view'],
  ['quality_manager', 'billing_steps_view'],
  ['safety_manager', 'billing_steps_view'],
  ['equipment_manager', 'billing_steps_view'],
  ['hr_manager', 'billing_steps_view'],
  ['finance_officer', 'billing_steps_view'],
  ['billing_officer', 'billing_steps_view'],
  ['quantity_surveyor', 'billing_steps_view'],
  ['project_administrator', 'billing_steps_view'],
  ['site_supervisor', 'billing_steps_view'],
  ['administrator', 'billing_steps_run'],
  ['project_manager', 'billing_steps_run'],
  ['deputy_project_manager', 'billing_steps_run'],
  ['project_control_manager', 'billing_steps_run'],
  ['finance_manager', 'billing_steps_run'],
  ['finance_officer', 'billing_steps_run'],
  ['billing_officer', 'billing_steps_run'],
  ['quantity_surveyor', 'billing_steps_run'],
  ['project_administrator', 'billing_steps_run'],
];

export const BUILT_IN_ROLE_TIERS: readonly BuiltInRoleTier[] = ['manager', 'officer', 'field'];

const BY_KEY = new Map(BUILT_IN_ROLES.map((role) => [role.key, role] as const));

export function isBuiltInRoleKey(key: string | null | undefined): key is string {
  return key != null && BY_KEY.has(key);
}

/** The base access level of a role key; null for no key or an unknown key (never a guessed level). */
export function baseLevelOf(key: string | null | undefined): Role | null {
  return (key != null ? BY_KEY.get(key)?.base : undefined) ?? null;
}

export function roleHasCapability(key: string | null | undefined, capability: RoleCapability): boolean {
  return key != null && ROLE_CAPABILITIES.some(([roleKey, cap]) => roleKey === key && cap === capability);
}

/** Price visibility: a person with no built-in role sees prices as today; an unknown key fails closed. */
export function roleSeesPrices(key: string | null | undefined): boolean {
  return key == null ? true : roleHasCapability(key, 'sees_prices');
}

/** A client's own role names: locale -> role key -> name (#2712). Absent = the catalogue default. */
export type RoleNameOverrides = Partial<Record<'en' | 'id', Partial<Record<string, string>>>>;

/**
 * Display name of a built-in role: the organisation's override for the viewer's language, else the catalogue default.
 * Display only; the key, `profiles.role` and every enum value are untouched. An unknown key resolves to the key itself.
 */
export function builtInRoleName(key: string, language: string, overrides?: RoleNameOverrides): string {
  const role = BY_KEY.get(key);
  if (!role) return key;
  const id = language.toLowerCase().startsWith('id');
  const custom = overrides?.[id ? 'id' : 'en']?.[key]?.trim();
  if (custom) return custom;
  return id ? role.nameId : role.nameEn;
}

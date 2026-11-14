/**
 * pmo-org.mjs — `pmo org add` and organization readiness (#2257, FR-ONB-011..016).
 *
 * Adds an organization to the shared project via the server-side edge function
 * `operator-org` and operator RPCs. Node 22 standard library only.
 */

export const OPERATOR_ORG_RPCS = Object.freeze([
  'operator_set_org_lifecycle_state',
  'operator_set_org_plan',
  'operator_toggle_feature',
]);

const REQUIRED_FLAGS = [
  ['name', '--name'],
  ['admin-email', '--admin-email'],
  ['admin-name', '--admin-name'],
  ['currency', '--currency'],
  ['locale', '--locale'],
  ['timezone', '--timezone'],
  ['plan', '--plan'],
];

/**
 * Pure classifier evaluating organization readiness (FR-ONB-016).
 * Healthy only when exists, explicit plan_id, admins.active + admins.pending >= 1, stage_config_count >= 1.
 * Failed names: organization, plan, admin, stage-config.
 *
 * @param {object} status
 * @returns {{ healthy: boolean, failed: string[] }}
 */
export function classifyOrgReadiness(status) {
  const failed = [];
  if (!status?.exists) failed.push('organization');
  if (status?.plan_id == null) failed.push('plan');
  const activeAdmins = Number(status?.admins?.active ?? 0);
  const pendingAdmins = Number(status?.admins?.pending ?? 0);
  if (activeAdmins + pendingAdmins < 1) failed.push('admin');
  const stageCount = Number(status?.stage_config_count ?? 0);
  if (stageCount < 1) failed.push('stage-config');

  return {
    healthy: failed.length === 0,
    failed,
  };
}

/**
 * Handle `pmo org add` execution (FR-ONB-011..015).
 */
export async function orgAdd(ctx, positionals, flags, api, { usage, CliError, Printed }) {
  const sub = positionals[0];
  if (sub !== 'add') {
    throw usage(`Unknown org command '${sub ?? ''}'. Use 'pmo org add'.`);
  }

  // Validate required flags (FR-ONB-011)
  for (const [key, flag] of REQUIRED_FLAGS) {
    if (!flags[key]) {
      throw usage(`Missing required flag ${flag}`);
    }
  }

  const state = flags.state ?? 'live';
  if (!['live', 'demo', 'test'].includes(state)) {
    throw usage(`--state must be 'live', 'demo' or 'test': got '${flags.state}'`);
  }

  // Parse repeatable --feature <key>=on|off
  const rawFeatures = Array.isArray(flags.feature) ? flags.feature : flags.feature ? [flags.feature] : [];
  const features = [];
  for (const item of rawFeatures) {
    const eq = item.indexOf('=');
    if (eq <= 0) throw usage(`--feature must be <key>=on|off: got '${item}'`);
    const key = item.slice(0, eq);
    const val = item.slice(eq + 1);
    if (val !== 'on' && val !== 'off') {
      throw usage(`--feature value must be 'on' or 'off': got '${item}'`);
    }
    features.push({ key, enabled: val === 'on' });
  }

  // Dry run (FR-ONB-012)
  if (!flags.confirm) {
    const featureList = features.map((f) => `${f.key}=${f.enabled ? 'on' : 'off'}`).join(', ');
    const steps = [
      `1. Call operator-org action "create" for "${flags.name}" (Admin: ${flags['admin-email']} / ${flags['admin-name']}, plan: ${flags.plan}, currency: ${flags.currency}, locale: ${flags.locale}${flags['number-locale'] ? `/${flags['number-locale']}` : ''}, timezone: ${flags.timezone})`,
      `2. Read organization status via operator-org action "status"`,
      `3. If plan_id is null, call RPC operator_set_org_plan with "${flags.plan}" (stop if plan differs)`,
      `4. Apply features via RPC operator_toggle_feature${featureList ? `: ${featureList}` : ' (none specified)'}`,
      `5. Read organization status again and classify readiness`,
      `6. Set lifecycle state to "${state}" via RPC operator_set_org_lifecycle_state if readiness is healthy`,
    ];
    return new Printed(`${steps.join('\n')}\n\nDry run. Add --confirm to run.\n`);
  }

  // Confirmed execution (FR-ONB-013, FR-ONB-014, FR-ONB-015)
  // Step 1: create
  const createPayload = {
    action: 'create',
    name: flags.name,
    admin_email: flags['admin-email'],
    admin_full_name: flags['admin-name'],
    default_currency: flags.currency,
    default_locale: flags.locale,
    ...(flags['number-locale'] ? { default_number_locale: flags['number-locale'] } : {}),
    default_timezone: flags.timezone,
    plan_id: flags.plan,
  };
  const createRes = await api.operatorOrg(createPayload);
  const orgId = createRes.org_id;
  const created = Boolean(createRes.created);
  ctx.stdout.write(`Organization ${created ? 'created' : 'already exists'}: ${orgId}\n`);

  // Step 2: status 1
  const status1 = await api.operatorOrg({ action: 'status', org_id: orgId });
  if (status1.plan_id == null) {
    await api.rpc('operator_set_org_plan', {
      p_org_id: orgId,
      p_plan_id: flags.plan,
    });
  } else if (status1.plan_id !== flags.plan) {
    throw new CliError(
      `Organization already has plan '${status1.plan_id}', which differs from '--plan ${flags.plan}'. Changing a plan is not this command's job.`,
      { exit: 1, code: 'plan_conflict' },
    );
  }

  // Step 3: features
  const existingFeatures = new Map((status1.features ?? []).map((f) => [f.key, f.enabled]));
  for (const f of features) {
    if (existingFeatures.get(f.key) === f.enabled) {
      continue; // skip what status already shows as requested
    }
    await api.rpc('operator_toggle_feature', {
      p_org_id: orgId,
      p_key: f.key,
      p_enabled: f.enabled,
    });
  }

  // Step 4: status 2
  const status2 = await api.operatorOrg({ action: 'status', org_id: orgId });
  const readiness = classifyOrgReadiness(status2);

  // Step 5: readiness check & lifecycle state
  if (!readiness.healthy) {
    const failedNames = readiness.failed.join(', ');
    ctx.stderr.write(`Organization readiness failed: ${failedNames}\n`);
    throw new CliError(`Organization readiness failed: ${failedNames}`, {
      exit: 1,
      code: 'unhealthy_org',
      details: { failed: readiness.failed },
    });
  }

  if (status2.lifecycle_state !== state) {
    await api.rpc('operator_set_org_lifecycle_state', {
      p_org_id: orgId,
      p_lifecycle_state: state,
    });
  }

  // Step 6: short result
  const activeAdmins = status2.admins?.active ?? 0;
  const pendingAdmins = status2.admins?.pending ?? 0;
  return new Printed(
    `Organization: ${orgId}\n` +
    `Plan: ${flags.plan}\n` +
    `Admin: ${activeAdmins} active, ${pendingAdmins} pending\n` +
    `State: ${state}\n`,
  );
}

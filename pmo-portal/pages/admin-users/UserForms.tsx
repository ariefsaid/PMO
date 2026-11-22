import React, { useMemo } from 'react';
import {
  EntityFormModal,
  type SubmitError,
  SelectField,
  TextField,
  Combobox,
  FormSection,
  useEntityForm,
  Icon,
  type ComboboxOption,
} from '@/src/components/ui';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { UserDirectoryRow, UserManagerChoice, UserRole } from '@/src/lib/db/adminUsers';
import { useRoleLabels } from './roleLabels';
import { BUILT_IN_ROLES, BUILT_IN_ROLE_TIERS, baseLevelOf } from '@/src/auth/builtInRoles';
import { useBuiltInRoleName } from '@/src/hooks/useOrgRoleNames';
import { initialsOf } from './avatar';

/**
 * The three Administration › Users forms (CROSS-65 / XG01-002): invite, edit-role and
 * change-manager, moved off AdminUsers. The seams are the forms' existing submit/error/dirty
 * contracts — the PAGE keeps every mutation, its rejection and the toast; a form only renders
 * fields and calls back. Deleting these modules would return each distinct form's validation and
 * field behavior to the coordinator page.
 */

// ── Invite modal (FR-INV-004/005) ────────────────────────────────────────────

const LEVEL_ORDER: UserRole[] = ['Admin', 'Executive', 'Project Manager', 'Finance', 'Engineer'];

/** The built-in (job) roles for the invite picker, grouped by the access level each starts from (shown as the second line, and
 *  searchable by it), then in the set's own order. */
function useJobRoleOptions(levelLabel: (role: UserRole) => string, roleName: (key: string) => string): ComboboxOption[] {
  return useMemo(() => [...BUILT_IN_ROLES]
    .sort((a, b) => LEVEL_ORDER.indexOf(a.base) - LEVEL_ORDER.indexOf(b.base) || a.sortOrder - b.sortOrder)
    .map((role) => ({ value: role.key, label: roleName(role.key), sub: levelLabel(role.base), searchTerms: [levelLabel(role.base), role.nameEn, role.nameId] })),
  [levelLabel, roleName]);
}

interface InviteFormValues {
  email: string;
  role: UserRole;
  /** The built-in (job) role key, asked instead of the access level once the organisation has the set on. */
  builtIn: string;
}

const makeValidateInvite =
  (t: TFunction, builtInEnabled: boolean) =>
  (v: InviteFormValues): Partial<Record<keyof InviteFormValues, string>> => {
    const errors: Partial<Record<keyof InviteFormValues, string>> = {};
    const email = v.email.trim();
    if (builtInEnabled && !v.builtIn) errors.builtIn = t('admin.users.inviteForm.jobRoleRequired', 'Choose the job role.');
    if (!email) errors.email = t('admin.users.inviteForm.emailRequired', 'Email is required.');
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      errors.email = t('admin.users.inviteForm.emailInvalid', 'Enter a valid email address.');
    }
    return errors;
  };

export const InviteFormModal: React.FC<{
  isOperator: boolean;
  loading: boolean;
  /** #559: owned by the page (which owns the mutation), rendered here. */
  submitError: SubmitError | null;
  onClose: () => void;
  onSubmit: (email: string, role: UserRole, pOrgId: string | null, builtIn: string | null) => void;
  /** True once the organisation has the built-in role set on: the job role is asked, and the access level follows from it. */
  builtInEnabled?: boolean;
}> = ({ isOperator, loading, submitError, onClose, onSubmit, builtInEnabled = false }) => {
  const { t } = useTranslation();
  const roleNames = useRoleLabels();
  const roleDisplayName = useBuiltInRoleName();
  const validate = useMemo(() => makeValidateInvite(t, builtInEnabled), [t, builtInEnabled]);
  const form = useEntityForm<InviteFormValues>({
    initialValues: { email: '', role: 'Engineer', builtIn: '' },
    validate,
    idPrefix: 'invite-form',
    requiredFields: ['email'],
    module: 'administration',
  });
  const emailField = form.fieldProps('email');
  const roleField = form.fieldProps('role');
  const builtInField = form.fieldProps('builtIn');
  const jobRoleOptions = useJobRoleOptions(roleNames.label, roleDisplayName);
  const loadJobRoles = useMemo(() => () => Promise.resolve(jobRoleOptions), [jobRoleOptions]);
  const chosenBase = baseLevelOf(builtInField.value || null);

  const errorSummary = [
    ...(form.errors.email ? [{ fieldId: emailField.id, message: form.errors.email }] : []),
    ...(form.errors.builtIn ? [{ fieldId: builtInField.id, message: form.errors.builtIn }] : []),
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((values) => {
      // The Operator cross-org path (p_org_id) is added when the org-switcher lands (S5);
      // for now every invite (Operator or org-Admin) targets the caller's own org.
      if (builtInEnabled) onSubmit(values.email.trim(), baseLevelOf(values.builtIn) ?? values.role, null, values.builtIn);
      else onSubmit(values.email.trim(), values.role, null, null);
    });
  };

  return (
    <EntityFormModal
      open
      title={t('admin.users.invite', 'Invite user')}
      submitLabel={t('admin.users.invite', 'Invite user')}
      onSubmit={handleSubmit}
      submitError={submitError}
      onClose={onClose}
      loading={loading}
      dirty={form.isDirty}
      errorSummary={errorSummary.length ? errorSummary : undefined}
    >
      <FormSection legend={t('admin.users.inviteForm.legend', 'Invite details')}>
        <TextField
          id={emailField.id}
          label={t('admin.users.inviteForm.email', 'Email')}
          type="email"
          required
          value={emailField.value}
          onChange={emailField.onChange}
          onBlur={emailField.onBlur}
          error={form.errors.email}
          fullWidth
        />
        {builtInEnabled ? (
          <>
            <Combobox
              id={builtInField.id}
              label={t('administration:admin.users.builtIn.label', 'Job role')}
              required
              value={builtInField.value || null}
              selectedOption={builtInField.value ? jobRoleOptions.find((o) => o.value === builtInField.value) ?? null : null}
              onChange={(v) => builtInField.onChange(v)}
              loadOptions={loadJobRoles}
              placeholder={t('admin.users.inviteForm.jobRolePlaceholder', 'Choose a job role')}
              searchPlaceholder={t('admin.users.inviteForm.jobRoleSearch', 'Search job roles')}
              noun={t('admin.users.inviteForm.jobRoleNoun', 'job role')}
              error={form.errors.builtIn}
            />
            {chosenBase && (
              <p id="invite-form-base-level" className="text-control text-muted-foreground">
                {t('administration:admin.users.builtIn.baseLevel', {
                  defaultValue: 'Access level: {{level}} (set by the job role)',
                  level: roleNames.label(chosenBase),
                })}
              </p>
            )}
          </>
        ) : (
        <SelectField
            id={roleField.id}
            label={t('admin.users.columns.role', 'Access level')}
            required
            value={roleField.value}
            onChange={(v) => roleField.onChange(v as UserRole)}
            onBlur={roleField.onBlur}
            options={roleNames.options}
            helper={`${t('admin.users.inviteForm.roleHelper', 'Determines what this person can see and do once they sign in.')}${isOperator ? ` ${t('admin.users.inviteForm.subtitleOperator', 'Takes effect immediately.')}` : ''}`}
            fullWidth
          />
        )}
      </FormSection>
    </EntityFormModal>
  );
};

// ── Edit-role modal ────────────────────────────────────────────────────────

interface RoleFormValues {
  role: UserRole;
  /** '' = no built-in role (the access level alone applies). */
  builtIn: string;
}

export const RoleFormModal: React.FC<{
  user: UserDirectoryRow;
  /** #559: owned by the page (which owns the mutation), rendered here. */
  submitError: SubmitError | null;
  onClose: () => void;
  onSubmit: (user: UserDirectoryRow, role: UserRole) => void;
  /** #2709: true once the organization has turned the built-in role set on. False (default) = the form is unchanged. */
  builtInEnabled?: boolean;
  onSubmitBuiltIn?: (user: UserDirectoryRow, key: string | null) => void;
}> = ({ user, submitError, onClose, onSubmit, builtInEnabled = false, onSubmitBuiltIn }) => {
  const { t } = useTranslation();
  const roleNames = useRoleLabels();
  const roleDisplayName = useBuiltInRoleName();
  const form = useEntityForm<RoleFormValues>({
    initialValues: { role: user.role, builtIn: user.built_in_role ?? '' },
    idPrefix: 'role-form',
    module: 'administration',
  });
  const roleField = form.fieldProps('role');
  const builtInField = form.fieldProps('builtIn');
  const heldKey = user.built_in_role ?? '';

  const builtInOptions = useMemo(() => {
    const tierLabel = {
      manager: t('administration:admin.users.builtIn.tier.manager', 'Managers'),
      officer: t('administration:admin.users.builtIn.tier.officer', 'Officers'),
      field: t('administration:admin.users.builtIn.tier.field', 'Field'),
    } as const;
    return [
      { value: '', label: t('administration:admin.users.builtIn.none', 'No job role (access level only)') },
      ...BUILT_IN_ROLE_TIERS.flatMap((tier) => [
        { value: `__${tier}`, label: tierLabel[tier], disabled: true },
        ...BUILT_IN_ROLES.filter((role) => role.tier === tier).map((role) => ({
          value: role.key,
          label: roleDisplayName(role.key),
        })),
      ]),
    ];
  }, [t, roleDisplayName]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((values) => {
      if (builtInEnabled && onSubmitBuiltIn && values.builtIn !== heldKey) {
        onSubmitBuiltIn(user, values.builtIn === '' ? null : values.builtIn);
        return;
      }
      onSubmit(user, values.role);
    });
  };

  const chosenBase = baseLevelOf(builtInField.value || null);

  return (
    <EntityFormModal
      open
      title={builtInEnabled
        ? t('admin.users.roleForm.titleJobRole', { defaultValue: 'Change job role: {{name}}', name: user.full_name })
        : t('admin.users.roleForm.title', { defaultValue: 'Edit access level: {{name}}', name: user.full_name })}
      submitLabel={builtInEnabled ? t('admin.users.roleForm.submitJobRole', 'Save job role') : t('admin.users.roleForm.submit', 'Save access level')}
      onSubmit={handleSubmit}
      submitError={submitError}
      onClose={onClose}
      dirty={form.isDirty}
    >
      <FormSection legend={t('admin.users.columns.role', 'Access level')}>
        {builtInEnabled && (
          <SelectField
            id={builtInField.id}
            label={t('administration:admin.users.builtIn.label', 'Job role')}
            value={builtInField.value}
            onChange={(v) => builtInField.onChange(v)}
            onBlur={builtInField.onBlur}
            options={builtInOptions}
            helper={t(
              'administration:admin.users.builtIn.helper',
              'A job role starts from one access level and sets what this person sees and does for their job.',
            )}
            fullWidth
          />
        )}
        {builtInEnabled && chosenBase ? (
          <p id="role-form-base-level" className="text-control text-muted-foreground">
            {t('administration:admin.users.builtIn.baseLevel', {
              defaultValue: 'Access level: {{level}} (set by the job role)',
              level: roleNames.label(chosenBase),
            })}
          </p>
        ) : (
          <SelectField
            id={roleField.id}
            label={t('admin.users.columns.role', 'Access level')}
            required
            value={roleField.value}
            onChange={(v) => roleField.onChange(v as UserRole)}
            onBlur={roleField.onBlur}
            options={roleNames.options}
            helper={t(
              'admin.users.roleForm.helper',
              'Determines what this user can see and do. Changes take effect immediately and are confirmed first.',
            )}
            fullWidth
          />
        )}
      </FormSection>
    </EntityFormModal>
  );
};

// ── Change-manager modal ─────────────────────────────────────────────────────

interface ManagerFormValues {
  managerId: string | null;
}

export const ManagerFormModal: React.FC<{
  user: UserDirectoryRow;
  /** The COMPLETE, minimal people list (id, name, role) — every page, never the visible page. */
  choices: UserManagerChoice[];
  /**
   * The list's own load state. It is rendered as a first-class state: an unresolved or failed read
   * must never look like "nobody is available", and it must not allow a write that the user cannot
   * verify (including an accidental clear).
   */
  choicesState: 'loading' | 'error' | 'ready';
  onRetryChoices: () => void;
  loading: boolean;
  onClose: () => void;
  onSubmit: (user: UserDirectoryRow, managerId: string | null) => void;
}> = ({ user, choices, choicesState, onRetryChoices, loading, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const roleNames = useRoleLabels();
  const form = useEntityForm<ManagerFormValues>({
    initialValues: { managerId: user.manager_id ?? null },
    idPrefix: 'manager-form',
    module: 'administration',
  });
  const managerId = form.values.managerId;
  const choicesReady = choicesState === 'ready';

  // The manager picker offers everyone EXCEPT the user themselves (no self-management).
  const loadOptions = async (): Promise<ComboboxOption[]> =>
    choices
      .filter((c) => c.id !== user.id)
      .map((c) => ({
        value: c.id,
        label: c.full_name,
        sub: roleNames.label(c.role),
        initials: initialsOf(c.full_name),
      }));

  // The saved manager is retained BY ID and NAMED from the row's own server embed, so the current
  // reporting line stays visible when that person is on another page — and while the complete list
  // is still loading or has failed. It must never render as "no manager" in those states.
  const selectedOption: ComboboxOption | null = managerId
    ? (() => {
        const chosen = choices.find((c) => c.id === managerId);
        if (chosen) {
          return { value: chosen.id, label: chosen.full_name, sub: roleNames.label(chosen.role), initials: initialsOf(chosen.full_name) };
        }
        const embeddedName = user.manager_id === managerId ? user.manager?.full_name : undefined;
        return {
          value: managerId,
          label:
            embeddedName ??
            t('administration:admin.users.managerForm.currentUnavailable', 'Current manager (name unavailable)'),
        };
      })()
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!choicesReady) return;
    void form.handleSubmit((values) => {
      onSubmit(user, values.managerId);
    });
  };

  return (
    <EntityFormModal
      open
      title={t('admin.users.managerForm.title', { defaultValue: 'Change manager: {{name}}', name: user.full_name })}
      submitLabel={t('admin.users.managerForm.submit', 'Save manager')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={loading}
      submitDisabled={!choicesReady}
      disabledReason={t(
        'administration:admin.users.managerForm.awaitingChoices',
        'Wait for the people list to load before saving a manager.',
      )}
      dirty={form.isDirty}
    >
      <FormSection legend={t('admin.users.managerForm.legend', 'Reporting line')}>
        <Combobox
          label={t('admin.users.managerForm.label', 'Manager')}
          noun={t('admin.users.managerForm.noun', 'person')}
          value={managerId}
          selectedOption={selectedOption}
          onChange={(v) => form.setValue('managerId', v)}
          loadOptions={loadOptions}
          disabled={!choicesReady}
          placeholder={t('admin.users.managerForm.placeholder', 'Assign a manager…')}
          searchPlaceholder={t('admin.users.managerForm.search', 'Search people…')}
        />
        <p className="mt-1.5 text-control text-muted-foreground">
          {t('admin.users.managerForm.hint', 'Used for timesheet-approval routing.')}
        </p>
        {choicesState === 'loading' && (
          <p role="status" className="mt-1.5 text-control text-muted-foreground">
            {t('administration:admin.users.managerForm.choicesLoading', 'Loading people…')}
          </p>
        )}
        {choicesState === 'error' && (
          <p role="alert" className="mt-1.5 text-control text-destructive">
            {t('administration:admin.users.managerForm.choicesError', "Couldn't load the people list.")}{' '}
            <button type="button" onClick={onRetryChoices} className="font-semibold underline underline-offset-2">
              {t('administration:admin.users.managerForm.choicesRetry', 'Retry')}
            </button>
          </p>
        )}
        {managerId && choicesReady && (
          <button
            type="button"
            onClick={() => form.setValue('managerId', null)}
            className="mt-2 inline-flex items-center gap-1.5 text-control font-semibold text-primary-text hover:underline"
          >
            <Icon name="x" className="size-[13px]" />
            {t('admin.users.managerForm.clear', 'Clear manager')}
          </button>
        )}
      </FormSection>
    </EntityFormModal>
  );
};

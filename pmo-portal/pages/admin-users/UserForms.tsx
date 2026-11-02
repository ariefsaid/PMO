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
import type { UserRow, UserRole } from '@/src/lib/db/adminUsers';
import { useRoleLabels } from './roleLabels';
import { initialsOf, avatarHue } from './avatar';

/**
 * The three Administration › Users forms (CROSS-65 / XG01-002): invite, edit-role and
 * change-manager, moved off AdminUsers. The seams are the forms' existing submit/error/dirty
 * contracts — the PAGE keeps every mutation, its rejection and the toast; a form only renders
 * fields and calls back. Deleting these modules would return each distinct form's validation and
 * field behavior to the coordinator page.
 */

// ── Invite modal (FR-INV-004/005) ────────────────────────────────────────────

interface InviteFormValues {
  email: string;
  role: UserRole;
}

const makeValidateInvite =
  (t: TFunction) =>
  (v: InviteFormValues): Partial<Record<keyof InviteFormValues, string>> => {
    const errors: Partial<Record<keyof InviteFormValues, string>> = {};
    const email = v.email.trim();
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
  onSubmit: (email: string, role: UserRole, pOrgId: string | null) => void;
}> = ({ isOperator, loading, submitError, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const roleNames = useRoleLabels();
  const validate = useMemo(() => makeValidateInvite(t), [t]);
  const form = useEntityForm<InviteFormValues>({
    initialValues: { email: '', role: 'Engineer' },
    validate,
    idPrefix: 'invite-form',
    requiredFields: ['email'],
    module: 'administration',
  });
  const emailField = form.fieldProps('email');
  const roleField = form.fieldProps('role');

  const errorSummary = form.errors.email
    ? [{ fieldId: emailField.id, message: form.errors.email }]
    : undefined;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((values) => {
      // The Operator cross-org path (p_org_id) is added when the org-switcher lands (S5);
      // for now every invite (Operator or org-Admin) targets the caller's own org.
      onSubmit(values.email.trim(), values.role, null);
    });
  };

  return (
    <EntityFormModal
      open
      title={t('admin.users.invite', 'Invite user')}
      subtitle={
        isOperator
          ? t(
              'admin.users.inviteForm.subtitleOperator',
              "Invite someone by email. They'll set their own password and role takes effect immediately.",
            )
          : t(
              'admin.users.inviteForm.subtitle',
              "Invite someone to your workspace by email. They'll set their own password.",
            )
      }
      submitLabel={t('admin.users.invite', 'Invite user')}
      onSubmit={handleSubmit}
      submitError={submitError}
      onClose={onClose}
      loading={loading}
      dirty={form.isDirty}
      errorSummary={errorSummary}
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
        <SelectField
          id={roleField.id}
          label={t('admin.users.columns.role', 'Role')}
          required
          value={roleField.value}
          onChange={(v) => roleField.onChange(v as UserRole)}
          onBlur={roleField.onBlur}
          options={roleNames.options}
          helper={t('admin.users.inviteForm.roleHelper', 'Determines what this person can see and do once they sign in.')}
          fullWidth
        />
      </FormSection>
    </EntityFormModal>
  );
};

// ── Edit-role modal ────────────────────────────────────────────────────────

interface RoleFormValues {
  role: UserRole;
}

export const RoleFormModal: React.FC<{
  user: UserRow;
  /** #559: owned by the page (which owns the mutation), rendered here. */
  submitError: SubmitError | null;
  onClose: () => void;
  onSubmit: (user: UserRow, role: UserRole) => void;
}> = ({ user, submitError, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const roleNames = useRoleLabels();
  const form = useEntityForm<RoleFormValues>({
    initialValues: { role: user.role },
    idPrefix: 'role-form',
    module: 'administration',
  });
  const roleField = form.fieldProps('role');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((values) => {
      onSubmit(user, values.role);
    });
  };

  return (
    <EntityFormModal
      open
      title={t('admin.users.roleForm.title', 'Edit role')}
      subtitle={t('admin.users.roleForm.subtitle', {
        defaultValue: 'Set the workspace role for {{name}}',
        name: user.full_name,
      })}
      submitLabel={t('admin.users.roleForm.submit', 'Save role')}
      onSubmit={handleSubmit}
      submitError={submitError}
      onClose={onClose}
      dirty={form.isDirty}
    >
      <FormSection legend={t('admin.users.columns.role', 'Role')}>
        <SelectField
          id={roleField.id}
          label={t('admin.users.columns.role', 'Role')}
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
      </FormSection>
    </EntityFormModal>
  );
};

// ── Change-manager modal ─────────────────────────────────────────────────────

interface ManagerFormValues {
  managerId: string | null;
}

export const ManagerFormModal: React.FC<{
  user: UserRow;
  candidates: UserRow[];
  loading: boolean;
  onClose: () => void;
  onSubmit: (user: UserRow, managerId: string | null) => void;
}> = ({ user, candidates, loading, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const roleNames = useRoleLabels();
  const form = useEntityForm<ManagerFormValues>({
    initialValues: { managerId: user.manager_id ?? null },
    idPrefix: 'manager-form',
    module: 'administration',
  });
  const managerId = form.values.managerId;

  // The manager picker offers everyone EXCEPT the user themselves (no self-management).
  const loadOptions = async (): Promise<ComboboxOption[]> =>
    candidates
      .filter((c) => c.id !== user.id)
      .map((c) => ({
        value: c.id,
        label: c.full_name,
        sub: roleNames.label(c.role),
        initials: initialsOf(c.full_name),
        color: avatarHue(c.id),
      }));

  const selectedOption: ComboboxOption | null = managerId
    ? (() => {
        const m = candidates.find((c) => c.id === managerId);
        return m
          ? { value: m.id, label: m.full_name, sub: roleNames.label(m.role), initials: initialsOf(m.full_name), color: avatarHue(m.id) }
          : null;
      })()
    : null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void form.handleSubmit((values) => {
      onSubmit(user, values.managerId);
    });
  };

  return (
    <EntityFormModal
      open
      title={t('admin.users.managerForm.title', 'Change manager')}
      subtitle={t('admin.users.managerForm.subtitle', {
        defaultValue: 'Set the line manager for {{name}}',
        name: user.full_name,
      })}
      submitLabel={t('admin.users.managerForm.submit', 'Save manager')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={loading}
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
          placeholder={t('admin.users.managerForm.placeholder', 'Assign a manager…')}
          searchPlaceholder={t('admin.users.managerForm.search', 'Search people…')}
        />
        <p className="mt-1.5 text-[12px] text-muted-foreground">
          {t('admin.users.managerForm.hint', 'Used for timesheet-approval routing.')}
        </p>
        {managerId && (
          <button
            type="button"
            onClick={() => form.setValue('managerId', null)}
            className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary-text hover:underline"
          >
            <Icon name="x" className="size-[13px]" />
            {t('admin.users.managerForm.clear', 'Clear manager')}
          </button>
        )}
      </FormSection>
    </EntityFormModal>
  );
};

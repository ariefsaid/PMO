import React from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormSection, FormGrid, TextField, FieldError } from '@/src/components/ui';
import { useEntityForm } from '@/src/components/ui/useEntityForm';
import { tierLabel } from './integrationLabels';
import type { ExternalTier } from '@/src/lib/repositories/types';

/** Connect credential form values per tier */
export interface ConnectFormValues {
  token: string;
  siteUrl: string;
  apiKey: string;
  apiSecret: string;
}

type FormFieldName = 'token' | 'siteUrl' | 'apiKey' | 'apiSecret';

const validateClickUp = (v: ConnectFormValues, required: string): Partial<Record<FormFieldName, string>> => {
  const errors: Partial<Record<FormFieldName, string>> = {};
  if (!v.token.trim()) errors.token = required;
  return errors;
};

const validateERPNext = (v: ConnectFormValues, required: { url: string; key: string; secret: string }): Partial<Record<FormFieldName, string>> => {
  const errors: Partial<Record<FormFieldName, string>> = {};
  if (!v.siteUrl.trim()) errors.siteUrl = required.url;
  if (!v.apiKey.trim()) errors.apiKey = required.key;
  if (!v.apiSecret.trim()) errors.apiSecret = required.secret;
  return errors;
};

/**
 * The connect-credentials dialog of the organization integrations surface (extracted from
 * IntegrationsView, #1941): the per-tier credential form (ClickUp token vs ERPNext URL/key/secret)
 * with the shared form primitives. The dialog owns the mount-scoped form state (it is mounted only
 * while a connect is being attempted, so it always starts from the blank values the view used to
 * reset to); the connect mutation and its error state stay in the view.
 */
interface ConnectCredentialsModalProps {
  tier: ExternalTier;
  /** True while the connect mutation is in flight. */
  loading: boolean;
  /** The submit-level error copy (set by a failed connect), rendered in-dialog. */
  error: string | null;
  onClose: () => void;
  /** Called with the validated values; the view shapes the credential and runs the mutation. */
  onSubmit: (values: ConnectFormValues) => Promise<void>;
}

export const ConnectCredentialsModal: React.FC<ConnectCredentialsModalProps> = ({ tier, loading, error, onClose, onSubmit }) => {
  const { t } = useTranslation();
  const connectForm = useEntityForm<ConnectFormValues>({
    initialValues: { token: '', siteUrl: '', apiKey: '', apiSecret: '' },
    validate: (v) => (tier === 'clickup'
      ? validateClickUp(v, t('integrations.organization.readiness.connect.tokenRequired', 'Personal API token is required.'))
      : validateERPNext(v, {
          url: t('integrations.organization.readiness.connect.urlRequired', 'Instance URL is required.'),
          key: t('integrations.organization.readiness.connect.keyRequired', 'API Key is required.'),
          secret: t('integrations.organization.readiness.connect.secretRequired', 'API Secret is required.'),
        })),
    idPrefix: 'connect-form',
    requiredFields: tier === 'clickup' ? ['token'] : ['siteUrl', 'apiKey', 'apiSecret'],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await connectForm.handleSubmit(onSubmit);
  };

  return (
    <EntityFormModal
      open
      title={t('integrations.organization.readiness.connectAction', 'Connect {{service}}', { service: tierLabel(tier) })}
      subtitle={t('integrations.organization.readiness.connect.subtitle', 'Enter your {{service}} credentials to establish the connection', { service: tierLabel(tier) })}
      submitLabel={t('integrations.organization.readiness.connectAction', 'Connect {{service}}', { service: tierLabel(tier) })}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={loading}
      dirty={connectForm.isDirty}
      submitDisabled={!connectForm.isComplete}
      errorSummary={error ? [{ fieldId: connectForm.fieldProps('token').id, message: error }] : undefined}
    >
      <FormSection legend={t('integrations.organization.readiness.connect.credentials', 'Credentials')}>
        <FormGrid>
          {tier === 'clickup' ? (
            <TextField
              {...connectForm.fieldProps('token')}
              label={t('integrations.organization.readiness.connect.tokenLabel', 'Personal API token')}
              required
              type="password"
              placeholder="pk_123456789..."
              autoComplete="off"
              fullWidth
            />
          ) : (
            <>
              <TextField
                {...connectForm.fieldProps('siteUrl')}
                label={t('integrations.organization.readiness.connect.urlLabel', 'Instance URL')}
                required
                placeholder="https://your-instance.erpnext.com"
                autoComplete="url"
                fullWidth
              />
              <TextField
                {...connectForm.fieldProps('apiKey')}
                label={t('integrations.organization.readiness.connect.keyLabel', 'API Key')}
                required
                placeholder="your-api-key"
                autoComplete="off"
              />
              <TextField
                {...connectForm.fieldProps('apiSecret')}
                label={t('integrations.organization.readiness.connect.secretLabel', 'API Secret')}
                required
                type="password"
                placeholder="your-api-secret"
                autoComplete="off"
              />
            </>
          )}
        </FormGrid>
      </FormSection>
      {error && (
        <FieldError id={`${connectForm.fieldProps('token').id}-submit`}>
          {error}
        </FieldError>
      )}
    </EntityFormModal>
  );
};

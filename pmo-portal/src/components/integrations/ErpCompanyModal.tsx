import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EntityFormModal, FormSection, ListState, FieldError, Combobox } from '@/src/components/ui';

/**
 * The ERPNext Company picker dialog of the organization integrations surface (extracted from
 * IntegrationsView, #1941; OD-INT-6 / AC-IRUX-005): choose the Company whose ERPNext instance
 * activates the integration. The dialog owns the mount-scoped selection (it is mounted only while
 * an activation is being attempted, so it always starts with no selection, exactly what the view
 * used to reset to); the companies read, the activation mutation and the error state stay in the
 * view — a failed activation keeps the dialog open AND the selection (AC-IRUX-005).
 */
interface ErpCompanyModalProps {
  companies: Array<{ name: string }>;
  isCompaniesPending: boolean;
  isCompaniesError: boolean;
  onRefetchCompanies: () => void;
  /** True while the activation mutation is in flight. */
  loading: boolean;
  /** The submit-level error copy (validation or a refused activation), rendered in-dialog. */
  error: string | null;
  /** Selection changed: the view clears its error copy. */
  onSelectionChange: () => void;
  /** Submit with the selected Company, or null when nothing is selected yet. */
  onSubmit: (companyId: string | null) => void;
  onClose: () => void;
}

export const ErpCompanyModal: React.FC<ErpCompanyModalProps> = ({
  companies,
  isCompaniesPending,
  isCompaniesError,
  onRefetchCompanies,
  loading,
  error,
  onSelectionChange,
  onSubmit,
  onClose,
}) => {
  const { t } = useTranslation();
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(selectedCompany);
  };

  return (
    <EntityFormModal
      open
      title={t('integrations.organization.readiness.erpActivation.title', 'Select ERPNext Company')}
      submitLabel={t('integrations.organization.readiness.erpActivation.activate', 'Activate')}
      onSubmit={handleSubmit}
      onClose={onClose}
      loading={loading}
      dirty={true}
      submitDisabled={
        !selectedCompany ||
        isCompaniesPending ||
        isCompaniesError ||
        companies.length === 0
      }
      errorSummary={error ? [{ fieldId: 'company-select', message: error }] : undefined}
    >
      <FormSection legend={t('integrations.organization.readiness.erpActivation.companyLabel', 'Company')}>
        {isCompaniesPending ? (
          <div className="rounded-lg border border-border bg-card" data-testid="companies-loading">
            <p className="px-4 pt-4 text-sm text-muted-foreground" role="status">
              {t('integrations.organization.readiness.erpActivation.loading', 'Loading Companies…')}
            </p>
            <ListState variant="loading" rows={1} />
          </div>
        ) : isCompaniesError ? (
          <div data-testid="companies-error">
            <ListState
              variant="error"
              title={t('integrations.organization.readiness.erpActivation.unavailableTitle', 'Companies unavailable')}
              sub={t('integrations.organization.readiness.erpActivation.unavailableSub', 'Your ERPNext Companies could not be read. Try again to activate the integration.')}
              onRetry={onRefetchCompanies}
              retryLabel={t('integrations.organization.readiness.retry', 'Retry')}
            />
          </div>
        ) : companies.length === 0 ? (
          <div className="rounded-lg border border-border bg-card" data-testid="companies-empty">
            <ListState
              variant="empty"
              title={t('integrations.organization.readiness.erpActivation.emptyTitle', 'No Companies found')}
              sub={t('integrations.organization.readiness.erpActivation.emptySub', 'Create a Company in ERPNext before activating this integration.')}
            />
          </div>
        ) : (
          <Combobox
            label={t('integrations.organization.readiness.erpActivation.companyLabel', 'Company')}
            value={selectedCompany}
            onChange={(value) => {
              setSelectedCompany(value as string | null);
              onSelectionChange();
            }}
            loadOptions={async () => {
              return companies.map((c) => ({ value: c.name, label: c.name }));
            }}
            placeholder={isCompaniesPending ? t('integrations.organization.readiness.erpActivation.loading', 'Loading Companies…') : t('integrations.organization.readiness.erpActivation.placeholder', 'Select a Company...')}
            disabled={isCompaniesPending}
            noun={t('integrations.organization.readiness.erpActivation.companyNoun', 'company')}
          />
        )}
      </FormSection>
      {error && (
        <FieldError id="company-select-error">
          {error}
        </FieldError>
      )}
    </EntityFormModal>
  );
};

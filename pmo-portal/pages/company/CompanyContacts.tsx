import React from 'react';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ListState } from '@/src/components/ui';
import { useContactsByCompany } from '@/src/hooks/useContacts';

/**
 * The company record page's contact surfaces (CROSS-68): the primary-contact field in the
 * account card and the page's contacts list, moved verbatim off CompanyDetail.
 */

/**
 * AC-CRM-CD-08: renders a "Primary contact" link in the account card when the company
 * has at least one contact. Uses the first contact from useContactsByCompany (sorted
 * alphabetically by the DAL). Absent when there are no contacts.
 */
export const PrimaryContactField: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { t } = useTranslation();
  const { data, isPending } = useContactsByCompany(companyId);
  if (isPending || !data || data.length === 0) return null;
  const primary = data[0];
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {t('companyDetail.field.primaryContact', 'Primary contact')}
      </dt>
      <dd className="text-[13.5px] text-foreground">
        <Link
          to={`/contacts/${primary.id}`}
          className="text-primary-text hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {primary.full_name}
        </Link>
      </dd>
    </div>
  );
};

/**
 * FR-CRM-008: read-only contacts list for the company record page.
 *
 * T15/T16w3: Shows an error state (not the misleading "No contacts yet") when the
 * fetch fails, with a Retry action. Consumes the pre-wired `useContactsByCompany` hook
 * (AC-CRM-021) — handles loading, empty, error, and populated states. Each row links
 * to the routable `/contacts/:id` page (CW-4b — the master-data graph is navigable).
 */
export const CompanyContactsList: React.FC<{ companyId: string }> = ({ companyId }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data, isPending, isError, refetch } = useContactsByCompany(companyId);

  if (isPending) {
    return (
      <p
        role="status"
        aria-label={t('companyDetail.contacts.loadingLabel', 'Loading contacts')}
        className="text-[13px] text-muted-foreground"
      >
        {t('companyDetail.contacts.loading', 'Loading…')}
      </p>
    );
  }

  // T15/T16w3: on fetch error, show the error state (not "No contacts yet").
  if (isError) {
    return (
      <ListState
        variant="error"
        title={t('companyDetail.contacts.error.title', "Couldn't load contacts")}
        sub={t('companyDetail.contacts.error.sub', 'Something went wrong. Try again.')}
        onRetry={() => refetch()}
      />
    );
  }

  const contacts = data ?? [];

  if (contacts.length === 0) {
    return (
      <p className="text-[13px] text-muted-foreground">
        {t('companyDetail.contacts.empty', 'No contacts yet')}
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-1" aria-label={t('companyDetail.contacts.listLabel', 'Contacts list')}>
      {contacts.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            onClick={() => navigate(`/contacts/${c.id}`)}
            className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            aria-label={`${t('companyDetail.contacts.openRow', 'Open')} ${c.full_name}`}
          >
            <span className="text-[14px] font-medium text-foreground">{c.full_name}</span>
            {c.title && <span className="text-[12px] text-muted-foreground">{c.title}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
};

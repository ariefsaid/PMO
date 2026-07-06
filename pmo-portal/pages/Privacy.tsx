import React from 'react';
import { LegalPageLayout, LegalSection } from '@/src/components/legal/LegalPageLayout';
import {
  LEGAL_ENTITY_NAME,
  DOMAIN,
  CONTACT_EMAIL,
  HOSTING_LOCATION,
  HELP_URL,
} from '@/src/lib/legalConfig';

/**
 * Public Privacy Policy page (FR-LEG-002/003/009/015-022, AC-LEG-002/007/013-020).
 * Bare public page for everyone — no AppShell. Template-grade; counsel refines.
 */
const Privacy: React.FC = () => (
  <LegalPageLayout eyebrow="Legal" title="Privacy Policy" variant="privacy">
    <LegalSection title="Data We Collect">
      <p className="text-muted-foreground">
        {LEGAL_ENTITY_NAME} ({DOMAIN}) collects the data you enter to operate the service — account
        and profile information, and the business records (projects, companies, contacts, financial
        and operational data) you choose to store.
      </p>
    </LegalSection>

    <LegalSection title="Data Ownership">
      <p className="text-muted-foreground">
        You (the client) own your data. {LEGAL_ENTITY_NAME} receives only the license necessary to
        operate and provide the service to you, and does not claim ownership of your data.
      </p>
    </LegalSection>

    <LegalSection title="How We Use Your Data">
      <p className="text-muted-foreground">
        We use your data to provide, maintain and improve the service, to communicate with you about
        your account, and to provide the features you enable. We do not sell your data.
      </p>
    </LegalSection>

    <LegalSection title="AI Processing Disclosure">
      <p className="text-muted-foreground">
        When you use the Assistant, your prompts and the minimum necessary data context are sent to
        third-party large-language-model providers via OpenRouter to generate a response. Your client
        data is not used to train models. {LEGAL_ENTITY_NAME} staff do not read the contents of
        Assistant conversations; only aggregates are processed for support and reliability.
      </p>
    </LegalSection>

    <LegalSection title="Data Location">
      <p className="text-muted-foreground">
        Your data is hosted on a per-client Supabase Cloud Pro environment. The hosting location for
        this deployment is {HOSTING_LOCATION} (configurable per client per ADR-0047).
      </p>
    </LegalSection>

    <LegalSection title="Data Export">
      <p className="text-muted-foreground">
        You can export your data at any time using the in-product CSV/XLSX export. On termination of
        the service, you may request a full export of your data, which we will provide within 30 days.
      </p>
    </LegalSection>

    <LegalSection title="Data Retention and Deletion">
      <p className="text-muted-foreground">
        After termination, client data is deleted within 60–90 days. You may request earlier
        deletion of specific data at any time.
      </p>
    </LegalSection>

    <LegalSection title="Confidentiality and Security">
      <p className="text-muted-foreground">
        Each party maintains mutual confidentiality of the other&rsquo;s non-public information. We
        protect your data with daily backups and per-client environment isolation.
      </p>
    </LegalSection>

    <LegalSection title="Contact Us">
      <p className="text-muted-foreground">
        For privacy questions, email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-text hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
      {HELP_URL && (
        <p className="text-muted-foreground">
          For support,{' '}
          <a
            href={HELP_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Contact support via WhatsApp"
            className="text-primary-text hover:underline"
          >
            contact us on WhatsApp
          </a>
          .
        </p>
      )}
    </LegalSection>
  </LegalPageLayout>
);

export default Privacy;

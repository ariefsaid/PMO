import React from 'react';
import { LegalPageLayout, LegalSection } from '@/src/components/legal/LegalPageLayout';
import { LEGAL_ENTITY_NAME, DOMAIN, CONTACT_EMAIL } from '@/src/lib/legalConfig';

/**
 * Public Terms of Service page (FR-LEG-001/003/008/011-014, AC-LEG-001/006/009-012).
 * Bare public page for everyone — no AppShell (FR-LEG-003). Template-grade section
 * outlines with the spec's required clauses as real prose stubs; counsel refines
 * the actual language later (spec §8 deviation 1). Config values are interpolated
 * so no bracket placeholder ever renders (FR-LEG-008).
 */
const Terms: React.FC = () => (
  <LegalPageLayout eyebrow="Legal" title="Terms of Service" variant="terms">
    <LegalSection title="Acceptance of Terms">
      <p className="text-muted-foreground">
        By accessing or using {LEGAL_ENTITY_NAME} ({DOMAIN}), you agree to be bound by these Terms
        of Service. If you do not agree, do not access or use the service.
      </p>
    </LegalSection>

    <LegalSection title="Services">
      <p className="text-muted-foreground">
        {LEGAL_ENTITY_NAME} provides a contract- and project-management platform for
        project-based organizations. Your use of the service is governed by the master subscription
        agreement (MSA) between you and {LEGAL_ENTITY_NAME}, which is the controlling commercial
        contract; these Terms address use of the platform itself.
      </p>
      <p className="text-muted-foreground">
        For questions about your subscription, contact{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="text-primary-text hover:underline">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
    </LegalSection>

    <LegalSection title="User Responsibilities">
      <p className="text-muted-foreground">
        You are responsible for the accuracy of the data you enter, for keeping your credentials
        secure, and for using the service in compliance with applicable law and these Terms.
      </p>
    </LegalSection>

    <LegalSection title="Data Ownership">
      <p className="text-muted-foreground">
        You (the client) own all data you submit to the service. You grant {LEGAL_ENTITY_NAME} only
        the license necessary to operate and provide the service to you. {LEGAL_ENTITY_NAME} does
        not claim ownership of your data.
      </p>
    </LegalSection>

    <LegalSection title="Confidentiality">
      <p className="text-muted-foreground">
        Each party agrees to keep the other party&rsquo;s confidential information confidential and
        to use it solely to perform under these Terms and the MSA.
      </p>
    </LegalSection>

    <LegalSection title="Limitation of Liability">
      <p className="text-muted-foreground">
        To the maximum extent permitted by law, {LEGAL_ENTITY_NAME}&rsquo;s liability under these
        Terms is limited to the fees paid for the service in the twelve (12) months preceding the
        claim. Neither party is liable for indirect or consequential damages.
      </p>
    </LegalSection>

    <LegalSection title="Term and Termination">
      <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
        <li><strong>Initial term:</strong> the subscription term set out in the MSA.</li>
        <li><strong>Auto-renewal:</strong> the term renews automatically for successive periods unless either party gives notice of non-renewal.</li>
        <li><strong>Termination for convenience:</strong> either party may terminate on the notice period set out in the MSA.</li>
        <li><strong>Termination for cause:</strong> either party may terminate immediately on material breach by the other party, subject to any cure period in the MSA.</li>
      </ul>
    </LegalSection>

    {/* Governing Law is HEADING-ONLY (FR-LEG-011, M12): the governing-law clause
        (Indonesia vs BANI arbitration vs district court) is a live counsel question
        (docs/legal/2026-07-04-msa-brief.md §8). The line below is a deferral marker,
        NOT a legal clause — clause text lands via counsel, not in code. */}
    <LegalSection title="Governing Law">
      <p className="text-muted-foreground italic">
        Governing law and dispute-resolution terms to be confirmed.
      </p>
    </LegalSection>
  </LegalPageLayout>
);

export default Terms;

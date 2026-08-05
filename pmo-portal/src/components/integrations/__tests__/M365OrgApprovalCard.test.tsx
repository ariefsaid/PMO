import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

// usePermission drives the FE Admin gate. Hoist a controllable boolean so each test can flip the
// caller between Admin (gate open) and non-Admin (gate closed).
const { canApprove } = vi.hoisted(() => ({ canApprove: { value: true } }));
vi.mock('@/src/auth/usePermission', () => ({
  usePermission: () => () => canApprove.value,
}));

// Mock only the card transport while retaining the real error-copy mapping used by the edge
// transport. This keeps the UI assertion tied to the wire-code mapping rather than a frozen string.
vi.mock('@/src/lib/m365/connectClient', async () => {
  const actual = await vi.importActual<typeof import('@/src/lib/m365/connectClient')>(
    '@/src/lib/m365/connectClient',
  );
  return { ...actual, initiateM365OrgApproval: vi.fn() };
});

import { M365OrgApprovalCard } from '../M365OrgApprovalCard';
import { describeM365Error, initiateM365OrgApproval } from '@/src/lib/m365/connectClient';

const assignMock = vi.fn();

beforeEach(() => {
  canApprove.value = true;
  vi.mocked(initiateM365OrgApproval).mockReset();
  // jsdom's window.location is a non-configurable stub — replace the whole object so
  // window.location.assign is observable and does not throw a cross-origin navigation error when
  // the card redirects to login.microsoftonline.com (mirrors M365ConnectionCard.test.tsx).
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign: assignMock, href: '' },
  });
  assignMock.mockClear();
});

describe('AC-M365SEP-017 — M365OrgApprovalCard visibility (FE Admin gate)', () => {
  it('AC-M365SEP-017: renders the affordance with an Approve button when the caller is an Admin', () => {
    canApprove.value = true;
    render(<M365OrgApprovalCard />);
    expect(screen.getByTestId('m365-org-approval')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /approve in microsoft 365/i }),
    ).toBeInTheDocument();
  });

  it('AC-M365SEP-017: renders NOTHING for a non-Admin (FE Admin-only; edge fn re-enforces Admin-or-Operator)', () => {
    canApprove.value = false;
    const { container } = render(<M365OrgApprovalCard />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('m365-org-approval')).not.toBeInTheDocument();
  });
});

describe('FR-M365SEP-005 — Approve calls initiate_org_approval and top-level-navigates to the consent URL', () => {
  it('FR-M365SEP-005: POSTs initiate_org_approval, then top-level-redirects to the returned adminConsentUrl', async () => {
    const adminConsentUrl =
      'https://login.microsoftonline.com/test-tenant-id/v2.0/adminconsent?client_id=test-client-id';
    vi.mocked(initiateM365OrgApproval).mockResolvedValueOnce({ adminConsentUrl });

    render(<M365OrgApprovalCard />);
    fireEvent.click(screen.getByRole('button', { name: /approve in microsoft 365/i }));

    await waitFor(() => expect(initiateM365OrgApproval).toHaveBeenCalledTimes(1));
    // Top-level navigation — Microsoft's consent page must be user-visible, never in an iframe.
    await waitFor(() => expect(assignMock).toHaveBeenCalledWith(adminConsentUrl));
  });

  it('FR-M365SEP-005: a FORBIDDEN response surfaces the reviewed human copy (no navigation, button re-enabled)', async () => {
    // The caller is an Admin on the FE but the edge fn rejected (e.g. real role not Admin + not
    // Operator). classifyM365InvokeError maps FORBIDDEN → reviewed copy; the card surfaces it and
    // does NOT navigate.
    const { AppError } = await import('@/src/lib/appError');
    vi.mocked(initiateM365OrgApproval).mockRejectedValueOnce(
      new AppError(describeM365Error('FORBIDDEN'), 'FORBIDDEN'),
    );

    render(<M365OrgApprovalCard />);
    fireEvent.click(screen.getByRole('button', { name: /approve in microsoft 365/i }));

    await waitFor(() =>
      expect(screen.getByTestId('m365-org-approval-error')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('m365-org-approval-error')).toHaveTextContent(
      describeM365Error('FORBIDDEN'),
    );
    // No navigation happened on failure.
    expect(assignMock).not.toHaveBeenCalled();
    // The button is re-enabled for a retry (phase returned to idle/error, not stuck on 'approving').
    expect(
      screen.getByRole('button', { name: /approve in microsoft 365/i }),
    ).not.toBeDisabled();
  });

  it('FR-M365SEP-005: a double-click does not fire two initiate calls (in-flight guard)', async () => {
    vi.mocked(initiateM365OrgApproval).mockResolvedValueOnce({
      adminConsentUrl: 'https://login.microsoftonline.com/test/v2.0/adminconsent',
    });

    render(<M365OrgApprovalCard />);
    const btn = screen.getByRole('button', { name: /approve in microsoft 365/i });
    fireEvent.click(btn);
    fireEvent.click(btn); // stray second synchronous click before React flushes

    await waitFor(() => expect(initiateM365OrgApproval).toHaveBeenCalledTimes(1));
  });
});

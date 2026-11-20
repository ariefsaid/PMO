# Receivables rows keep delivery and project context (#2564)

Screen unit: Receivables list (`pmo-portal/pages/SalesInvoices.tsx`, embedded in the Receivables page).

Source slice: `origin/screen/receivables` (f245e8821). Current dev already renders the project and project manager
under the client and a Delivery column in the desktop table. The slice's remaining intent is ported where dev has a gap:
the phone card and the record drawer do not show them. Money, permissions, actions and navigation are out of scope.

## Requirements (EARS)
- FR-001 When the embedded receivables list renders a row on a phone-width card, the card shall show the project and project manager line (or "Unassigned PM" when none) and the delivery state.
- FR-002 When an invoice's record drawer is open, it shall show the Project manager and Delivery fields.
- FR-003 The labels shall be available in English and Bahasa.
- FR-004 The change shall not alter amounts, outstanding values, row actions or record navigation.

## Acceptance criteria
- AC-RECV-CTX-001 Given an invoice with a project whose manager is named, when the list renders as phone cards, then the card text contains the project name, the manager name and the delivery label.
- AC-RECV-CTX-002 Given an invoice with no project or manager and no received date, then the card reads "Unassigned PM" and "Not delivered yet"; given a received date it reads "Delivered <date>".
- AC-RECV-CTX-003 Given the card is rendered in Bahasa, then it reads "PM belum ditetapkan" and "Belum dikirim".
- AC-RECV-CTX-004 Given a row is activated, when the drawer opens, then it lists "Project manager" and "Delivery" with the same values, and the invoice amount and outstanding are unchanged.

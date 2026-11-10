# Odoo client setup

How to connect a client's Odoo 20 to PMO and bring the two in step (#1504). Written from the shipped screens; names below match `public/locales/en/administration.json`. Hostnames here are placeholders (`odoo.example.test`). Revenue-specific setup (journal, tax-prepaid account) is in `odoo-client-revenue.md`.

## 1. The service user (Odoo side)

Create one internal user for PMO. **No password; an API key only.** Tested minimum group set (smallest tested on the dev bed, not a universal result):

- Purchase: User
- Inventory: User
- Accounting: **Billing** (`account.group_account_invoice`)
- **Access Rights** (`base.group_erp_manager`): needed for the retry-recovery identifiers. It is an elevated grant; the client owner reviews it before connecting.
- Project/analytic access if projects are to link cost accounts (the user must be able to read and create analytic accounts and plans).

Mint a key for that user in Odoo (Preferences, Account Security, New API Key). **Note its expiry date.** A key for an internal-only user may be capped to a short life; a Billing user can get a longer one. Put the expiry in the calendar; PMO warns before it lapses if you enter it (below).

## 2. Check the Odoo database first

- Installed apps: Purchase, Inventory, Accounting, Project, Analytic, Timesheets. A missing app makes the connection show **Some Odoo apps are missing** (state), pill **Needs attention**, with the names.
- **Indonesian localisation** (`l10n_id`) installed on the company, with the PPN taxes (11% and 12%) present. PPh (withholding) taxes are not in the stock chart; add the ones the client uses as purchase taxes on a liability account.
- Odoo 20 or later (JSON-2 API). Older versions are refused (**This Odoo version is not supported**).

## 3. Connect (PMO side, Administration, Integrations, Odoo card)

1. **Connect Odoo** opens the form *Odoo connection*: **Site URL** (public https address, e.g. `https://odoo.example.test`), **Database**, **API key**, **Key expires on (optional)**. PMO stores the key encrypted and never shows it again.
2. After connecting, the card says **Choose the Odoo company PMO works with. It cannot be changed later.** Pick the company, **Activate**.
3. **Map once** (Odoo setup checklist): PMO proposes the payable, receivable, bank, cash, expense and stock accounts, each unit PMO uses, and the default receiving warehouse. Check them, pick where it could not decide, **Accept all**. Nothing is created in Odoo by this step.

## 4. Connection states and the next step

| Pill | State line | What to do |
|---|---|---|
| Connected | healthy | nothing |
| Choose a company | Choose the Odoo company to finish connecting | pick and **Activate** |
| Needs attention | Some Odoo apps are missing | install the named apps in Odoo, then **Re-check** |
| Key expires soon | The API key expires soon | make a new key in Odoo and **Reconnect** before the date |
| Key rejected | Odoo rejected the API key | an administrator **Reconnect**s with a valid key |
| Unreachable | Odoo cannot be reached | check Odoo is online; PMO keeps trying and shows the last synced data **as of** a time; **Re-check** when it is back |
| Not connected | Odoo is not connected | **Connect Odoo** |

While Odoo is unreachable, directories stay readable at their last data. Anything that would create a record in Odoo says Odoo is unreachable and stores nothing; try again once the pill is Connected.

> **Status of the screens (2026-11-08):** the Odoo section of Integrations shows the card, the setup checklist and Map once. The record census, the bulk Accept all with counts, the send states, "Employ" and a project's send-to-Odoo button are served by the setup functions (shared with ERPNext) but are not yet mounted on the Odoo screen. Sections 5 to 7 describe the behaviour; until those screens land an operator drives them through the setup functions or the PMO CLI.

## 5. What "Accept all" creates in an empty Odoo database

Starting from a freshly installed Odoo with PMO data already in PMO, accepting the record proposals sends, once each (keyed `seed:<kind>:<id>`, looked up before create):

- **Partners**: one per PMO vendor and client, with the reference `pmo:<PMO id>`.
- **Cost accounts**: one analytic account per PMO project, coded with the project number, on the analytic plan chosen for projects.
- **Products**: one per PMO item on an open purchase.

It **never** creates accounts (chart of accounts) or taxes. Running it again creates nothing: records already linked are skipped.

When Odoo already has data, matching partners (same tax id, then same name) are linked instead of duplicated; Odoo-only partners are brought into PMO; two PMO companies with one name stay in review for a person to decide.

## 6. Reading a held send

A send is **held** when PMO could not prove whether Odoo created the record (the call timed out or the lookup came back inconclusive). Odoo has no unique constraint on a partner's reference, a product code or an analytic code, so PMO **never sends again on its own**; the row waits for a person.

1. In Odoo, search the model for the PMO reference (`pmo:<id>` for a partner, the item code for a product, the project number for an analytic account).
2. Found: link it from PMO (the record is then in step). Not found: choose **It is not there: send it again**.
3. Two hits for one reference is reported as ambiguous; archive the duplicate in Odoo, then retry.

## 7. Employing vendors and clients

Employing the companies domain makes Odoo the owner of vendor and client records (checklist step **Vendors and clients managed in Odoo**). Do this only after the record sends have finished (**Sends finished** is Done) and the held rows are resolved. After it, PMO writes to companies go to Odoo.

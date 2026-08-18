# Recurring B2B SaaS billing in Indonesia — Scalev / OrderHero vs. the real options (2026-08-18)

**Verdict: neither Scalev nor OrderHero is a fit for recurring B2B SaaS billing, but the working
assumption needs one correction — Scalev DOES have a real subscription engine.** Both are
Indonesian direct-to-consumer commerce platforms (landing page → checkout → order), aimed at
Meta-Ads sellers, COD physical goods (Scalev) and digital products/memberships (OrderHero). Scalev's
public API exposes a genuine subscription object with `interval`, billing periods, cancel-at-period-end
and upgrade/downgrade ([dev.scalev.com](https://dev.scalev.com/reference/listcustomersubscriptions.md)) —
so "no recurring at all" is **refuted for Scalev**. What neither has is the B2B side: no
invoice-with-terms (net-30), no NPWP-bearing tax invoice, no faktur pajak. Their checkout is
consumer pay-now (VA / QRIS / e-wallet / COD), not "issue an invoice, wait 30 days for a transfer".

**For a small Indonesian SaaS billing B2B contractors: the honest answer is that no Indonesian tool
gives you fully automatic recurring collection over bank transfer — VA cannot be auto-debited.**
Practical shape: manual or semi-automated invoicing (Mayar or Paper.id) + a fresh VA/payment link
per cycle + faktur pajak issued separately through Coretax/e-Faktur if you are PKP. Full auto-charge
recurring (Xendit, Midtrans) exists only over cards, e-wallets, and direct debit — instruments
Indonesian B2B buyers typically will not use.

> **Date-sensitive.** Researched 2026-08-18. Pricing, feature availability, and payment-channel
> support in this market drift fast. Re-verify before committing.

---

## 1. What Scalev and OrderHero actually are

### Scalev (scalev.id)

- Operated by **PT Interna Cipta Asia** ([scalev.id/terms](https://scalev.id/terms)).
- Self-described as an all-in-one commerce platform for **Indonesian online sellers selling via Meta
  Ads** — landing-page builder, native Meta CAPI/pixel, checkout, order management, email (Mailev)
  and WhatsApp (Waylev) ([scalev.id](https://scalev.id/)). Claims 50K+ active sellers.
- Order management explicitly covers COD physical goods with courier-aggregator pickup, and a
  **"COD Fee" charged to the user for the COD service** ([scalev.id/terms](https://scalev.id/terms),
  [tutorial.scalev.id/pembayaran-cod](https://tutorial.scalev.id/pembayaran-cod/)).
- Developer surface: Orders API, Storefront API, Landing Pages API ([dev.scalev.com](https://dev.scalev.com/)).

**Assessment: the working assumption is correct on positioning.** Scalev is a COD / social-commerce
funnel platform. It is not a B2B billing product.

### OrderHero (orderhero.id)

- Self-described as an all-in-one platform to **sell digital products** — landing page, simple
  checkout, automatic QRIS & VA payment, auto-delivery of ebooks/courses after payment; sells
  "courses, ebooks, and memberships in one digital store" (orderhero.id homepage and
  [orderhero.id/memberhero](https://orderhero.id/memberhero)).
- Companion products: **MemberHero** (a single app where buyers access memberships from multiple
  merchants) and an **Orderhero Seller** mobile app for order/GMV monitoring
  ([apps.apple.com/id/app/orderhero-seller](https://apps.apple.com/id/app/orderhero-seller/id6761782900),
  developer listed as *Helmi Andito*).
- Stated plans: Free forever; Pro from Rp 73K/month; Enterprise from Rp 118K/month (orderhero.id).

**Assessment: correct on positioning** — creator-economy / digital-product commerce, not B2B billing.

> ⚠️ **Source-quality flag (OrderHero).** `orderhero.id` returns **HTTP 403** to direct fetches
> (homepage, `/memberhero`, `/about-us`, `/tutorial` all blocked). Every OrderHero claim above except
> the App Store listing comes from **search-engine snippets quoting orderhero.id pages**, not from a
> page I read directly. The App Store listing
> ([link](https://apps.apple.com/id/app/orderhero-seller/id6761782900)) *was* fetched directly and is
> publisher-written — it describes order monitoring only and mentions **no** payment methods,
> subscriptions, or membership recurring. Treat the pricing figures and the payment-method list as
> **unconfirmed at primary-source level**.

---

## 2. Recurring / subscription billing

### Scalev — YES, a real subscription engine exists

Confirmed from the OpenAPI reference at `dev.scalev.com`. The subscription object carries
([listcustomersubscriptions](https://dev.scalev.com/reference/listcustomersubscriptions.md)):

- `interval` — enum `day` | `week` | `month` | `year`
- `interval_count` — "The number of intervals between each billing cycle"
- `current_period_start` / `current_period_end`
- `status` — `unactivated` | `active` | `canceled` | `expired` | `failed`
- `is_cancel_at_period_end`, `activated_at`, `canceled_at`, `expired_at`
- `subscription_items[]` with variant, quantity, `unit_price`

Lifecycle endpoints: [cancel at period end](https://dev.scalev.com/reference/cancelcustomersubscription.md),
[resume](https://dev.scalev.com/reference/resumecustomersubscription.md),
[upgrade](https://dev.scalev.com/reference/upgradesubscriptionitem.md) /
[downgrade](https://dev.scalev.com/reference/downgradesubscriptionitem.md) with option-listing endpoints.
That is the shape of a genuine subscription system, not a re-purchase flow.

Scalev also publishes a vendor video, *"Fitur Recurring & Subscription di Scalev (v 1.0)"*
([YouTube](https://www.youtube.com/watch?v=_YC1Et8bYHg)) — the "v 1.0" naming suggests the feature is
recent.

> ⚠️ **NOT verified — how the renewal is actually charged.** No primary source found. Specifically:
> - The subscription schema documents **no payment-method / token / saved-instrument field**. So I
>   cannot confirm whether Scalev auto-debits a stored instrument at period end or issues a fresh
>   payment (a new VA/QRIS) each cycle.
> - Scalev's published **webhook event list contains no subscription events at all** — only
>   `order.created`, `order.epayment_created`, `order.updated`, `order.deleted`,
>   `order.status_changed`, `order.payment_status_changed`, `order.spam_created`, `payment.received`,
>   `payment.failed` ([webhook-events](https://dev.scalev.com/reference/webhook-events.md)). For a
>   SaaS that needs to gate access on renewal success, **there is no documented renewal webhook**.
>   That is a hard integration blocker until disproven.
> - The checkout-payment-methods endpoint references `payment_accounts` = "Customer-saved payment
>   instruments" ([listcheckoutpaymentmethods](https://dev.scalev.com/reference/listcheckoutpaymentmethods.md)),
>   which *hints* at tokenization, but the docs do not tie these to subscriptions. **Inference, not fact.**
> - `scalev.id/fitur` refuses to list features to non-registered users
>   ([scalev.id/fitur](https://scalev.id/fitur)), so the merchant-facing description is behind signup.

**Caution on a common source confusion:** Scalev's own T&C language — *"Biaya Berlangganan dibayar di
muka dan akan ditagih sesuai dengan paket berlangganan yang dipilih"*
([scalev.id/terms](https://scalev.id/terms)) — is **Scalev billing you for your Scalev plan**, not a
description of the feature you would resell. Several secondary write-ups conflate the two.

### OrderHero — probably not true recurring; unconfirmed

OrderHero sells "memberships" and the MemberHero app grants access to purchased memberships. Snippets
describe payment auto-detection activating access without manual verification. **No source — primary
or secondary — found stating that OrderHero auto-charges a customer on a fixed interval.** No public
API documentation was located.

> ⚠️ **Gap.** I could not confirm or refute recurring billing for OrderHero. Given (a) the 403 wall,
> (b) no developer docs, and (c) the fact that VA/QRIS/bank transfer cannot be auto-debited in
> Indonesia (see §5), the *likely* model is period-limited access with manual repurchase — but that
> is **inference from the payment-method constraint, not a documented fact**.

---

## 3. Payment methods for Indonesian B2B buyers

The B2B flow you described — issue invoice, buyer pays by transfer, often net-30 — has three
requirements. Neither tool meets all three.

| Requirement | Scalev | OrderHero |
|---|---|---|
| VA / bank transfer accepted | ✅ Virtual Account, QRIS, e-wallet ([scalev.id/faq](https://scalev.id/faq)); API returns flat VA codes `va_bca`, `va_bni`, `va_mandiri` ([docs](https://dev.scalev.com/reference/listcheckoutpaymentmethods.md)) | ✅ claimed: QRIS, Virtual Account, bank transfer, "11+ methods" (orderhero.id — snippet only) |
| Invoice document with buyer NPWP/company details | ❌ no evidence found | ❌ no evidence found |
| Payment terms / net-30 (deliver first, collect later) | ❌ checkout is pay-now; COD is the only deferred-payment mode and it is goods-on-delivery, not credit | ❌ no evidence found |

Scalev's FAQ lists *"Virtual Account, QRIS, ataupun eWallet"* and separately confirms COD via courier
aggregator ([scalev.id/faq](https://scalev.id/faq)). Note that **VA ≠ net-30**: a VA is a pay-now
instrument with an expiry, not a credit term. Nothing in either product's public surface models an
invoice that sits unpaid for 30 days with reminders and aging.

> ⚠️ **Gap.** Neither product's payment-method list was obtainable at full fidelity — Scalev's is
> behind registration, OrderHero's behind a 403. The lists above are the maximum I could source.

---

## 4. Faktur pajak / Indonesian B2B accounting fit

**Neither tool issues a faktur pajak. No primary source suggests either tries to.**

This is structural, not an oversight. In Indonesia a tax invoice is not a document you print from
your billing tool:

- Only a **PKP (Pengusaha Kena Pajak)** may — and must — issue faktur pajak
  ([pajak.go.id](https://pajak.go.id/en/node/113891)).
- Issuance goes through **DJP-controlled channels only**: Coretax DJP
  (`coretaxdjp.pajak.go.id`), the e-Faktur Client Desktop application, or e-Faktur Host-to-Host via
  an authorised PJAP ([pajak.go.id](https://pajak.go.id/en/node/113891),
  [DJP e-Faktur Client Desktop guide, PDF](https://pajak.go.id/sites/default/files/2025-02/Pembuatan%20Faktur%20Pajak%20Melalui%20Aplikasi%20E-Faktur%20Client%20Desktop.pdf)).
- A digital certificate / DJP authorisation code is required to use e-Faktur.

So the realistic architecture is always **two documents**: a commercial invoice from your billing
tool, and a faktur pajak from Coretax/e-Faktur/a PJAP. No payment gateway substitutes for the second.

On Scalev specifically: its T&C says *"Biaya Berlangganan akan dikenakan PPN dan pajak lainnya yang
berlaku"* and that users may request tax documentation via official channels
([scalev.id/terms](https://scalev.id/terms)) — again, that is **Scalev issuing you a tax document for
its own fees**, not a capability you get for your customers.

> ⚠️ **Not researched here:** the current PPN rate and whether your specific SaaS supply is taxable,
> and the PKP registration turnover threshold. Deliberately omitted rather than guessed — confirm
> with a tax advisor / DJP directly.

---

## 5. Realistic alternatives

| Tool | Recurring (automatic charge) | VA / bank transfer | Invoice with terms (net-30) | Faktur pajak | Verdict for ID B2B SaaS |
|---|---|---|---|---|---|
| **Xendit** | ✅ Subscriptions product — "automatically pull funds … yearly, monthly, weekly or daily", **e-wallets, direct debit, cards only** ([xendit.co](https://www.xendit.co/en/products/subscriptions/)); requires a `payment_token_id` — tokenisation is mandatory ([docs](https://docs.xendit.co/docs/subscriptions-overview)); up to 5 linked accounts | ✅ VA as a channel — **but NOT for automated recurring** (see note) | ⚠️ Invoice/payment-link products exist with expiry; no credit-terms/aging engine found | ❌ (issues tax invoices for *its own* fees to you — [billing docs](https://docs.xendit.co/id/billing/billing-statement)) | Best auto-recurring engine, but the instruments it can auto-charge are the ones your B2B buyers won't use |
| **Midtrans** | ✅ Subscription API, "**Currently only `credit_card` and `gopay` are supported**" ([docs](https://docs.midtrans.com/reference/create-subscription)); GoPay needs tokenisation + account config by Midtrans ([GoPay Tokenization](https://docs.midtrans.com/reference/gopay-tokenization-1)) | ✅ as a one-off channel; ❌ for subscriptions | ❌ not an invoicing product | ❌ | Narrowest recurring support of the three — card or GoPay only. Wrong shape for contractor buyers |
| **Mayar** | ✅ Membership / **Membership (SaaS)** product type for recurring access; periods 1/3/6/12 months or lifetime, optional trial, setup fee, and a **grace period before deactivation if payment is not received** ([docs](https://docs.mayar.id/features/productpage/saas.md)) | ✅ Virtual Account (real-time settlement), plus QRIS, cards, e-wallets, Alfamart/Indomaret, and manual bank transfer ([docs](https://docs.mayar.id/onlinepaymentmethod.md), [mayar.id/faq](https://mayar.id/faq)) | ⚠️ Invoice API exists ([create invoice](https://docs.mayar.id/api-reference-v2/invoice/create.md)) + automatic reminders; terms/aging not documented | ❌ no tax/PPN/faktur-pajak pages in its docs index ([docs.mayar.id/llms.txt](https://docs.mayar.id/llms.txt)) | **Closest single-tool fit** — subscription semantics *and* VA in one product, explicitly pitched at SaaS ([mayar.id/software-and-saas](https://mayar.id/software-and-saas)) |
| **Paper.id** | ❌ no recurring/repeating-invoice capability found on its site | ✅ "30+ metode pembayaran" incl. virtual account, QRIS, cards, marketplace rails ([paper.id](https://www.paper.id/)) | ✅ **Its core proposition** — digital invoices with payment links, e-Meterai from PERURI, automatic reminders, and card-funded extension of buyer payment terms ([paper.id](https://www.paper.id/)) | ⚠️ supports setting PPN/PPh on an invoice and auto-calculating totals ([Paper.id blog](https://www.paper.id/blog/bisnis/template-invoice-dengan-perhitungan-pajak-mudah-otomatis/)) — **not the same as issuing a faktur pajak** | Best fit for the *invoice-and-terms* half; you'd bolt recurring on yourself |
| **Manual invoice + bank transfer** | ❌ (you cron it) | ✅ trivially | ✅ trivially — you control terms | ⚠️ you issue it yourself via Coretax / e-Faktur Client Desktop / a PJAP ([pajak.go.id](https://pajak.go.id/en/node/113891)) | Boring, ~zero fees, matches how ID contractors actually pay. The realistic v1 for low customer counts |

### The load-bearing constraint

**Virtual Account cannot be auto-debited.** Xendit's help centre answers this directly — *"Xendit
currently does not support automated recurring payments for Virtual Account yet"*, and points users
at the Recurring Payment System instead
([help.xendit.co](https://help.xendit.co/hc/en-us/articles/360031932652-Can-I-use-Virtual-Account-to-collect-payments-for-a-subscription-plan)).
Xendit's own product page corroborates by listing only **e-wallets, direct debit, and cards** as
recurring channels ([xendit.co](https://www.xendit.co/en/products/subscriptions/)), and its docs
require a payment token for every subscription ([docs](https://docs.xendit.co/docs/subscriptions-overview)).
Midtrans lands in the same place from the other side: `credit_card` and `gopay` only
([docs](https://docs.midtrans.com/reference/create-subscription)).

So for an Indonesian B2B buyer paying by transfer, "recurring billing" in practice means
**scheduled invoicing** — generate a fresh VA/payment link each cycle, chase it — never
**scheduled debiting**. Any plan that assumes auto-charge over VA is built on a false premise.

> ⚠️ **Source-quality flag (Xendit VA).** `help.xendit.co` returns **403** to direct fetch; the quote
> above is from a search-engine snippet of that Xendit-owned article. It is corroborated by two pages
> I *did* fetch directly (the product page and the subscriptions overview), so I rate the claim high
> confidence — but the exact wording is snippet-sourced.

### Other gaps in §5, stated plainly

- **Mayar renewal mechanics — NOT verified.** Its docs describe periods and a grace period but never
  say whether the renewal is an automatic debit or a re-issued payment link
  ([membership](https://docs.mayar.id/features/productpage/membership.md),
  [SaaS](https://docs.mayar.id/features/productpage/saas.md)). The existence of a *grace period before
  deactivation if payment is not received* reads as if the customer is expected to act — i.e. a new
  payment each cycle — but that is my inference, not documented.
- **Paper.id and faktur pajak — NOT verified.** Its site markets e-Meterai (PERURI), and blog content
  describes PPN/PPh fields on invoices. **No primary confirmation found of e-Faktur / Coretax
  integration.** Do not assume Paper.id issues faktur pajak.
- **Paper.id recurring — NOT verified.** No recurring-invoice feature found on its own site; treat as
  absent until shown otherwise.
- Fee schedules were not systematically compared (Mayar's FAQ shows Rp 4.000 for VA
  ([mayar.id/faq](https://mayar.id/faq)); others not gathered). Out of scope here.

---

## Practical read

1. **Drop Scalev and OrderHero** for this use case. Scalev's subscription API is real but consumer-shaped,
   has no documented renewal webhook, and neither product does invoices-with-terms or faktur pajak.
2. **If B2B contractors are the buyers:** invoice + VA/transfer per cycle is the flow that matches how
   they actually pay. Mayar (subscription semantics + VA + reminders in one tool) or Paper.id
   (invoicing/terms strength) are the two to trial; plain manual invoicing is a legitimate v1 at low
   customer counts and costs nothing to abandon.
3. **Keep faktur pajak out of the billing tool.** It's a Coretax / e-Faktur / PJAP concern, gated on PKP
   status. Design the billing tool to emit a commercial invoice carrying buyer NPWP and let the tax
   invoice be issued separately.
4. **Reserve Xendit/Midtrans auto-charge** for the segment that will link a card or e-wallet — likely
   your smaller/self-serve customers, not contractors.

## Sources not obtainable

- `orderhero.id` (all paths) — HTTP 403 to direct fetch. OrderHero facts are snippet-sourced except
  the Apple App Store listing.
- `help.xendit.co` — HTTP 403. The VA-recurring quote is snippet-sourced but corroborated elsewhere.
- `scalev.id/fitur` — feature list withheld from non-registered users by design.
- `docs.scalev.com/id` — 301-redirects to `dev.scalev.com` (developer docs); the merchant-facing help
  content was not reachable.

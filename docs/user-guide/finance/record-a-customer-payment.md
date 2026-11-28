# Record a customer payment

## What this is for

When a client pays, record the money once, then decide which invoice or invoices it settles. The
payment can cover one invoice in full, part of one invoice, or several invoices together. Money you
have not yet matched to an invoice stays on the payment as **Not yet applied** until you apply it.

## Who can do this

- **Record, apply and cancel a payment**: Admin, Finance.
- **Read payments and what they settled**: Admin, Executive, Project Manager, Finance.

## Where to find it

- **Finance** → **Receivables** → the **Payments received** tab. **Receive payment** is at the top of
  the page.
- An invoice's own page offers **Record payment** as its main button while money is still
  outstanding.
- **Finance** → **Receivables** → **Payments received** lists every receipt; click a row to open it.

## Steps

### Record the money

1. Open **Receivables** and choose **Receive payment**. The form is **Receive payment**.
2. Pick the **Customer**.
3. Pick the invoice in **Sales Invoice (optional)**.
   - With an invoice, the amount starts at what that invoice still owes. Enter **less for a part
     payment**, or more if the client paid more.
   - With no invoice, the amount is recorded as a payment on account for the customer, and you can
     apply it to invoices afterwards.
4. Check **Amount settled** and **Cash received** — what actually arrived in the bank.
5. If the client withheld tax, open **Tax withheld** and enter the **Withheld tax amount** and the
   **Withholding-slip number**. Cash received plus tax withheld must equal the amount settled.
6. Set the **Payment date**. It cannot be in the future, nor before the invoice's date.
7. Choose **Record payment**.

### Apply the money to invoices

1. In **Payments received**, click the payment's row to open its panel.
2. The panel shows **Cash received**, **Tax withheld**, **Not yet applied** and the **Withholding
   slip**, with **Invoices settled** underneath.
3. While **Not yet applied** is above zero, choose **Apply to invoices**.
4. For each invoice choose the invoice and its **Amount**. **Fill balance** puts in the invoice's
   balance or whatever is left of the payment, whichever is smaller. **Add another invoice** adds a
   row.
5. Watch **Left to apply**; it must not go below zero.
6. Choose **Apply**.

To take an amount back off an invoice, choose **Unapply** beside it and confirm. The amount returns
to **Not yet applied** on the payment, and the invoice owes it again.

## What the result looks like

- The payment appears in **Payments received** with its number, its invoice (or the first invoice and
  *+n more*), the customer, **Status**, **Amount** and **Date**. A live receipt reads **Received**.
- The payment's own page (**Payment record**) shows the **Payment total**, **Cash received**, **Tax
  withheld**, the **Withholding article** where one is recorded, and **Invoices this payment
  settled** with the amount applied to each.
- Each settled invoice's page lists the payment under **Applied receipts** and its **Outstanding**
  drops by what was applied. An invoice paid in full reads **Paid**; a part payment reads
  **Partly paid**.
- **Received this month** on the Receivables page moves by the cash received.

## Common errors and what to do

- **"Cash received plus withheld tax must equal the amount allocated to the invoice."** — correct
  either the settled amount or the cash and withholding figures so they add up.
- **"Withholding slip not entered (required for a deduction)."** — a withheld amount needs the slip
  number in **Tax withheld**.
- **"The payment date cannot be in the future."** / **"The payment date cannot be before the invoice
  date."** — correct the **Payment date**.
- **"No open invoices for this customer."** — the customer has nothing unpaid, or the open invoice is
  still a draft. Approve the invoice first, then record the payment.
- **"This invoice is waiting for approval. Approve it before applying the receipt."** — approve the
  invoice, then apply the payment.
- **"This is more than the invoice still owes (⟨amount⟩)."** — lower the amount for that invoice, or
  apply the rest to another invoice.
- **"This is more than the payment has left to apply."** — the rows add up to more than the money
  received. Lower the rows.
- **"An invoice can be listed only once."** — combine the two rows for the same invoice.
- **The wrong invoice was settled** — choose **Unapply** beside it, then apply the money again.
- **The payment was recorded twice** — cancel the duplicate: open it and choose **Cancel** in its
  menu. A cancelled receipt puts its amount back on the invoice's balance.
- **Cancelling the invoice is refused because receipts exist** — cancel the receipts recorded against
  the invoice first, then cancel the invoice.

---

## Bahasa Indonesia

# Mencatat pembayaran pelanggan

## Untuk apa ini

Saat klien membayar, catat uangnya sekali, lalu tentukan invoice mana yang dilunasi. Pembayaran
dapat melunasi satu invoice penuh, sebagian satu invoice, atau beberapa invoice sekaligus. Uang yang
belum dipasangkan ke invoice tetap pada pembayaran sebagai **Belum dialokasikan** sampai Anda
menerapkannya.

## Siapa yang dapat melakukannya

- **Mencatat, menerapkan, dan membatalkan pembayaran**: Admin, Keuangan.
- **Membaca pembayaran dan invoice yang dilunasinya**: Admin, Eksekutif, Manajer Proyek, Keuangan.

## Di mana menemukannya

- **Keuangan** → **Piutang** → tab **Pembayaran diterima**. Tombol **Catat pembayaran** ada di atas
  halaman.
- Halaman invoice sendiri menawarkan **Catat pembayaran** sebagai tombol utamanya selama masih ada
  sisa tagihan.
- **Keuangan** → **Piutang** → **Pembayaran diterima** memuat semua kuitansi; klik barisnya untuk
  membukanya.

## Langkah-langkah

### Mencatat uangnya

1. Buka **Piutang** dan pilih **Catat pembayaran**.
2. Pilih **Customer**.
3. Pilih invoice pada **Sales Invoice (optional)**.
   - Dengan invoice, jumlahnya mulai dari sisa tagihan invoice itu. Isi **lebih kecil untuk
     pembayaran sebagian**, atau lebih besar bila klien membayar lebih.
   - Tanpa invoice, jumlahnya dicatat sebagai pembayaran pelanggan tanpa invoice, dan Anda dapat
     menerapkannya ke invoice nanti.
4. Periksa **Amount settled** dan **Cash received** — uang yang benar-benar masuk ke bank.
5. Bila klien memotong pajak, buka **Tax withheld** dan isi **Withheld tax amount** serta
   **Withholding-slip number**. Kas diterima ditambah pajak dipotong harus sama dengan jumlah yang
   dilunasi.
6. Isi **Payment date**. Tanggal tidak boleh di masa depan, dan tidak boleh sebelum tanggal invoice.
7. Pilih **Record payment**.

### Menerapkan uangnya ke invoice

1. Di **Pembayaran diterima**, klik baris pembayaran untuk membuka panelnya.
2. Panel menampilkan **Kas diterima**, **Pajak dipotong**, **Belum dialokasikan**, dan
   **Bukti potong**, dengan **Invoice yang dilunasi** di bawahnya.
3. Selama **Belum dialokasikan** masih di atas nol, pilih **Terapkan ke invoice**.
4. Untuk tiap invoice, pilih invoice dan **Jumlah**-nya. **Isi sisa tagihan** mengisi sisa tagihan
   invoice atau sisa pembayaran, mana yang lebih kecil. **Tambah invoice lain** menambah baris.
5. Perhatikan **Sisa yang bisa diterapkan**; nilainya tidak boleh di bawah nol.
6. Pilih **Terapkan**.

Untuk menarik kembali sejumlah uang dari invoice, pilih **Batalkan penerapan** di sampingnya lalu
konfirmasi. Jumlahnya kembali ke **Belum dialokasikan** pada pembayaran, dan invoice kembali
memiliki sisa tagihan sebesar itu.

## Bagaimana hasilnya

- Pembayaran muncul di **Pembayaran diterima** dengan nomornya, invoice-nya (atau invoice pertama
  dan *+n lainnya*), pelanggan, **Status**, **Jumlah**, dan **Tanggal**. Kuitansi aktif bertanda
  **Received**.
- Halaman pembayaran sendiri (**Payment record**) menampilkan **Payment total**, **Kas diterima**,
  **Pajak dipotong**, **Pasal pemotongan** bila tercatat, dan **Invoice yang dilunasi pembayaran
  ini** beserta jumlah yang diterapkan pada masing-masing.
- Halaman tiap invoice yang dilunasi mencantumkan pembayarannya di bawah **Applied receipts**, dan
  **Terutang**-nya turun sebesar yang diterapkan. Invoice yang lunas bertanda **Lunas**; pembayaran
  sebagian bertanda **Dibayar sebagian**.
- **Diterima bulan ini** di halaman Piutang bergerak sebesar kas yang diterima.

## Kesalahan umum dan cara mengatasinya

- **"Cash received plus withheld tax must equal the amount allocated to the invoice."** — perbaiki
  jumlah yang dilunasi atau angka kas dan pemotongannya sehingga sama.
- **"Withholding slip not entered (required for a deduction)."** — jumlah yang dipotong memerlukan
  nomor bukti potong di **Tax withheld**.
- **"The payment date cannot be in the future."** / **"The payment date cannot be before the invoice
  date."** — perbaiki **Payment date**.
- **"No open invoices for this customer."** — pelanggan ini tidak punya tagihan terbuka, atau
  invoice-nya masih draf. Setujui invoice dulu, lalu catat pembayarannya.
- **"This invoice is waiting for approval. Approve it before applying the receipt."** — setujui
  invoice, lalu terapkan pembayarannya.
- **"This is more than the invoice still owes (⟨amount⟩)."** — turunkan jumlah untuk invoice itu,
  atau terapkan sisanya ke invoice lain.
- **"This is more than the payment has left to apply."** — barisnya melebihi uang yang diterima.
  Turunkan jumlahnya.
- **"An invoice can be listed only once."** — gabungkan dua baris untuk invoice yang sama.
- **Invoice yang dilunasi salah** — pilih **Batalkan penerapan** di sampingnya, lalu terapkan lagi.
- **Pembayaran tercatat dua kali** — batalkan yang ganda: buka lalu pilih **Cancel** pada menunya.
  Kuitansi yang dibatalkan mengembalikan jumlahnya ke sisa tagihan invoice.
- **Pembatalan ditolak karena sudah ada kuitansi** — batalkan kuitansi yang tercatat pada invoice
  itu lebih dulu, lalu batalkan invoice-nya.

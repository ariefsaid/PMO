# Record a supplier payment

## What this is for

Paying a supplier happens in two steps: the supplier's **bill** is recorded on the purchase, and then
the **payment** is recorded against that bill. When a tax amount is withheld from the supplier, it is
part of the bill, so the payment settles the bill net of it and the project's spending moves once.

## Who can do this

- **Record the supplier bill and the payment**: Admin, Finance.
- **Read purchases, bills and payments**: Admin, Executive, Project Manager, Finance.
- The person who approved a purchase cannot also pay it: another Admin or Finance user records the
  payment.

## Where to find it

- **Finance** → **Payables** → **New vendor bill**, to start from a purchase that is waiting for its
  bill.
- Or open the purchase itself: **Procurement** → the purchase → **Files** tab. The **Case documents**
  panel lists its documents and holds the capture row at its foot.

## Steps

### Record the supplier's bill, with tax withheld

1. Open the purchase and go to its **Files** tab.
2. In the capture row at the foot of **Case documents**, choose **Capture Supplier invoice** — or,
   from **Payables**, choose **New vendor bill**, pick the purchase and **Continue to the bill**.
3. Enter the supplier's **External ref** and the **Date**.
4. Enter the **Amount** and its tax treatment.
5. Set **Tax withheld** to **None**, **PPh 23** or **PPh 4(2)**. With a type chosen, enter the
   **PPh amount**. The supplier's default rate is offered as a suggestion, based on the amount; you
   can change it.
6. Save the bill.

### Record the payment

1. On the same purchase, open the capture row again and choose **Record payment**.
2. Enter the supplier's **External ref** for the payment — required.
3. Set the **Date**.
4. In **Links to invoice**, choose the supplier invoice this payment closes. The **Amount** starts at
   what that bill still owes — the invoice amount less any tax withheld. You may pay less for a
   partial payment.
5. Choose **Save Payment**.

## What the result looks like

- The **Case documents** panel gains a **Payment** row, and the bill's row shows its **Withholding**
  — what was withheld, what the supplier nets, and whether a withholding slip is on record.
- The bill leaves [Payables](what-to-pay-and-overdue.md), and **To pay suppliers** falls by the
  amount paid.
- The purchase's money figures move once: the bill raises **Invoiced** and **Unpaid**, the payment
  raises **Paid** and clears the **Unpaid** balance.
- A bill held by the three-way match says so, and its payment waits until the match is settled.

## Common errors and what to do

- **"Select the supplier invoice this payment closes."** — your organisation requires every payment
  to name its bill. Choose one in **Links to invoice**.
- **The bill is not in the list** — record the supplier invoice first, then pay it. If the bill is in
  your accounting system rather than PMO, the capture row says so and points at where to record it.
- **"Payment already in progress"** — a payment for this bill is being saved. Wait for it to finish;
  do not record it again.
- **"This purchase is held by the three-way match, so payments wait."** — the bill does not match its
  order and receipts. Review the match, record the missing receipt, or have an Admin or Finance user
  who did not record the bill approve the exception (see
  [Three-way match](../office/three-way-match.md)).
- **"Separation of duties: the approver cannot pay their own procurement."** — you approved this
  purchase. Ask another Admin or Finance user to record the payment.
- **The payment went in twice** — cancel the duplicate on the purchase's document list, then record
  it once.
- **The bill has no withholding but the supplier's slip shows one** — correct the bill's **Tax
  withheld**, then record or correct its withholding slip (see
  [Record a withholding slip](record-a-withholding-slip.md)).

---

## Bahasa Indonesia

# Mencatat pembayaran supplier

## Untuk apa ini

Membayar supplier berlangsung dua langkah: **tagihan** supplier dicatat pada pengadaan, lalu
**pembayaran** dicatat terhadap tagihan itu. Bila ada pajak yang dipotong dari supplier, pajaknya
menjadi bagian dari tagihan, sehingga pembayaran melunasi tagihan setelah dipotong pajak dan
pengeluaran proyek bergerak satu kali.

## Siapa yang dapat melakukannya

- **Mencatat tagihan supplier dan pembayarannya**: Admin, Keuangan.
- **Membaca pengadaan, tagihan, dan pembayaran**: Admin, Eksekutif, Manajer Proyek, Keuangan.
- Orang yang menyetujui pengadaan tidak dapat juga membayarnya: Admin atau pengguna Keuangan lain
  yang mencatat pembayarannya.

## Di mana menemukannya

- **Keuangan** → **Utang** → **New vendor bill**, untuk memulai dari pengadaan yang menunggu
  tagihannya.
- Atau buka pengadaannya sendiri: **Pengadaan** → pengadaan → tab **Berkas**. Panel
  **Case documents** memuat dokumennya dan baris pencatatan di kakinya.

## Langkah-langkah

### Mencatat tagihan supplier, beserta pajak yang dipotong

1. Buka pengadaannya dan masuk ke tab **Berkas**.
2. Di baris pencatatan pada kaki **Case documents**, pilih **Capture Supplier invoice** — atau, dari
   **Utang**, pilih **New vendor bill**, pilih pengadaannya, lalu **Continue to the bill**.
3. Isi **External ref** dari supplier dan **Date**.
4. Isi **Amount** dan perlakuan pajaknya.
5. Isi **Tax withheld** dengan **None**, **PPh 23**, atau **PPh 4(2)**. Setelah jenisnya dipilih,
   masukkan **PPh amount**. Tarif bawaan supplier ditawarkan sebagai usulan berdasarkan jumlahnya;
   Anda dapat mengubahnya.
6. Simpan tagihannya.

### Mencatat pembayarannya

1. Pada pengadaan yang sama, buka baris pencatatan lagi dan pilih **Record payment**.
2. Isi **External ref** pembayaran dari supplier — wajib.
3. Isi **Date**.
4. Pada **Links to invoice**, pilih invoice supplier yang dilunasi pembayaran ini. **Amount** mulai
   dari sisa tagihan invoice itu — nilai invoice dikurangi pajak yang dipotong. Anda boleh membayar
   lebih sedikit untuk pembayaran sebagian.
5. Pilih **Save Payment**.

## Bagaimana hasilnya

- Panel **Case documents** mendapat baris **Payment**, dan baris tagihannya menampilkan
  **Withholding** — berapa yang dipotong, berapa bersih untuk supplier, dan apakah bukti potongnya
  sudah tercatat.
- Tagihannya keluar dari [Utang](what-to-pay-and-overdue.md), dan
  **Yang harus dibayar kepada supplier** turun sebesar jumlah yang dibayarkan.
- Angka uang pengadaannya bergerak satu kali: tagihan menaikkan **Invoiced** dan **Unpaid**,
  pembayaran menaikkan **Paid** dan menghapus saldo **Unpaid**.
- Tagihan yang ditahan pencocokan tiga arah menyebutkannya, dan pembayarannya menunggu sampai
  pencocokannya selesai.

## Kesalahan umum dan cara mengatasinya

- **"Select the supplier invoice this payment closes."** — organisasi Anda mewajibkan setiap
  pembayaran menyebut tagihannya. Pilih satu pada **Links to invoice**.
- **Tagihannya tidak ada di daftar** — catat invoice supplier dulu, lalu bayar. Bila tagihannya ada
  di sistem akuntansi, bukan di PMO, baris pencatatan menyebutkannya dan menunjukkan tempat
  mencatatnya.
- **"Payment already in progress"** — pembayaran untuk tagihan ini sedang disimpan. Tunggu sampai
  selesai; jangan catat lagi.
- **"This purchase is held by the three-way match, so payments wait."** — tagihannya tidak cocok
  dengan pesanan dan penerimaannya. Tinjau pencocokannya, catat penerimaan yang kurang, atau minta
  Admin atau pengguna Keuangan yang tidak mencatat tagihan itu menyetujui pengecualiannya (lihat
  [Pencocokan tiga arah](../office/three-way-match.md)).
- **"Separation of duties: the approver cannot pay their own procurement."** — Anda yang menyetujui
  pengadaan ini. Minta Admin atau pengguna Keuangan lain mencatat pembayarannya.
- **Pembayaran tercatat dua kali** — batalkan yang ganda pada daftar dokumen pengadaan, lalu catat
  sekali.
- **Tagihannya tanpa pemotongan padahal bukti potong supplier menunjukkan ada** — perbaiki
  **Tax withheld** pada tagihannya, lalu catat atau perbaiki bukti potongnya (lihat
  [Mencatat bukti potong](record-a-withholding-slip.md)).

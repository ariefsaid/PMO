# Cancel an invoice and bill it again

## What this is for

Sometimes an invoice is wrong: the quantities are not what was agreed, the customer or project is
wrong, or the work was never done. Cancel the invoice so it stops counting as billed, then bill the
work again correctly.

## Who can do this

- **Cancel an invoice**: Admin, Finance.
- **Read invoices, including cancelled ones**: Admin, Executive, Finance.
- An invoice that has already been **Paid** cannot be cancelled.

## Where to find it

- **Finance** → **Receivables** → the **Invoices** tab, or the invoice's own page.
- The **Cancel** action is in the row menu (⋯ at the end of the row).

## Steps

### Cancel the invoice

1. Open **Receivables** and find the invoice.
2. Open the row menu and choose **Cancel**.
3. Read the confirm window. It says what cancelling does — the invoice stops counting as billed —
   and, if the invoice has receipts, that they must be cancelled first.
4. Choose **Cancel invoice**.

If a receipt has been recorded against the invoice, cancel the receipt first: open
**Payments received**, open the payment, and choose **Cancel** in its menu. Then cancel the invoice.

### Bill the work again

1. Check what was wrong, so the new invoice is right:
   - Wrong quantities or a wrong line: the amounts come from a claim, so the new claim carries the
     corrected quantities (see [Raise an invoice from a claim](raise-an-invoice-from-a-claim.md)).
   - Wrong customer or project: write the invoice by hand with the right ones
     (see [Create an invoice by hand](create-an-invoice.md)).
2. On the project's **Contract** tab, choose **New claim** and enter the corrected quantities.
   The cancelled invoice's quantities are free again, so the same work can be claimed.
3. Attach the evidence and choose **Raise invoice**.
4. A different Admin or Finance user approves the new invoice, as always.

The old claim stays on the project's claims list with its cancelled invoice. It cannot be invoiced
again; leave it as the record of what was cancelled.

## What the result looks like

- The cancelled invoice keeps its row in the list with the status **Cancelled**, and it is out of
  **Owed to you**, **Overdue** and the balances by age.
- Its own page shows **Cancelled**, and it offers no further action.
- The work is free to be claimed again: a new claim for the same contract quantities gets past the
  over-claim checks, and its invoice starts again as a **Draft**.

## Common errors and what to do

- **Cancel is not offered** — the invoice is **Paid**, or your role cannot change invoices. A paid
  invoice stays as it is; if money must go back, record that with your accountant.
- **"Cancel the receipts recorded against this invoice first."** — cancel the payment first, then
  the invoice.
- **"This invoice belongs to the accounting system: approve or cancel it there."** — the invoice was
  not written in PMO. Cancel it in your accounting system; PMO follows it on the next sync.
- **The work cannot be claimed again** — check that the old claim's invoice really is **Cancelled**
  and that you are raising a new claim, not trying to invoice the old one.
- **A cancelled invoice still appears in a report** — cancelled invoices are kept for the record.
  They are left out of the balances; check that the report is not filtering on the invoice number.
- **You cancelled the wrong invoice** — a cancellation cannot be undone. Raise a new invoice for the
  work, so the record shows the cancelled one and its replacement.

---

## Bahasa Indonesia

# Membatalkan invoice dan menagih ulang

## Untuk apa ini

Kadang invoice keliru: kuantitasnya tidak sesuai kesepakatan, pelanggan atau proyeknya salah, atau
pekerjaannya tidak pernah dikerjakan. Batalkan invoice-nya agar tidak lagi dihitung sebagai tertagih,
lalu tagih pekerjaannya kembali dengan benar.

## Siapa yang dapat melakukannya

- **Membatalkan invoice**: Admin, Keuangan.
- **Membaca invoice, termasuk yang dibatalkan**: Admin, Eksekutif, Keuangan.
- Invoice yang sudah **Lunas** tidak dapat dibatalkan.

## Di mana menemukannya

- **Keuangan** → **Piutang** → tab **Invoice**, atau halaman invoice itu sendiri.
- Tindakan **Cancel** ada di menu baris (⋯ di ujung baris).

## Langkah-langkah

### Membatalkan invoice

1. Buka **Piutang** dan temukan invoice-nya.
2. Buka menu baris dan pilih **Cancel**.
3. Baca jendela konfirmasinya. Isinya menjelaskan akibat pembatalan — invoice tidak lagi dihitung
   sebagai tertagih — dan, bila invoice punya kuitansi, bahwa kuitansinya harus dibatalkan lebih
   dulu.
4. Pilih **Cancel invoice**.

Bila sudah ada kuitansi pada invoice, batalkan kuitansinya lebih dulu: buka
**Pembayaran diterima**, buka pembayarannya, lalu pilih **Cancel** pada menunya. Setelah itu batalkan
invoice-nya.

### Menagih pekerjaannya lagi

1. Periksa apa yang keliru, agar invoice barunya benar:
   - Kuantitas atau baris yang salah: nilainya berasal dari klaim, jadi klaim baru membawa kuantitas
     yang sudah diperbaiki (lihat [Menerbitkan invoice dari klaim](raise-an-invoice-from-a-claim.md)).
   - Pelanggan atau proyek yang salah: tulis invoice secara manual dengan yang benar
     (lihat [Membuat invoice secara manual](create-an-invoice.md)).
2. Di tab **Kontrak** proyek, pilih **Klaim baru** dan masukkan kuantitas yang sudah diperbaiki.
   Kuantitas invoice yang dibatalkan sudah bebas lagi, sehingga pekerjaan yang sama dapat diklaim.
3. Lampirkan buktinya dan pilih **Raise invoice**.
4. Admin atau pengguna Keuangan lain menyetujui invoice baru, seperti biasa.

Klaim lama tetap ada di daftar klaim proyek bersama invoice-nya yang dibatalkan. Klaim itu tidak
dapat diterbitkan invoice lagi; biarkan sebagai catatan apa yang dibatalkan.

## Bagaimana hasilnya

- Invoice yang dibatalkan tetap punya barisnya di daftar dengan status **Dibatalkan**, dan tidak
  masuk **Piutang kepada Anda**, **Terlambat**, maupun saldo menurut umur.
- Halamannya menampilkan **Dibatalkan** dan tidak menawarkan tindakan lanjutan.
- Pekerjaannya bebas diklaim lagi: klaim baru untuk kuantitas kontrak yang sama lolos dari
  pemeriksaan kelebihan klaim, dan invoice-nya mulai lagi sebagai **Draf**.

## Kesalahan umum dan cara mengatasinya

- **Cancel tidak ditawarkan** — invoice sudah **Lunas**, atau peran Anda tidak dapat mengubah
  invoice. Invoice yang lunas dibiarkan apa adanya; bila uang harus dikembalikan, catat bersama
  akuntan Anda.
- **"Cancel the receipts recorded against this invoice first."** — batalkan pembayarannya lebih
  dulu, lalu invoice-nya.
- **"This invoice belongs to the accounting system: approve or cancel it there."** — invoice tidak
  ditulis di PMO. Batalkan di sistem akuntansi Anda; PMO mengikutinya pada sinkronisasi berikutnya.
- **Pekerjaannya tidak dapat diklaim lagi** — pastikan invoice klaim lama benar-benar
  **Dibatalkan** dan Anda membuat klaim baru, bukan mencoba menerbitkan invoice klaim lama.
- **Invoice yang dibatalkan masih muncul di laporan** — invoice yang dibatalkan disimpan sebagai
  catatan. Invoice itu tidak masuk saldo; periksa apakah laporannya menyaring berdasarkan nomor
  invoice.
- **Anda membatalkan invoice yang salah** — pembatalan tidak dapat dibatalkan. Buat invoice baru
  untuk pekerjaannya, sehingga catatan menunjukkan yang dibatalkan beserta penggantinya.

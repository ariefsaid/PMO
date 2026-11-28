# The project's money position

## What this is for

When a customer asks "what have we been invoiced, what have we paid, and what is still open?",
or when leadership wants one project's money position, the answer is on the project page. The
**Money position** panel reads like the project's life: contract, what is in work orders, what
is delivered, invoiced, paid and received, and what is spent, committed and left.

## Who can do this

- **View** the money position: Admin, Executive, Project Manager and Finance. Engineers see the
  delivery tabs; money figures their role cannot read are named, never shown as zero.
- Sales invoices and receipts themselves live under **Finance → Receivables**.

## Where to find it

Open the project. The money figures are in the header strip and in **Money position** on the
**Overview** tab; the **Contract** tab carries the bill-of-quantities and claim figures behind
them.

## Steps

1. Open the project and read the **Money position** panel from left to right:
   - **Contract** — the approved contract value, or the sum of contract quantities × rates.
   - **In work orders** — how much of the contract the client's orders draw down.
   - **Delivered** — the value of accepted quantities.
   - **Invoiced** — every non-draft, non-cancelled invoice in the project currency, including
     tax.
   - **Paid** — what the client has settled against those invoices. Paid plus the outstanding
     balance equals invoiced.
   - **Received** — customer receipts matched to the project's invoices.
   - **Spent** and **Committed** — the cost side, before tax.
   - **Left** — the contract remaining after cost.
2. To answer "what is still open", read **Invoiced** minus **Paid**. Each invoice's own
   outstanding balance is on the invoice record (open it from the project's invoices).
3. Hover a figure to see its source — every figure says how it is computed.
4. For the per-month detail behind a claim, use the **Contract** tab's billing section.

## What the result looks like

- One strip you can read aloud to the customer: contract value, invoiced to date, paid to date,
  and the balance still open.
- A figure the system cannot compute yet shows its reason — for example "Invoiced and paid are
  left out because the invoices are not all in the project currency" — instead of a wrong zero.
- Gross margin appears once invoices and spending can be compared; until then its reason is
  shown in its place.

## Common errors and what to do

- **Invoiced shows but Paid is missing** — settlement cannot be read for your role or some
  invoice balances are unknown; the note names the cause. Finance checks the invoices under
  **Receivables**.
- **Received is missing although Paid shows** — receipts are not matched to invoices yet; use
  the panel's **Match payments** link (Finance) to match them.
- **A figure says "receipt reading not verified"** — the cash figure is held back until the
  receipt reading is confirmed; do not quote it.
- **The figures disagree with the customer's statement** — invoices in draft or cancelled do
  not count as invoiced; compare invoice by invoice from the project's invoice list.
- **You see the delivery tabs but no money strip** — money access is limited on your role;
  ask Finance or an Admin.

---

## Bahasa Indonesia

# Posisi keuangan proyek

## Untuk apa ini

Bila pelanggan bertanya "berapa yang sudah kami ditagih, berapa yang sudah kami bayar, dan apa
yang masih terbuka?", atau bila pimpinan ingin posisi keuangan satu proyek, jawabannya ada di
halaman proyek. Panel **Posisi keuangan** dibaca seperti hidupnya proyek: kontrak, yang ada di
perintah kerja, yang terkirim, ditagih, dibayar, dan diterima, serta yang terpakai, terikat,
dan bersisa.

## Siapa yang dapat melakukannya

- **Melihat** posisi keuangan: Admin, Eksekutif, Manajer Proyek, dan Keuangan. Engineer melihat
  tab pelaksanaan; angka keuangan yang tidak bisa dibaca perannya disebut keterangannya, tidak
  pernah ditampilkan sebagai nol.
- Invoice penjualan dan pembuktiannya sendiri ada di **Keuangan → Piutang**.

## Di mana menemukannya

Buka proyek. Angka keuangannya ada di strip kepala halaman dan di **Posisi keuangan** pada tab
**Ringkasan**; tab **Kontrak** menyimpan angka daftar kuantitas dan klaim di belakangnya.

## Langkah-langkah

1. Buka proyek dan baca panel **Posisi keuangan** dari kiri ke kanan:
   - **Kontrak** — nilai kontrak yang disetujui, atau jumlah kuantitas kontrak × tarif.
   - **Dalam perintah kerja** — seberapa besar pesanan klien menyerap kontraknya.
   - **Terkirim** — nilai kuantitas yang diterima.
   - **Ditagih** — semua invoice dalam mata uang proyek yang bukan draf atau batal, termasuk
     pajak.
   - **Dibayar** — yang sudah dilunasi klien terhadap invoice-invoice itu. Dibayar ditambah
     saldo terutang sama dengan Ditagih.
   - **Diterima** — bukti kas pelanggan yang dicocokkan ke invoice proyek.
   - **Terpakai** dan **Terikat** — sisi biayanya, sebelum pajak.
   - **Sisa** — kontrak yang tersisa setelah biaya.
2. Untuk menjawab "apa yang masih terbuka", baca **Ditagih** dikurangi **Dibayar**. Saldo
   terutang setiap invoice ada pada catatan invoicenya (buka dari daftar invoice proyek).
3. Arahkan kursor ke sebuah angka untuk melihat sumbernya — setiap angka menyebut cara
   perhitungannya.
4. Untuk rincian per bulan di belakang sebuah klaim, gunakan bagian penagihan di tab
   **Kontrak**.

## Hasilnya seperti apa

- Satu strip yang bisa Anda bacakan kepada pelanggan: nilai kontrak, yang ditagih s.d. saat
  ini, yang dibayar s.d. saat ini, dan saldo yang masih terbuka.
- Angka yang belum bisa dihitung menampilkan alasannya — misalnya "Ditagih dan dibayar
  dikesampingkan karena invoice tidak semuanya dalam mata uang proyek" — alih-alih nol yang
  salah.
- Margin kotor muncul begitu invoice dan pengeluaran bisa dibandingkan; sebelum itu alasannya
  ditampilkan di tempatnya.

## Kesalahan umum dan cara mengatasinya

- **Ditagih tampil tetapi Dibayar tidak** — pelunasan tidak dapat dibaca peran Anda atau
  beberapa saldo invoice tidak diketahui; keterangannya menyebut sebabnya. Keuangan memeriksa
  invoice di **Piutang**.
- **Diterima tidak ada padahal Dibayar tampil** — bukti kas belum dicocokkan ke invoice; gunakan
  tautan **Cocokkan pembayaran** di panel (Keuangan) untuk mencocokkannya.
- **Sebuah angka menyebut "pembacaan kas belum terverifikasi"** — angka kasnya ditahan sampai
  pembacaan buktinya dikonfirmasi; jangan kutip angkanya.
- **Angka-angkanya tidak cocok dengan pernyataan pelanggan** — invoice draf atau batal tidak
  dihitung sebagai ditagih; bandingkan invoice demi invoice dari daftar invoice proyek.
- **Anda melihat tab pelaksanaan tetapi tanpa strip keuangan** — akses keuangan terbatas pada
  peran Anda; minta Keuangan atau Admin.

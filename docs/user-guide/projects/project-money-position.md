# The project's money position

## What this is for

When a customer asks "what have we been invoiced, what have we paid, and what is still open?",
or when leadership wants one project's money position, the answer is on the project page. The
**Money position** panel reads like the project's life: contract, what is in work orders, what
is delivered, invoiced and paid, and what is spent.

## Who can do this

- **View** the money position: Admin, Executive, Finance, and a Project Manager on the projects
  they manage. Engineers see the delivery tabs; money figures their role cannot read are named,
  never shown as zero.
- Sales invoices and receipts themselves live under **Finance → Receivables** (Admin,
  Executive, Finance).

## Where to find it

Open the project. The **Money position** panel is on the **Overview** tab, under the header
strip; the **Contract** tab carries the bill-of-quantities and claim figures behind it.

## Steps

1. Open the project and read the **Money position** panel from left to right:
   - **Contract** — the approved contract value, or the sum of contract quantities × rates.
   - **In work orders** — how much of the contract the client's orders draw down.
   - **Delivered** — the value of accepted quantities.
   - **Invoiced** — every non-draft, non-cancelled invoice in the project currency, including
     tax.
   - **Paid** — what the client has settled against those invoices. Paid plus the outstanding
     balance equals invoiced. When customer receipts are matched to the invoices, a line
     **Received …** appears under it.
   - **Spent** — the cost side, before tax, with "of … budget" under it when the project has a
     budget.
   - **Gross margin** — shown below the figures once it can be computed.
2. To answer "what is still open", read **Invoiced** minus **Paid**, or choose **Details** at
   the foot of the panel: **Project finances** shows **Invoiced**, **Settled** and
   **Outstanding** per currency.
3. Hover a figure to see its source — every figure says how it is computed.
4. The header strip above the tabs also shows **Contract remaining after cost**.

## What the result looks like

- One row you can read aloud to the customer: contract value, invoiced to date and paid to
  date.
- A figure the system cannot compute yet shows its reason — for example "Invoiced and paid are
  left out because the invoices are not all in the project currency" — instead of a wrong zero.
- **Gross margin** appears once invoices and spending can be compared; until then its reason
  is shown in the note under the figures.

## Common errors and what to do

- **Invoiced shows but Paid is missing** — some invoice balances are not known yet; the note
  under the figures says "Paid is left out until every invoice balance is known." Finance
  checks the invoices under **Receivables**.
- **Received is missing although Paid shows** — receipts are not matched to invoices yet; use
  the **Match payments** link beside the note (shown to roles that can open Finance) to match
  them.
- **A note says "Cash received (receipt reading not verified)"** — the cash figure is held back
  until the receipt reading is confirmed; do not quote it.
- **The figures disagree with the customer's statement** — invoices in draft or cancelled do
  not count as invoiced; compare invoice by invoice under **Finance → Receivables**.
- **You see the delivery tabs but no Money position** — money access is limited on your role
  (a Project Manager sees money only for the projects they manage); ask Finance or an Admin.

---

## Bahasa Indonesia

# Posisi keuangan proyek

## Untuk apa ini

Bila pelanggan bertanya "berapa yang sudah kami ditagih, berapa yang sudah kami bayar, dan apa
yang masih terbuka?", atau bila pimpinan ingin posisi keuangan satu proyek, jawabannya ada di
halaman proyek. Panel **Posisi keuangan** dibaca seperti hidupnya proyek: kontrak, yang ada di
perintah kerja, yang terkirim, ditagih, dan dibayar, serta yang terpakai.

## Siapa yang dapat melakukannya

- **Melihat** posisi keuangan: Admin, Eksekutif, Keuangan, dan Manajer Proyek pada proyek yang
  dikelolanya. Engineer melihat tab pelaksanaan; angka keuangan yang tidak bisa dibaca perannya
  disebut keterangannya, tidak pernah ditampilkan sebagai nol.
- Invoice penjualan dan penerimaannya sendiri ada di **Keuangan → Piutang** (Admin, Eksekutif,
  Keuangan).

## Di mana menemukannya

Buka proyek. Panel **Posisi keuangan** ada di tab **Ringkasan**, di bawah strip kepala halaman;
tab **Kontrak** menyimpan angka daftar kuantitas dan klaim di belakangnya.

## Langkah-langkah

1. Buka proyek dan baca panel **Posisi keuangan** dari kiri ke kanan:
   - **Kontrak** — nilai kontrak yang disetujui, atau jumlah kuantitas kontrak × tarif.
   - **Dalam perintah kerja** — seberapa besar pesanan klien menyerap kontraknya.
   - **Terkirim** — nilai kuantitas yang diterima.
   - **Ditagih** — semua invoice dalam mata uang proyek yang bukan draf atau batal, termasuk
     pajak.
   - **Dibayar** — yang sudah dilunasi klien terhadap invoice-invoice itu. Dibayar ditambah
     saldo terutang sama dengan Ditagih.
     Bila penerimaan pelanggan sudah dicocokkan ke invoice, baris **Diterima …** muncul di
     bawahnya.
   - **Terpakai** — sisi biayanya, sebelum pajak, dengan "dari anggaran …" di bawahnya bila
     proyek punya anggaran.
   - **Margin kotor** — tampil di bawah angka-angka itu begitu bisa dihitung.
2. Untuk menjawab "apa yang masih terbuka", baca **Ditagih** dikurangi **Dibayar**, atau pilih
   **Detail** di dasar panel: **Keuangan proyek** menampilkan **Ditagihkan**, **Diselesaikan**,
   dan **Belum dibayar** per mata uang.
3. Arahkan kursor ke sebuah angka untuk melihat sumbernya — setiap angka menyebut cara
   perhitungannya.
4. Strip kepala halaman di atas tab juga menampilkan **Sisa kontrak setelah biaya**.

## Hasilnya seperti apa

- Satu baris yang bisa Anda bacakan kepada pelanggan: nilai kontrak, yang ditagih s.d. saat ini,
  dan yang dibayar s.d. saat ini.
- Angka yang belum bisa dihitung menampilkan alasannya — misalnya "Ditagihkan dan dibayar tidak
  ditampilkan karena invoice tidak semuanya dalam mata uang proyek." — alih-alih nol yang
  salah.
- **Margin kotor** muncul begitu invoice dan pengeluaran bisa dibandingkan; sebelum itu
  alasannya ditampilkan di catatan di bawah angka-angka.

## Kesalahan umum dan cara mengatasinya

- **Ditagih tampil tetapi Dibayar tidak** — beberapa saldo invoice belum diketahui; catatan di
  bawah angka berbunyi "Nilai dibayar tidak ditampilkan sampai setiap saldo invoice diketahui."
  Keuangan memeriksa invoice di **Piutang**.
- **Diterima tidak ada padahal Dibayar tampil** — penerimaan belum dicocokkan ke invoice;
  gunakan tautan **Cocokkan pembayaran** di samping catatan (tampil untuk peran yang dapat
  membuka Keuangan) untuk mencocokkannya.
- **Sebuah catatan berbunyi "Kas diterima (pembacaan kwitansi belum diverifikasi)"** — angka
  kasnya ditahan sampai pembacaan buktinya dikonfirmasi; jangan kutip angkanya.
- **Angka-angkanya tidak cocok dengan pernyataan pelanggan** — invoice draf atau batal tidak
  dihitung sebagai ditagih; bandingkan invoice demi invoice di **Keuangan → Piutang**.
- **Anda melihat tab pelaksanaan tetapi tanpa Posisi keuangan** — akses keuangan terbatas pada
  peran Anda (Manajer Proyek hanya melihat keuangan proyek yang dikelolanya); minta Keuangan
  atau Admin.

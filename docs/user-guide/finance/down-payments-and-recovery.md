# Down payments and recovery

## What this is for

A **down payment** is money the client pays before the work is done. You bill it as its own claim,
and then take it back gradually: each later progress claim recovers part of it, so the client ends
up paying the contract value once, not the down payment on top of it.

PMO tracks three figures for a project: the down payment **invoiced**, how much has been
**recovered**, and how much is still **held**.

## Who can do this

- **Create a down payment claim and raise its invoice**: Admin, Finance.
- **Read the down payment figures**: Admin, Executive, Project Manager, Finance.
- The invoice for the down payment is approved by a different Admin or Finance user, like any other
  invoice (see [Approve an invoice someone else prepared](approve-an-invoice.md)).

## Where to find it

- Open the project → **Contract** tab.
- **New claim** holds the down payment form; the **Billing summary** shows
  **Down payment held**; the **Billing claims** table shows the recovery on each claim.

## Steps

### Bill the down payment

1. On the **Contract** tab choose **New claim**.
2. Set **Claim type** to **Down payment**. A project can have one down payment; once one exists the
   option is no longer offered.
3. Enter the **Down payment amount (excl. tax)** agreed with the client.
4. Set **Recovered from each claim (%)**. PMO suggests the share that matches the amount against the
   contract value; you can change it.
5. Choose **Create claim**, attach the evidence, then **Raise invoice**.
6. The invoice is created as a **Draft** and waits for a second approver.

### Recover it on later claims

1. Raise each progress claim as usual (see
   [Raise an invoice from a claim](raise-an-invoice-from-a-claim.md)).
2. Each claim recovers the agreed percentage of its own value automatically. The claim's row shows
   it in **Down payment recovered**, and the **Net** is what is claimed less the recovery.
3. On the claim that should clear the balance, tick
   **Recover the rest of the down payment with this claim**.
4. When you choose **Raise invoice**, the confirm window shows the gross amount and the recovery, so
   you can check the net before the invoice is created.

### See what is still held

1. Read **Down payment held** in the project's **Billing summary**: the invoiced down payment less
   what has been recovered.
2. The **Billing claims** table shows each claim's **Claimed**, **Down payment recovered** and
   **Net**.
3. On the invoice, the down payment and its recovery appear as lines of their own —
   **Down payment** and **Down payment recovery**.

## What the result looks like

- The down payment claim shows as **Down payment** in the claims table, with its own invoice.
- Each progress claim's **Net** is smaller than its **Claimed** by the recovery, and the project's
  **Down payment held** falls with every claim.
- Once everything is recovered, **Down payment held** reads zero. A final claim that recovers the
  rest shares the remainder across its lines.

## Common errors and what to do

- **The Down payment claim type is not offered** — the project already has a down payment claim.
  Only one is allowed per project.
- **"Enter a down payment above 0 with at most 2 decimal places"** — correct the amount.
- **"Enter a percentage above 0 and at most 100, with at most 3 decimal places"** — correct the
  recovery percentage.
- **The recovery is larger than you expected on a claim** — the percentage applies to the claim's
  value, not to what is left. Check the percentage you set when the down payment claim was created;
  the claim keeps the percentage it was made with, so a wrong one means withdrawing the claim and
  raising a new down payment claim.
- **The client disputes the net** — show the gross, the recovery and the net on the claim; the
  invoice follows the net.
- **Down payment held is lower than expected** — the figure counts a down payment only once its
  invoice is approved. While the down payment invoice is still a draft, it is not in the figure yet.

---

## Bahasa Indonesia

# Uang muka dan pemulihannya

## Untuk apa ini

**Uang muka** adalah pembayaran klien sebelum pekerjaan selesai. Uang muka ditagih sebagai klaim
tersendiri, lalu ditarik kembali secara bertahap: setiap klaim progres berikutnya memulihkan
sebagian, sehingga klien akhirnya membayar nilai kontrak satu kali, bukan uang muka di atasnya.

PMO melacak tiga angka untuk sebuah proyek: uang muka yang **ditagihkan**, yang sudah **dipulihkan**,
dan yang masih **ditahan**.

## Siapa yang dapat melakukannya

- **Membuat klaim uang muka dan menerbitkan invoice-nya**: Admin, Keuangan.
- **Membaca angka uang muka**: Admin, Eksekutif, Manajer Proyek, Keuangan.
- Invoice uang muka disetujui Admin atau pengguna Keuangan lain, seperti invoice biasa (lihat
  [Menyetujui invoice yang dibuat orang lain](approve-an-invoice.md)).

## Di mana menemukannya

- Buka proyek → tab **Kontrak**.
- **Klaim baru** memuat formulir uang muka; **Billing summary** menampilkan **Down payment held**;
  tabel **Klaim penagihan** menampilkan pemulihan pada tiap klaim.

## Langkah-langkah

### Menagih uang muka

1. Di tab **Kontrak**, pilih **Klaim baru**.
2. Isi **Claim type** dengan **Down payment**. Satu proyek hanya punya satu uang muka; setelah ada,
   pilihan itu tidak ditawarkan lagi.
3. Masukkan **Down payment amount (excl. tax)** yang disepakati dengan klien.
4. Isi **Recovered from each claim (%)**. PMO mengusulkan porsi yang sesuai dengan nilai kontrak;
   Anda dapat mengubahnya.
5. Pilih **Create claim**, lampirkan buktinya, lalu **Raise invoice**.
6. Invoice dibuat sebagai **Draf** dan menunggu penyetuju kedua.

### Memulihkannya pada klaim berikutnya

1. Terbitkan tiap klaim progres seperti biasa (lihat
   [Menerbitkan invoice dari klaim](raise-an-invoice-from-a-claim.md)).
2. Tiap klaim memulihkan persentase yang disepakati dari nilainya sendiri secara otomatis. Baris
   klaim menampilkannya pada **Down payment recovered**, dan **Net** adalah yang diklaim dikurangi
   pemulihan.
3. Pada klaim yang harus menghabiskan sisanya, centang
   **Recover the rest of the down payment with this claim**.
4. Saat memilih **Raise invoice**, jendela konfirmasi menampilkan nilai bruto dan pemulihannya,
   sehingga Anda dapat memeriksa netonya sebelum invoice dibuat.

### Melihat yang masih ditahan

1. Baca **Down payment held** di **Billing summary** proyek: uang muka yang ditagihkan dikurangi
   yang sudah dipulihkan.
2. Tabel **Klaim penagihan** menampilkan **Claimed**, **Down payment recovered**, dan **Net** tiap
   klaim.
3. Pada invoice, uang muka dan pemulihannya muncul sebagai baris tersendiri —
   **Down payment** dan **Down payment recovery**.

## Bagaimana hasilnya

- Klaim uang muka tampil sebagai **Down payment** di tabel klaim, dengan invoice-nya sendiri.
- **Net** tiap klaim progres lebih kecil dari **Claimed** sebesar pemulihannya, dan
  **Down payment held** proyek turun pada setiap klaim.
- Setelah semuanya dipulihkan, **Down payment held** bernilai nol. Klaim terakhir yang memulihkan
  sisanya membagi sisa itu ke baris-barisnya.

## Kesalahan umum dan cara mengatasinya

- **Jenis klaim Down payment tidak ditawarkan** — proyek sudah punya klaim uang muka. Satu proyek
  hanya boleh satu.
- **"Enter a down payment above 0 with at most 2 decimal places"** — perbaiki jumlahnya.
- **"Enter a percentage above 0 and at most 100, with at most 3 decimal places"** — perbaiki
  persentase pemulihannya.
- **Pemulihan pada sebuah klaim lebih besar dari yang Anda perkirakan** — persentasenya berlaku pada
  nilai klaim, bukan pada sisanya. Periksa persentase yang Anda isi saat klaim uang muka dibuat;
  klaim memakai persentase yang dipakai saat dibuat, sehingga persentase yang salah berarti menarik
  klaim lalu membuat klaim uang muka baru.
- **Klien mempertanyakan netonya** — tunjukkan bruto, pemulihan, dan neto pada klaim; invoice
  mengikuti netonya.
- **Down payment held lebih rendah dari yang diharapkan** — angka ini menghitung uang muka setelah
  invoice-nya disetujui. Selama invoice uang muka masih draf, uang muka belum masuk ke angka itu.

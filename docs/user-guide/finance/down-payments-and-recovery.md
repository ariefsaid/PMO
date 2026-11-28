# Down payments and recovery

## What this is for

A **down payment** is money the client pays before the work is done. You bill it as its own claim,
and then take it back gradually: each later progress claim recovers part of it, so the client ends
up paying the contract value once, not the down payment on top of it.

PMO shows the recovery on every claim, and the amount still **held** on the project.

## Who can do this

- **Create a down payment claim and raise its invoice**: Admin, Finance.
- **Read the down payment figures**: Admin, Executive, Project Manager, Finance.
- The invoice for the down payment is approved by a different Admin or Finance user, like any other
  invoice (see [Approve an invoice someone else prepared](approve-an-invoice.md)).

## Where to find it

- Open the project → **Contract** tab.
- **New claim** holds the down payment form. The **Claims & down payment** card shows
  **Down payment held**, and its table shows the recovery on each claim.

## Steps

### Bill the down payment

1. On the **Contract** tab choose **New claim**.
2. Set **Claim type** to **Down payment**. A project can have one down payment; once one exists the
   option is no longer offered.
3. Enter the **Down payment amount (excl. tax)** agreed with the client.
4. Set **Recovered from each claim (%)**. A hint shows **Proportional to the contract: ⟨n⟩%**; you
   can change the percentage.
5. Choose **Create claim**, attach the evidence with **Attach evidence**, then **Raise invoice**.
6. The invoice is created as a draft and waits for a second approver.

### Recover it on later claims

1. Approve the down payment invoice first. A progress claim cannot be created while the down
   payment invoice is still a draft.
2. Raise each progress claim as usual (see
   [Raise an invoice from a claim](raise-an-invoice-from-a-claim.md)).
3. Each progress claim recovers the percentage of its own value (**Claimed**) automatically, but
   never more than what is still held. The claim's row shows it in **DP recovery**, and **Net** is
   the claim less the recovery.
4. On the claim that should clear the balance, tick
   **Recover the rest of the down payment with this claim**. It recovers whatever is still held, up
   to the value of that claim.
5. When you choose **Raise invoice**, the window shows **Claimed**, **Down payment recovered** and
   **Net (excl. tax)**, so you can check the net before the invoice is created.

### See what is still held

1. Read **Down payment held** on the **Claims & down payment** card: the invoiced down payment less
   what has been recovered.
2. The card's table shows each claim's **Gross**, **DP recovery** and **Net**.
3. On the invoice, the down payment and its recovery appear as lines of their own —
   **Down payment** and **Down payment recovery**.

## What the result looks like

- The down payment claim shows as **Down payment** in the claims table, with its own invoice.
- Each progress claim's **Net** is smaller than its **Gross** by the recovery, and **Down payment
  held** falls with every recovery.
- Once everything is recovered, **Down payment held** reads zero.
- Withdrawing a claim releases its quantities and its down payment recovery for a new claim.

## Common errors and what to do

- **The Down payment claim type is not offered** — the project already has a down payment claim.
  Only one is allowed per project.
- **"Enter a down payment above 0 with at most 2 decimal places"** — correct the amount.
- **"Enter a percentage above 0 and at most 100, with at most 3 decimal places"** — correct the
  recovery percentage.
- **A progress claim cannot be created and a message says the down payment invoice has not been
  submitted yet** — approve the down payment invoice first (or withdraw the down payment claim).
- **The recovery is larger or smaller than you expected on a claim** — the percentage applies to the
  claim's own value, not to what is left, and stops at what is still held. The percentage is set on
  the down payment claim. If it is wrong and the claim has no invoice yet, use **Withdraw** in its
  menu and create it again.
- **The client disputes the net** — show the **Claimed**, **Down payment recovered** and **Net** of
  the claim; the invoice follows the net.

---

## Bahasa Indonesia

# Uang muka dan pemulihannya

## Untuk apa ini

**Uang muka** adalah uang yang dibayar klien sebelum pekerjaan selesai. Anda menagihnya sebagai
tagihan tersendiri, lalu mengambilnya kembali sedikit demi sedikit: setiap tagihan progres
berikutnya memulihkan sebagian, sehingga klien membayar nilai kontrak sekali saja, bukan uang muka
ditambah nilai kontrak.

PMO menampilkan pemulihan pada setiap tagihan, dan jumlah yang masih **tertahan** pada proyek.

## Siapa yang dapat melakukannya

- **Membuat tagihan uang muka dan menerbitkan invoice-nya**: Admin, Keuangan.
- **Membaca angka uang muka**: Admin, Eksekutif, Manajer Proyek, Keuangan.
- Invoice uang muka disetujui oleh Admin atau pengguna Keuangan lain, seperti invoice lainnya
  (lihat [Menyetujui invoice yang dibuat orang lain](approve-an-invoice.md)).

## Di mana menemukannya

- Buka proyek → tab **Kontrak**.
- **Tagihan baru** memuat formulir uang muka. Kartu **Tagihan & uang muka** menampilkan
  **Uang muka tertahan**, dan tabelnya menampilkan pemulihan pada tiap tagihan.

## Langkah-langkah

### Menagih uang muka

1. Di tab **Kontrak**, pilih **Tagihan baru**.
2. Isi **Jenis tagihan** dengan **Uang muka**. Satu proyek dapat memiliki satu uang muka; setelah ada,
   pilihannya tidak ditawarkan lagi.
3. Masukkan **Nilai uang muka (belum termasuk PPN)** yang disepakati dengan klien.
4. Isi **Dipulihkan dari setiap tagihan (%)**. Petunjuk menampilkan **Proporsional terhadap kontrak:
   ⟨n⟩%**; Anda dapat mengubah persentasenya.
5. Pilih **Buat tagihan**, lampirkan buktinya dengan **Lampirkan bukti**, lalu **Terbitkan invoice**.
6. Invoice dibuat sebagai draf dan menunggu penyetuju kedua.

### Memulihkannya pada tagihan berikutnya

1. Setujui dulu invoice uang muka. Tagihan progres tidak dapat dibuat selama invoice uang muka masih
   draf.
2. Terbitkan tiap tagihan progres seperti biasa (lihat
   [Menerbitkan invoice dari tagihan](raise-an-invoice-from-a-claim.md)).
3. Setiap tagihan progres memulihkan persentase dari nilainya sendiri (**Ditagih**) secara otomatis,
   tetapi tidak pernah lebih dari yang masih tertahan. Baris tagihannya menampilkannya di
   **Uang muka dipulihkan**, dan **Neto** adalah tagihan dikurangi pemulihan.
4. Pada tagihan yang harus melunasi sisanya, centang
   **Pulihkan sisa uang muka dengan tagihan ini**. Pilihan itu memulihkan apa yang masih tertahan,
   paling banyak sebesar nilai tagihan itu.
5. Saat Anda memilih **Terbitkan invoice**, jendelanya menampilkan **Ditagih**, **Uang muka
   dipulihkan**, dan **Neto (belum termasuk PPN)**, sehingga Anda dapat memeriksa neto sebelum
   invoice dibuat.

### Melihat yang masih tertahan

1. Baca **Uang muka tertahan** pada kartu **Tagihan & uang muka**: uang muka yang sudah ditagih
   dikurangi yang sudah dipulihkan.
2. Tabel pada kartu menampilkan **Bruto**, **Uang muka dipulihkan**, dan **Neto** tiap tagihan.
3. Pada invoice, uang muka dan pemulihannya muncul sebagai baris tersendiri — **Uang muka** dan
   **Pemulihan uang muka**.

## Bagaimana hasilnya

- Tagihan uang muka tampil sebagai **Uang muka** di tabel tagihan, dengan invoice-nya sendiri.
- **Neto** tiap tagihan progres lebih kecil daripada **Bruto**-nya sebesar pemulihan, dan **Uang muka
  tertahan** turun pada setiap pemulihan.
- Setelah semuanya dipulihkan, **Uang muka tertahan** bernilai nol.
- Menarik sebuah tagihan melepas kuantitas dan pemulihan uang mukanya untuk tagihan baru.

## Kesalahan umum dan cara mengatasinya

- **Jenis tagihan Uang muka tidak ditawarkan** — proyek sudah memiliki tagihan uang muka. Hanya satu
  yang diizinkan per proyek.
- **"Isi uang muka di atas 0 dengan paling banyak 2 angka desimal"** — perbaiki nilainya.
- **"Isi persentase di atas 0 dan paling tinggi 100, dengan paling banyak 3 angka desimal"** —
  perbaiki persentase pemulihannya.
- **Tagihan progres tidak dapat dibuat dan sebuah pesan menyebut invoice uang muka belum
  diajukan** — setujui dulu invoice uang muka (atau tarik tagihan uang mukanya).
- **Pemulihan pada sebuah tagihan lebih besar atau lebih kecil dari perkiraan Anda** — persentase
  berlaku pada nilai tagihan itu sendiri, bukan pada sisa, dan berhenti pada yang masih tertahan.
  Persentasenya ditetapkan pada tagihan uang muka. Bila salah dan tagihannya belum punya invoice,
  gunakan **Tarik** di menunya lalu buat lagi.
- **Klien mempertanyakan netonya** — tunjukkan **Ditagih**, **Uang muka dipulihkan**, dan **Neto**
  pada tagihan itu; invoice mengikuti neto.

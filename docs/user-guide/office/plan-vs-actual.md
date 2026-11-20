# Plan vs actual, and the shared-cost split

## What this is for

While a work order is running, this shows its **planned budget next to what it has actually
cost and earned** — with the margin before and after the project's shared costs — so you can
see which work orders and disciplines make or lose money while there is still time to act.

- **Direct cost** — cost records that name this work order.
- **Shared cost** — the project's cost that names no work order (project-level cost).
- **Direct margin** — billed revenue minus direct cost.
- **After shared cost** — direct margin minus this work order's allocated share of the shared
  cost.

## Who can do this

- **View** plan vs actual: Admin, Executive, Finance, Project Manager.
- **Enter or edit plan figures**: Admin, Executive, Finance, Project Manager.
- **Set or clear the shared-cost split**: Admin, Executive and Finance only.

## Where to find it

- On a project: **Contract** tab → the work-orders area shows a **Plan vs actual** card
  listing every work order and discipline with a roll-up row.
- On a single work order: open its page (see [work-orders.md](work-orders.md)) and read the
  **Plan vs actual** section — the same figures as the project card's row for that order.

## Steps

### Enter plan figures

1. On the **Plan vs actual** card or the work-order page, choose **Plan**.
2. Enter any of: **Direct budget** and **Indirect budget** (money, in the work order's
   currency), **Equipment hours**, **Crew hours** — optionally per discipline. A short note is
   allowed.
3. **Save plan**. Figures must be zero or more, with up to 2 decimals. A cancelled work
   order's plan is frozen and cannot change.

### Set a shared-cost split (optional)

By default each work order's share of the project's shared cost equals its share of the
project's positive direct cost. To set your own split:

1. On the **Plan vs actual** card, choose **Shared-cost split**.
2. Enter one percentage per work order, 0–100 with up to 4 decimals. The live total shows as
   you type and **must be exactly 100%**.
3. **Save split**. Choosing **Use the default split** clears the custom split and returns to
   the default.

## What the result looks like

- Per work order: **Planned direct**, **Direct cost** (with a note like *Over plan by 12,500*
  or *8,000 left* in words), **Planned indirect**, **Shared cost**, **Billed revenue**,
  **Direct margin** and **After shared cost**. Cost in another currency is listed apart —
  *Not comparable (other currency)* replaces the margin rather than blending currencies.
- Per discipline: a table of planned direct, direct cost, planned indirect and shared cost,
  with *No discipline* for records without one.
- **Crew hours** and **People with hours** count approved timesheet weeks only. Hours on a week
  not yet approved (draft, submitted or rejected) are not counted; a line says how many:
  *⟨n⟩ h on timesheets not yet approved are not counted.*
- Every figure can show its **basis** — the cost records behind it — on demand.
- Shared cost with no basis yet shows as **Not assigned** until a valid custom split is saved.
- Project totals always equal today's project totals: every cost record appears exactly once,
  direct or shared.

## Common problems

| What you see | What to do |
|---|---|
| *Shared cost remains unassigned until a custom split is saved.* | No work order has positive direct cost, so there is nothing to split by. Save a custom split, or wait until direct cost exists. |
| *The saved split is stale: a work order was added or cancelled since. The default is used until someone saves it again.* | Open **Shared-cost split** and save it again with the new set of work orders. |
| A percentage does not save | All percentages together must total exactly 100 (up to 4 decimals each). Adjust and save again. |
| *Work-order cost and margin are restricted for your role.* | Your role cannot read the money behind these figures. Ask Finance or an Admin. |
| *Not comparable (other currency)* | Cost exists in more than one currency on this order. PMO never blends currencies into one margin. |
| *Over plan by …* | Actual exceeds plan. The note is written in words, not shown by colour alone. |
| A plan figure is refused | Figures must be non-negative, within the org and project, use the work order's currency, and the discipline must be on the org's list. A cancelled work order's plan cannot change. |

## Bahasa Indonesia

# Rencana vs aktual, dan pembagian biaya bersama

## Untuk apa ini

Selama perintah kerja berjalan, halaman ini menampilkan **anggaran rencana di samping biaya
dan pendapatan aktualnya** — dengan margin sebelum dan sesudah biaya bersama proyek — sehingga
Anda melihat perintah kerja dan disiplin mana yang untung atau rugi ketika masih ada waktu
bertindak.

- **Biaya langsung** — catatan biaya yang menyebut perintah kerja ini.
- **Biaya bersama** — biaya proyek yang tidak menyebut perintah kerja mana pun (biaya
  tingkat proyek).
- **Margin langsung** — pendapatan ditagih dikurangi biaya langsung.
- **Setelah biaya bersama** — margin langsung dikurangi porsi biaya bersama perintah kerja
  ini.

## Siapa yang dapat melakukannya

- **Melihat** rencana vs aktual: Admin, Eksekutif, Keuangan, Manajer Proyek.
- **Memasukkan atau mengubah angka rencana**: Admin, Eksekutif, Keuangan, Manajer Proyek.
- **Menetapkan atau menghapus pembagian biaya bersama**: hanya Admin, Eksekutif, dan
  Keuangan.

## Di mana menemukannya

- Di proyek: tab **Kontrak** → area perintah kerja menampilkan kartu **Rencana vs aktual**
  yang memuat tiap perintah kerja dan disiplin beserta baris totalnya.
- Pada satu perintah kerja: buka halamannya (lihat halaman perintah kerja) dan baca bagian
  **Rencana vs aktual** — angkanya sama dengan baris pesanan itu di kartu proyek.

## Langkah-langkah

### Memasukkan angka rencana

1. Di kartu **Rencana vs aktual** atau halaman perintah kerja, pilih **Rencana**.
2. Isi salah satu dari: **Anggaran langsung** dan **Anggaran tidak langsung** (uang, dalam
   mata uang perintah kerja), **Jam alat**, **Jam kru** — opsional per disiplin. Catatan
   singkat diperbolehkan.
3. **Simpan rencana**. Angka harus nol atau lebih, paling banyak 2 desimal. Rencana perintah
   kerja yang dibatalkan dibekukan dan tidak dapat berubah.

### Menetapkan pembagian biaya bersama (opsional)

Secara bawaan, porsi tiap perintah kerja atas biaya bersama proyek sama dengan porsi biaya
langsung positifnya. Untuk menetapkan pembagian sendiri:

1. Di kartu **Rencana vs aktual**, pilih **Pembagian biaya bersama**.
2. Masukkan satu persentase per perintah kerja, 0–100 dengan paling banyak 4 desimal. Total
   berjalan tampil saat Anda mengetik dan **harus tepat 100%**.
3. **Simpan pembagian**. Memilih **Pakai pembagian bawaan** menghapus pembagian khusus dan
   kembali ke bawaan.

## Bagaimana hasilnya

- Per perintah kerja: **Rencana langsung**, **Biaya langsung** (dengan keterangan seperti
  *Melebihi rencana 12.500* atau *sisa 8.000* dalam kata-kata), **Rencana tidak langsung**,
  **Biaya bersama**, **Pendapatan ditagih**, **Margin langsung**, dan **Setelah biaya
  bersama**. Biaya dalam mata uang lain dicatat terpisah — *Tidak dapat dibandingkan (mata
  uang lain)* menggantikan margin daripada mencampur mata uang.
- Per disiplin: tabel rencana langsung, biaya langsung, rencana tidak langsung, dan biaya
  bersama, dengan *Tanpa disiplin* untuk catatan tanpa disiplin.
- **Jam kru** dan **Orang yang mencatat jam** hanya menghitung minggu timesheet yang disetujui. Jam pada
  minggu yang belum disetujui (draf, diajukan, atau ditolak) tidak dihitung; satu baris menyebut
  jumlahnya: *⟨n⟩ jam pada timesheet yang belum disetujui tidak dihitung.*
- Tiap angka dapat menampilkan **dasarnya** — catatan biaya di baliknya — sesuai permintaan.
- Biaya bersama tanpa dasar menampilkan **Belum dialokasikan** sampai pembagian khusus yang
  sah disimpan.
- Total proyek selalu sama dengan total proyek hari ini: tiap catatan biaya muncul tepat satu
  kali, langsung atau bersama.

## Masalah umum

| Yang Anda lihat | Yang perlu dilakukan |
|---|---|
| *Biaya bersama belum dialokasikan sampai pembagian khusus disimpan.* | Tidak ada perintah kerja dengan biaya langsung positif, jadi tidak ada yang menjadi dasar pembagian. Simpan pembagian khusus, atau tunggu sampai ada biaya langsung. |
| *Pembagian yang disimpan sudah usang: ada perintah kerja yang ditambah atau dibatalkan. Pembagian bawaan dipakai sampai ada yang menyimpannya lagi.* | Buka **Pembagian biaya bersama** dan simpan lagi dengan daftar perintah kerja yang baru. |
| Persentase tidak tersimpan | Semua persentase bersama-sama harus tepat 100 (masing-masing paling banyak 4 desimal). Sesuaikan lalu simpan lagi. |
| *Biaya dan margin perintah kerja dibatasi untuk peran Anda.* | Peran Anda tidak dapat membaca uang di balik angka ini. Tanyakan ke Keuangan atau Admin. |
| *Tidak dapat dibandingkan (mata uang lain)* | Biaya ada dalam lebih dari satu mata uang pada pesanan ini. PMO tidak pernah mencampur mata uang dalam satu margin. |
| *Melebihi rencana …* | Aktual melebihi rencana. Keterangan ditulis dengan kata-kata, bukan hanya warna. |
| Angka rencana ditolak | Angka harus tidak negatif, dalam organisasi dan proyek yang sama, memakai mata uang perintah kerja, dan disiplinnya harus ada pada daftar organisasi. Rencana perintah kerja yang dibatalkan tidak dapat berubah. |

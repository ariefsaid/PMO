# Work orders and the work-order page

## What this is for

A **work order** is one client order under a project — usually the client's purchase order.
It records what the client ordered, its value, and how far the work has got. One project can
hold several work orders; together they draw down the project's contract ceiling.

Every work order has its own page that gathers, in one place: what it covers, how far it has
got, what it has cost, what has been billed, what documents and issues belong to it.

## Who can do this

- **View** work orders and open the work-order page: every role.
- **Create, edit, set the value and issue** work orders: Admin, Executive, Project Manager,
  Finance. Issuing and value-setting have extra checks the server applies (for example, who
  set the value and who issues it must be separated for certain steps).
- The work-order page itself is **read-only** — creating and editing stay on the project page.

## Where to find it

- Open a project, then the **Contract** tab. The **Customer orders** section lists the
  project's work orders, with **Draft orders** kept apart until they are issued.
- Click a work order's row (or **Open page**) to open its own page.

## Steps

1. On the project's **Contract** tab, use **Add customer order** to record a new client order.
   A new order starts as a **Draft** and shows **Not yet numbered** until it is issued.
2. Fill in the order's details and allocate contract lines to it (the quantities this order
   takes from the contract).
3. Set the order value, then **Issue** it when it is ready. Issued orders get their number.
4. Later, close a finished order, or cancel one that will not proceed.
5. To follow progress day to day, click the order's row to open its page.

## What the result looks like

The work-order page shows, from top to bottom:

- **Header** — the order number (or *Not yet numbered*), the client PO number, the title, the
  status pill, the project, the client, and the **Order value** with its currency.
- **Scope and progress** — each allocated contract line with its quantity, accepted-to-date
  quantity and percent complete, plus the order's overall percent. An order with no lines
  shows an empty note with a link to allocate lines on the project.
- **Costs** — the records that carry cost for this order, grouped by source (purchase
  requests, purchase orders, goods receipts, vendor bills, timesheets, stock movements,
  equipment usage) and by discipline. Records with no discipline group under *No discipline*.
  If your role cannot read a source's money, the records still appear but the total is replaced
  by *Amount restricted for your role* — never a zero.
- **Plan vs actual** — planned budget beside actual cost and margin (see
  [plan-vs-actual.md](plan-vs-actual.md)). Shown to Admin, Executive, Finance and Project
  Manager.
- **Billing and acceptances** — **Invoiced**, **Pending**, **Paid** and **Remaining** for this
  order, and the list of acceptances (Draft, Confirmed, Final).
- **Documents** — the files linked to this order, openable in place.
- **Issues and open tasks** — issues and not-yet-done tasks that name this order.

Other records link here too: a sales invoice, an acceptance, a cost record, a task or an issue
that names the work order links to its page. Back at the list, **Work orders** takes you back
to the project.

## Common problems

| What you see | What to do |
|---|---|
| *Work order not found — It doesn't exist, or you don't have access.* | The link points to an order you cannot read (a typo, another organisation, or no access). Ask your Admin if you expect access. |
| *Not yet numbered* in place of a number | The order is still a Draft. Issue it to give it its number. |
| *Amount restricted for your role* in Costs | Your role cannot read that source's money. The records are still listed; ask Finance or an Admin for figures. |
| *Couldn't load …* on one section | Use that section's **Try again**. Other sections keep working. |
| *No contract lines are allocated to this work order yet.* | Allocate contract lines on the project (Contract tab → contract lines). |
| Issuing is refused | Issuing has server checks (for example, who set the value). The refusal message names the remedy; usually a different person must do the step. |

## Bahasa Indonesia

# Perintah kerja dan halaman perintah kerja

## Untuk apa ini

**Perintah kerja** adalah satu pesanan klien di bawah sebuah proyek — biasanya purchase order
klien. Ia mencatat apa yang dipesan klien, nilainya, dan seberapa jauh pekerjaan berjalan.
Satu proyek dapat memiliki beberapa perintah kerja; semuanya bersama-sama mengurangi pagu
kontrak proyek.

Setiap perintah kerja punya halamannya sendiri yang mengumpulkan dalam satu tempat: apa
lingkupnya, seberapa jauh kemajuannya, berapa biayanya, apa yang sudah ditagihkan, dan
dokumen serta masalah yang melekat padanya.

## Siapa yang dapat melakukannya

- **Melihat** perintah kerja dan membuka halaman perintah kerja: semua peran.
- **Membuat, mengubah, menetapkan nilai, dan menerbitkan** perintah kerja: Admin, Eksekutif,
  Manajer Proyek, Keuangan. Penerbitan dan penetapan nilai memiliki pemeriksaan tambahan dari
  server.
- Halaman perintah kerja hanya untuk **membaca** — pembuatan dan pengubahan tetap di halaman
  proyek.

## Di mana menemukannya

- Buka proyek, lalu tab **Kontrak**. Bagian **Pesanan pelanggan** memuat daftar perintah kerja
  proyek, dengan **Draf pesanan** dipisahkan sampai diterbitkan.
- Klik baris perintah kerja (atau **Buka halaman**) untuk membuka halamannya.

## Langkah-langkah

1. Di tab **Kontrak** proyek, gunakan **Tambah pesanan pelanggan** untuk mencatat pesanan
   klien baru. Pesanan baru menjadi **Draf** dan bertanda **Belum bernomor** sampai
   diterbitkan.
2. Isi detail pesanan dan alokasikan baris kontrak padanya (kuantitas yang diambil pesanan ini
   dari kontrak).
3. Tetapkan nilai pesanan, lalu **Terbitkan** saat sudah siap. Pesanan yang diterbitkan
   mendapat nomornya.
4. Kemudian, tutup pesanan yang selesai, atau batalkan pesanan yang tidak akan berjalan.
5. Untuk memantau kemajuan sehari-hari, klik baris pesanan untuk membuka halamannya.

## Bagaimana hasilnya

Halaman perintah kerja menampilkan, dari atas ke bawah:

- **Kepala halaman** — nomor pesanan (atau *Belum bernomor*), nomor PO klien, judul, pil status,
  proyek, klien, dan **Nilai pesanan** dengan mata uangnya.
- **Lingkup dan kemajuan** — tiap baris kontrak yang dialokasikan dengan kuantitasnya,
  kuantitas diterima s.d. saat ini, dan persen selesai, ditambah persen keseluruhan pesanan.
- **Biaya** — catatan yang membawa biaya untuk pesanan ini, dikelompokkan menurut sumber
  (permintaan pembelian, pesanan pembelian, penerimaan barang, tagihan vendor, lembar waktu,
  pergerakan stok, penggunaan peralatan) dan menurut disiplin. Catatan tanpa disiplin
  dikelompokkan di bawah *Tanpa disiplin*. Bila peran Anda tidak dapat membaca uang suatu
  sumber, catatannya tetap tampil tetapi totalnya diganti *Jumlah dibatasi untuk peran Anda* —
  bukan nol.
- **Rencana vs aktual** — anggaran rencana di samping biaya dan margin aktual (lihat halaman
  rencana vs aktual). Tampil untuk Admin, Eksekutif, Keuangan, dan Manajer Proyek.
- **Penagihan dan penerimaan** — **Ditagihkan**, **Menunggu**, **Dibayar**, dan **Sisa** untuk
  pesanan ini, serta daftar penerimaan (Draf, Dikonfirmasi, Akhir).
- **Dokumen** — berkas yang terhubung ke pesanan ini, dapat dibuka langsung.
- **Masalah dan tugas terbuka** — masalah dan tugas yang belum selesai yang menyebut pesanan
  ini.

Catatan lain juga menaut ke sini: faktur penjualan, penerimaan, catatan biaya, tugas, atau
masalah yang menyebut perintah kerja akan menaut ke halamannya. Dari halaman, **Perintah
kerja** mengembalikan Anda ke proyek.

## Masalah umum

| Yang Anda lihat | Yang perlu dilakukan |
|---|---|
| *Perintah kerja tidak ditemukan — Perintah kerja ini tidak ada, atau Anda tidak memiliki akses.* | Tautan menunjuk pesanan yang tidak dapat Anda baca (salah ketik, organisasi lain, atau tanpa akses). Tanyakan ke Admin bila Anda merasa seharusnya punya akses. |
| *Belum bernomor* menggantikan nomor | Pesanan masih Draf. Terbitkan untuk memberinya nomor. |
| *Jumlah dibatasi untuk peran Anda* di Biaya | Peran Anda tidak dapat membaca uang sumber itu. Catatannya tetap terdaftar; minta angka ke Keuangan atau Admin. |
| *… tidak dapat dimuat* pada satu bagian | Gunakan **Coba lagi** pada bagian itu. Bagian lain tetap berjalan. |
| *Belum ada baris kontrak yang dialokasikan ke perintah kerja ini.* | Alokasikan baris kontrak di proyek (tab Kontrak → baris kontrak). |
| Penerbitan ditolak | Penerbitan punya pemeriksaan server (misalnya, siapa yang menetapkan nilai). Pesan penolakan menyebut jalan keluarnya; biasanya orang lain yang harus melakukan langkah itu. |

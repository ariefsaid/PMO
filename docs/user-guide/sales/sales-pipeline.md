# The sales pipeline

## What this is for

The **Sales Pipeline** is the board where every prospective job travels from first contact to a
won contract — or is closed as lost or declined. You move deals forward as the client advances,
record why deals were lost, keep an eye on deals that stall, and hand a won deal over into
delivery as a project. The pipeline is also where leadership reads the forecast: each deal's
value times its chance of winning.

## Who can do this

- **View and work the pipeline:** Admin, Executive, Project Manager, Finance. Engineers do not
  have the menu — their work lives on their dashboard, projects and tasks.
- **Move a deal, mark it won/lost/declined:** Admin, Executive, Project Manager, Finance. A
  Project Manager sees "Pipeline managed by the project owner." on projects they do not manage.

## Where to find it

Open **Sales Pipeline** from the menu. Each deal **is** a project: opening a deal opens the
project's page, with a back link to the pipeline. A link like `/sales/…` always lands on that
project's page.

## Steps

### Move a deal along

1. The board shows the open stages in order — **Leads**, **Quotation submitted**, **PQ
   submitted**, **Tender submitted**, **Negotiation** — plus the two ending columns **Won** and
   **Lost**. Each card shows the deal's amount and its percentage chance to win (the board
   says when amounts exclude PPN).
2. Move a deal by dragging its card to the next column, or open the deal and use **Advance
   to …**. Moves the stage map does not allow are refused with "Move not allowed".
3. The funnel above the board is also a filter: choose a stage to see only the deals in it.
   **All** shows everything; **Won** shows the decided projects.
4. On a deal, set the two chances: **% Go** ("Chance the project proceeds") and **% Get**
   ("Chance we win if the client proceeds"), then choose **Save**.

### Win a deal

1. Drag the deal to **Won** (or choose **Mark won**).
2. Fill in **Customer contract reference** (the client's contract or PO number) and the
   **Contract date** — a future date is not allowed. Confirm with **Confirm won**.
3. The deal becomes **Won, pending kickoff**. Its estimated value is recorded as the project's
   contract value at the win.
4. To start the work, open the project and move it to **Ongoing** (**Change delivery status**
   in the project's details) — delivery begins. Record the
   customer's order as a work order on the project's contract tab; see
   [Work orders](../office/work-orders.md).
5. Before the win is offered, the value must be confirmed: if you set the contract value
   yourself, PMO asks for "a supervisor or a more senior reviewer to confirm the value" — the
   menu explains this instead of offering the win.

### Lose or decline a deal

1. **Mark lost** ends a deal that went to someone else. Choose the **Reason** (price, lost to a
   competitor, scope or fit, timing, our capacity, relationship, client cancelled or postponed,
   no decision) and add a note; a note is required for "Other".
2. **Decline to bid** records that we chose not to bid. It leaves the pipeline and is not
   counted against the win rate.
3. Both keep the deal visible in the **Lost** column, and both can be pulled back to
   **Negotiation** if the client returns.

### Watch for stalls (the pipeline review)

- **Needs attention** lists deals untouched for 30+ days or sitting 90+ days in one stage; a
  card itself is marked "Stale bid · stage unchanged for 90+ days".
- **Weighted forecast** (value × chance of winning) and **Open value** sit above the board;
  **Won** and **Lost** counts for all time sit beside them.
- The company dashboard's **Why deals were lost** panel breaks lost deals down by reason and
  win and loss by client.

## What the result looks like

- A won deal turns into an ordinary project at **Won, pending kickoff**, then **Ongoing** —
  from there it is managed on the project page like any other work.
- A lost deal stays reviewable but out of the active pipeline; its reason feeds the win-rate
  figures.
- The organisation can rename the stage names once for everyone (an Admin, under
  Administration); the guide keeps the default wording.

## Common errors and what to do

- **"Move not allowed"** — the stage map allows only the real-life moves (for example a
  quotation moves on to pre-qualification, a win or a loss, but cannot move back to a lead);
  follow the offered stages.
- **The win is not offered, and the menu says to confirm the value** — someone other than the
  person who set the contract value must do the winning; ask your supervisor or a more senior
  reviewer.
- **"Customer contract reference is required"** — the win records the client's contract or PO
  number; get it before marking the deal won.
- **"Contract date is required"**, or the date field refuses your date — a win needs a contract
  date, and it cannot be in the future.
- **"You don't have access to the Sales Pipeline"** — the pipeline is available to managers and
  finance; your role works from the dashboard, projects and tasks.
- **A deal shows "Pipeline managed by the project owner."** — you can review the stage and
  journey, but the project's manager makes the lifecycle changes.

---

## Bahasa Indonesia

# Pipeline penjualan

## Untuk apa ini

**Pipeline Penjualan** adalah papan tempat setiap pekerjaan yang ditawarkan berjalan dari
kontak pertama sampai kontrak yang dimenangkan — atau ditutup sebagai kalah atau tidak ikut
tender. Anda memindahkan kesempatan seiring klien maju, mencatat sebab kekalahan, memantau
kesempatan yang terhenti, dan menyerahkan kesempatan yang menang ke pelaksanaan sebagai proyek.
Pipeline juga tempat pimpinan membaca proyeksi: nilai tiap kesempatan dikali peluang
menangnya.

## Siapa yang dapat melakukannya

- **Melihat dan mengerjakan pipeline:** Admin, Eksekutif, Manajer Proyek, Keuangan. Engineer
  tidak punya menu ini — pekerjaannya ada di dasbor, proyek, dan tugasnya.
- **Memindahkan kesempatan, menandai menang/kalah/tidak ikut tender:** Admin, Eksekutif,
  Manajer Proyek, Keuangan. Manajer Proyek melihat "Pipeline dikelola oleh pemilik proyek."
  pada proyek yang tidak dikelolanya.

## Di mana menemukannya

Buka **Pipeline Penjualan** dari menu. Setiap kesempatan **adalah** proyek: membuka satu
kesempatan membuka halaman proyeknya, dengan tautan kembali ke pipeline. Tautan seperti
`/sales/…` selalu berlabuh di halaman proyek itu.

## Langkah-langkah

### Majukan sebuah kesempatan

1. Papan menampilkan tahap terbuka secara berurutan — **Prospek**, **Penawaran diajukan**,
   **Prakualifikasi diajukan**, **Tender diajukan**, **Negosiasi** — ditambah dua kolom akhir
   **Menang** dan **Kalah**. Setiap kartu menampilkan jumlah kesempatan dan persen peluang
   menangnya (papan menyebutkan bila jumlahnya tidak termasuk PPN).
2. Pindahkan kesempatan dengan menyeret kartunya ke kolom berikutnya, atau buka kesempatannya
   dan gunakan **Lanjutkan ke …**. Pindahan yang tidak diizinkan peta tahap ditolak dengan
   "Pemindahan tidak diizinkan".
3. Corong di atas papan juga berfungsi sebagai penyaring: pilih satu tahap untuk melihat hanya
   kesempatan di tahap itu. **Semua** menampilkan segalanya; **Menang** menampilkan yang sudah
   diputuskan.
4. Pada satu kesempatan, tetapkan dua peluang: **% Go** ("Peluang proyek berlanjut")
   dan **% Get** ("Peluang kita menang jika klien melanjutkan"), lalu pilih **Simpan**.

### Menangkan sebuah kesempatan

1. Seret kesempatannya ke **Menang** (atau pilih **Tandai menang**).
2. Isi **Referensi kontrak klien** (nomor kontrak atau PO klien) dan **Tanggal kontrak**nya —
   tanggal masa depan tidak diperbolehkan. Konfirmasi dengan **Konfirmasi menang**.
3. Kesempatan itu menjadi **Menang, menunggu rapat awal**. Nilai estimasinya tercatat sebagai
   nilai kontrak proyek saat kemenangan.
4. Untuk memulai pekerjaannya, buka proyeknya dan pindahkan ke **Berjalan** (**Ubah status
   pelaksanaan** di detail proyek) — pelaksanaan dimulai. Catat pesanan klien sebagai perintah kerja di tab kontrak proyek; lihat
   [Perintah kerja](../office/work-orders.md).
5. Sebelum kemenangan ditawarkan, nilainya harus dikonfirmasi: bila Anda sendiri yang
   menetapkan nilai kontraknya, PMO meminta "atasan atau peninjau yang lebih senior untuk
   memastikan nilai" — menunya menjelaskan ini alih-alih menawarkan kemenangan.

### Kalahkan atau tolak sebuah kesempatan

1. **Tandai kalah** mengakhiri kesempatan yang pindah ke pihak lain. Pilih **Alasan**
   (harga, kalah dari kompetitor, lingkup atau kecocokan, waktu, kapasitas kami, hubungan, klien
   membatalkan atau menunda, klien belum memutuskan) dan tambahkan catatan; catatan wajib untuk
   "Lainnya".
2. **Tidak ikut tender** mencatat bahwa kami memilih tidak menawar. Ia keluar dari pipeline dan
   tidak dihitung dalam win rate.
3. Keduanya tetap menampilkan kesempatan itu di kolom **Kalah**, dan keduanya bisa ditarik
   kembali ke **Negosiasi** bila klien kembali.

### Pantau yang terhenti (peninjauan pipeline)

- **Perlu perhatian** memuat kesempatan yang tak disentuh 30+ hari atau diam di satu
  tahap 90+ hari; kartu itu sendiri ditandai "Tender tidak aktif · tahap tidak berubah selama
  90+ hari".
- **Proyeksi tertimbang** (nilai × peluang menang) dan **Nilai terbuka** ada di atas papan;
  hitungan **Menang** dan **Kalah** sepanjang masa ada di sisinya.
- Panel **Alasan deal kalah** di dasbor perusahaan menguraikan deal yang kalah menurut alasan,
  serta menang dan kalah menurut klien.

## Hasilnya seperti apa

- Kesempatan yang menang menjadi proyek biasa pada status **Menang, menunggu rapat awal**,
  lalu **Berjalan** — dari situ ia dikelola di halaman proyek seperti pekerjaan lain.
- Kesempatan yang kalah tetap bisa ditinjau tetapi keluar dari pipeline aktif; alasannya
  memberi makan angka win rate.
- Organisasi bisa mengganti nama-nama tahap sekali untuk semua orang (oleh Admin, di
  Administrasi); panduan ini memakai kata bawaannya.

## Kesalahan umum dan cara mengatasinya

- **"Pemindahan tidak diizinkan"** — peta tahap hanya mengizinkan perpindahan yang terjadi di
  dunia nyata (misalnya penawaran lanjut ke prakualifikasi, menang, atau kalah, tetapi tidak bisa mundur ke
  prospek); ikuti tahap yang ditawarkan.
- **Kemenangan tidak ditawarkan, dan menunya meminta konfirmasi nilai** — orang selain yang
  menetapkan nilai kontrak harus yang memenangkan; minta atasan atau peninjau yang lebih
  senior.
- **"Referensi kontrak klien wajib diisi"** — kemenangan mencatat nomor kontrak atau PO klien;
  dapatkan dulu sebelum menandai menang.
- **"Tanggal kontrak wajib diisi"**, atau kolom tanggal menolak tanggal Anda — kemenangan
  perlu tanggal kontrak, dan tidak boleh bertanggal masa depan.
- **"Anda tidak memiliki akses ke Pipeline Penjualan"** — pipeline tersedia bagi manajemen dan
  keuangan; peran Anda bekerja dari dasbor, proyek, dan tugas.
- **Satu kesempatan menampilkan "Pipeline dikelola oleh pemilik proyek."** — Anda bisa
  meninjau tahap dan perjalanannya, tetapi perubahan siklusnya dilakukan manajer proyeknya.

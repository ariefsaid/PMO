# Promise work against machines that exist: availability and utilisation

## What this is for

Two figures tell you whether the plant can carry the week's plan:

- **Availability** — the share of days a machine was available to work. A machine marked **Broken**,
  **At vendor** or **Waiting for parts** does not count as available.
- **Utilisation** — the share of that available time the machine actually worked, from the machinery
  usage recorded and approved against it.

**Equipment → Availability** shows both, per machine, for a day, a week or a month, with your
organisation's targets beside them. Use it when you promise work: a machine that is below target is
either down or idle, and both are worth knowing before the plan is set.

**Who can do this:** everyone reads the availability board. The availability and utilisation figures
are shown to Admin, Executive, Finance, Project Manager and the Equipment Officer job role. Admin,
Project Manager and Engineer record the daily statuses that feed it. Admin, the Equipment Manager job
role and a Project Manager without a job role set the targets and the working hours. Finance, Admin and
the equipment job roles use the rental invoice check on the same page.

## Where to find it

**Equipment → Availability**. The day-to-day status screen is on the same page — see
[Equipment daily status](equipment-daily-status.md).

## Steps

### Read the figures

1. Open **Equipment → Availability**.
2. Under **This month**, set the **Metric interval** — **Day**, **Week** or **Month**.
3. Set **Metric period from** and **Metric period to** to the span you are planning.
4. Narrow to particular machines with **Assets for metrics**; select none to use every machine on
   the page.
5. Read the table: each machine's **Availability** with **Days available** as *x of y days*, its
   **Utilisation**, any **Awaiting approval** usage, and its **Unrecorded days**.
6. A figure under your target is shown in red with **Below target** beneath it, and the target is
   printed in the column heading.

### Set the targets and the working day

1. Choose **Targets and hours**.
2. Enter **Working hours per day** and choose **Save working hours**. This is the day length
   utilisation is measured against.
3. Set the **Availability target (%)** and the **Use target (%)**, and the **Escalate after more
   than (days down)** limit.
4. Choose **Save targets**.

## What the result looks like

- A per-period line for each machine: availability, the days it was available out of the days it was
  in service, utilisation, and how many of its days had no status at all.
- Days with no status are **not** counted in the percentages; they are counted separately as
  **Unrecorded days**, so a low figure is never quietly excused.
- Usage that is still waiting for approval shows as **Awaiting approval** and does not yet lift
  utilisation — approve the week's usage and the figure moves.
- A machine that has been down more than the escalation limit is flagged **Down more than … days**
  on the status board, and Admin and Project Manager users are told.

## Common errors and what to do

- **"No figures for this period"** — nothing was recorded in the span you chose. Widen the dates, or
  record the daily statuses first.
- **A figure is a dash** — the machine had no days in service in that period, so there is nothing to
  divide by. Check its in-service date on its own page.
- **Utilisation looks too low** — only approved usage counts. Submit and approve the machinery usage
  for the period, then look again.
- **Availability looks too low** — check the daily statuses for the period; a machine left
  **Broken** or **Waiting for parts** after it was fixed keeps the figure down until someone marks
  it **Ready**.
- **"Could not load metrics for this period."** — the read failed. Change the period or reload the
  page; the status board above keeps working.
- **Targets and hours are not offered** — your role reads availability but does not set them. Ask an
  Admin or the equipment manager.
- **The figures table is missing** — your role reads the status board but not the figures.

---

## Bahasa Indonesia

# Menjanjikan pekerjaan pada mesin yang benar-benar ada: ketersediaan dan pemanfaatan

## Untuk apa ini

Dua angka menunjukkan apakah alat dapat menanggung rencana minggu itu:

- **Ketersediaan** — bagian hari sebuah mesin tersedia untuk bekerja. Mesin berstatus **Rusak**,
  **Di supplier**, atau **Menunggu suku cadang** tidak dihitung tersedia.
- **Pemanfaatan** — bagian dari waktu tersedia yang benar-benar dipakai mesin, dari pemakaian
  peralatan yang dicatat dan disetujui.

**Peralatan → Ketersediaan** menampilkan keduanya, per mesin, untuk satu hari, satu minggu, atau satu
bulan, dengan target organisasi Anda di sampingnya. Gunakan saat Anda menjanjikan pekerjaan: mesin
yang di bawah target sedang rusak atau menganggur, dan keduanya penting diketahui sebelum rencana
ditetapkan.

**Siapa yang bisa melakukannya:** semua orang membaca papan ketersediaan. Angka ketersediaan dan
pemanfaatan ditampilkan untuk Admin, Eksekutif, Keuangan, Manajer Proyek, dan jabatan Petugas
Peralatan. Admin, Manajer Proyek, dan Insinyur mencatat status harian yang menjadi bahannya. Admin,
jabatan Manajer Peralatan, dan Manajer Proyek tanpa jabatan menetapkan target dan jam kerja. Keuangan,
Admin, dan jabatan peralatan memakai pemeriksaan tagihan sewa di halaman yang sama.

## Di mana menemukannya

**Peralatan → Ketersediaan**. Layar status harian ada di halaman yang sama — lihat [Status harian
peralatan](equipment-daily-status.md).

## Langkah-langkah

### Membaca angkanya

1. Buka **Peralatan → Ketersediaan**.
2. Di bagian **Bulan ini**, atur **Interval metrik** — **Hari**, **Minggu**, atau **Bulan**.
3. Atur **Awal periode metrik** dan **Akhir periode metrik** sesuai rentang yang Anda rencanakan.
4. Persempit ke mesin tertentu dengan **Aset untuk metrik**; kosongkan pilihan untuk memakai semua
   mesin di halaman.
5. Baca tabelnya: **Ketersediaan** setiap mesin dengan **Hari tersedia** sebagai *x dari y hari*,
   **Pemanfaatan**, pemakaian yang **Menunggu persetujuan**, dan **Hari belum dicatat**.
6. Angka di bawah target ditampilkan merah dengan **Di bawah target** di bawahnya, dan targetnya
   tercetak di judul kolom.

### Menetapkan target dan hari kerja

1. Pilih **Target dan jam kerja**.
2. Isi **Jam kerja per hari** lalu pilih **Simpan jam kerja**. Inilah panjang hari yang menjadi dasar
   pemanfaatan.
3. Isi **Target ketersediaan (%)** dan **Target pemakaian (%)**, serta **Eskalasi setelah lebih dari
   (hari rusak)**.
4. Pilih **Simpan target**.

## Hasilnya seperti apa

- Satu baris per periode untuk setiap mesin: ketersediaan, hari tersedia dibanding hari beroperasi,
  pemanfaatan, dan berapa hari yang tanpa status sama sekali.
- Hari tanpa status **tidak** dihitung dalam persentase; hari itu dihitung terpisah sebagai **Hari
  belum dicatat**, sehingga angka rendah tidak pernah diam-diam dimaafkan.
- Pemakaian yang masih menunggu persetujuan tampil sebagai **Menunggu persetujuan** dan belum
  menaikkan pemanfaatan — setujui pemakaian minggu itu dan angkanya bergerak.
- Mesin yang rusak lebih lama dari batas eskalasi ditandai **Rusak lebih dari … hari** di papan
  status, dan pengguna Admin dan Manajer Proyek diberi tahu.

## Kesalahan umum dan cara mengatasinya

- **"Tidak ada angka untuk periode ini"** — belum ada yang dicatat pada rentang yang Anda pilih.
  Lebarkan tanggalnya, atau catat status hariannya lebih dulu.
- **Angka berupa tanda hubung** — mesin tidak punya hari beroperasi pada periode itu, jadi tidak ada
  pembagi. Periksa tanggal mulai operasinya di halamannya.
- **Pemanfaatan terlihat terlalu rendah** — hanya pemakaian yang disetujui yang dihitung. Ajukan dan
  setujui pemakaian peralatan untuk periode itu, lalu lihat lagi.
- **Ketersediaan terlihat terlalu rendah** — periksa status harian pada periode itu; mesin yang
  dibiarkan **Rusak** atau **Menunggu suku cadang** setelah diperbaiki menahan angkanya sampai
  seseorang menandainya **Siap**.
- **"Metrik untuk periode ini tidak dapat dimuat."** — pembacaan gagal. Ganti periodenya atau muat
  ulang halaman; papan status di atasnya tetap berjalan.
- **Target dan jam kerja tidak ditawarkan** — peran Anda membaca ketersediaan tetapi tidak
  menetapkannya. Minta Admin atau manajer peralatan.

# Set up crews and rosters

A crew is a group of people who work together — your own staff or a supplier's people. The roster
says which crew serves which work order on which dates. Rosters are what make daily attendance
possible: a person can only be ticked present on a work order their crew is rostered on that day.

**Who can do this:** Admin, Executive, and Project Manager create and change crews, memberships and
rosters. Everyone else can read them.

## Steps

1. Open **Crews**. The page has three views: **Crews**, **Roster** and **Attendance**. This guide
   covers the first two.
2. On **Crews**, choose **New crew** and fill in:
   - **Code** and **Name** (the code must be unique among live crews),
   - **Discipline** (optional),
   - the **Field controller** — the user who records the crew's daily attendance,
   - the **Crew type**: **Own staff** or **Vendor crew**; a vendor crew names its vendor company,
   - **Standard roles** — for example foreman, welder, helper — each with its usual headcount.
3. Add the people: on a crew, choose **Add person**, pick the person (or type a new name for a
   vendor worker), a standard role, and a **From**/**To** date range. A person can be in only one
   crew on any day, so overlapping placements are refused. End a placement with **End placement**
   when someone leaves; recorded attendance stays.
4. Roster the crew onto work orders: open the **Roster** view, pick a work order, and choose
   **Roster a crew** with a crew and a date range. A crew serves one work order per day, so
   overlapping rosters are refused.
5. For a chosen date the roster shows each crew with its members and, per standard role, the
   headcount versus the people actually placed — a gap shows as **Shortfall** (for example
   "2 short").

You can also bring crews in bulk with **Import crews** and **Import crew members**.

## What the result looks like

- The work order's roster view answers "who serves this work order today?" per crew, with the
  placed count against each role's standard headcount.
- The crew stays out of the pickers after **Archive**, but its past rosters and attendance remain.
  Archiving works only when the crew has no current or future members and no roster placements.

## Common errors and what to do

- **"That code is already used by a live crew."** — pick another code. Archiving a crew frees its
  code.
- **"These dates overlap another placement. End that one first."** — the person is already in a
  crew on those dates. End the other placement from its end date, then place them again.
- **The crew cannot be archived: "End this crew's current and future members and roster placements
  first."** — end the active placements (members and rosters), then archive.
- **The roster shows a shortfall** — more people of that standard role are expected than are
  placed for that date. Place more people or lower the role's headcount.

---

## Bahasa Indonesia

# Menyiapkan kru dan jadwal kru

Kru adalah sekelompok orang yang bekerja bersama — staf sendiri atau orang-orang dari supplier.
Jadwal kru menyatakan kru mana yang melayani perintah kerja mana pada tanggal berapa. Jadwal inilah
yang memungkinkan kehadiran harian: orang hanya bisa ditandai hadir pada perintah kerja yang
dijadwali untuk kru mereka pada hari itu.

**Siapa yang bisa melakukannya:** Admin, Eksekutif, dan Manajer Proyek membuat dan mengubah kru,
keanggotaan, dan jadwal. Pengguna lain hanya dapat melihatnya.

## Langkah-langkah

1. Buka **Kru**. Halaman ini punya tiga tampilan: **Kru**, **Jadwal kru**, dan **Kehadiran**.
   Panduan ini membahas dua yang pertama.
2. Di **Kru**, pilih **Kru baru** dan isi:
   - **Kode** dan **Nama** (kode harus unik di antara kru yang aktif),
   - **Disiplin** (opsional),
   - **Pengawas lapangan** — pengguna yang mencatat kehadiran harian kru,
   - **Jenis kru**: **Staf sendiri** atau **Kru supplier**; kru supplier menyebut perusahaan
     suppliernya,
   - **Peran standar** — misalnya mandor, juru las, helper — masing-masing dengan jumlah orang
     biasanya.
3. Tambahkan orangnya: pada sebuah kru, pilih **Tambah orang**, pilih orangnya (atau ketik nama
   baru untuk pekerja supplier), peran standarnya, dan rentang tanggal **Dari**/**Sampai**. Satu
   orang hanya boleh ada di satu kru pada hari yang sama, jadi penempatan yang tumpang tindih
   ditolak. Akhiri penempatan dengan **Akhiri penempatan** saat ada yang keluar; kehadiran yang
   sudah tercatat tetap ada.
4. Jadwalkan kru ke perintah kerja: buka tampilan **Jadwal kru**, pilih perintah kerjanya, dan
   pilih **Jadwalkan kru** beserta kru dan rentang tanggalnya. Satu kru melayani satu perintah
   kerja per hari, jadi jadwal yang tumpang tindih ditolak.
5. Untuk tanggal yang dipilih, jadwal menampilkan setiap kru beserta anggotanya dan, per peran
   standar, jumlah orang yang diharapkan dibanding yang benar-benar ditempatkan — selisihnya tampil
   sebagai **Kekurangan** (misalnya "kurang 2").

Anda juga bisa memasukkan kru secara massal dengan **Impor kru** dan **Impor anggota kru**.

## Hasilnya seperti apa

- Tampilan jadwal perintah kerja menjawab "siapa yang melayani perintah kerja ini hari ini?" per
  kru, dengan jumlah yang ditempatkan dibanding jumlah standar setiap peran.
- Setelah **Arsipkan**, kru keluar dari daftar pilihan, tetapi jadwal dan kehadiran lamanya tetap
  ada. Pengarsipan hanya bisa dilakukan bila kru tidak punya anggota dan penempatan jadwal yang
  berjalan atau akan datang.

## Kesalahan umum dan cara mengatasinya

- **"Kode itu sudah dipakai kru yang aktif."** — pilih kode lain. Mengarsipkan sebuah kru
  membebaskan kodenya.
- **"Tanggal ini tumpang tindih dengan penempatan lain. Akhiri yang itu dulu."** — orang itu sudah
  ada di kru lain pada tanggal-tanggal itu. Akhiri penempatan lainnya sampai tanggalnya, lalu
  tempatkan lagi.
- **Kru tidak bisa diarsipkan: "Akhiri dulu anggota dan penempatan jadwal kru ini yang sedang
  berjalan dan yang akan datang."** — akhiri penempatan yang aktif (anggota dan jadwal), lalu
  arsipkan.
- **Jadwal menunjukkan kekurangan** — orang dengan peran standar itu yang diharapkan lebih banyak
  daripada yang ditempatkan untuk tanggal itu. Tempatkan lebih banyak orang atau turunkan jumlah
  orang perannya.

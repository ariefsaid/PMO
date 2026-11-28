# Email notifications and scheduled reports

## What this is for

PMO already shows a bell with in-app notifications. This page adds email: which events also send an
email, in which language, and which reports are emailed to people or roles on a schedule. It exists so
nobody has to open PMO just to find out that something is waiting for them.

**Who can do this:** an **Admin** turns the email events on, picks the extra roles copied on each, and
sets the email language. An Admin manages every scheduled report. Where an Admin has switched on
**Project Control Manager can schedule reports** (at the top of **Administration → Scheduled
reports**), a person with the **Project Control Manager** job role may also create and manage scheduled
reports they can read, for recipients who can read them too.

## Where to find it

- **Administration → Organization integrations**, then the **Organization settings** view — **Email
  notifications**.
- **Administration → Scheduled reports**.
- **Site reports**, then **Send this report every …** — to schedule the daily progress summary from
  where you read it.

## Steps

### Turn on an email event

1. Open **Administration → Organization integrations** and switch to **Organization settings**.
2. Under **Email notifications**, each event has its own switch: **Approval requests**, **Billing
   steps**, **Overdue items**, **Expiring documents**. Every event is off until you turn it on.
3. Turn on the ones you want. For an event that is on, tick any roles under **Also email these
   roles**.
4. Choose the **Email language** — **English** or **Indonesian**.
5. Save with the page's save action.
6. Tell people they can opt out in their own profile: **Send me email notifications**. In-app
   notifications are not affected by that choice.

### Schedule a report

1. Open **Administration → Scheduled reports** and choose **Add a scheduled report**.
2. Fill in:
   - **Name** — what the email is called in the list.
   - **Report** — **Daily progress summary** or **Overdue tasks**.
   - **Repeats** — **Daily** or **Weekly**; for weekly, choose the day under **On**.
   - **Send time** — the time it goes out, in the organisation timezone.
   - **Send to these roles** and **And these people** — at least one role or person.
3. Choose **Save report**.
4. Use the switch on a row to pause or resume it (the row shows **On** or **Off**), **Edit** to change it, or **Archive** to stop it for
   good.

## What the result looks like

- Each event shows **On** or **Off**, and its roles are copied when it fires. A person's own opt-out
  still wins for them.
- A scheduled report row shows its name, the report kind, and when it repeats — **Every day at …** or
  a weekday at a time — with its **On**/**Off** switch.
- Each recipient sees only the figures their role allows; the same report sent to different people is
  filtered per person.
- Archiving a report stops it sending; emails already sent are not affected.
- If a change could not be saved, the page says **The change was not saved**.

## Common errors and what to do

- **"Email settings could not be loaded."** — the read failed. Use **Try again**.
- **"The change was not saved"** — the save failed; the page gives the detail. Try again, and if it
  keeps failing tell your administrator.
- **A report will not save** — it needs a name, at least one role or person, a repeat choice (and a
  day, when weekly), and a send time. The **Save report** button stays inactive until all are filled.
- **"Scheduled reports are managed by an Admin or an enabled Project Control Manager."** — your role
  cannot manage them. Ask an Admin.
- **"No scheduled reports yet."** — none has been added. **Add a scheduled report**.
- **Someone gets no email** — check the event is **On**, check their profile's **Send me email
  notifications** is ticked, and check their email address is right.
- **A report arrives at the wrong hour** — times follow the organisation timezone; correct the **Send
  time** or ask an Admin about the organisation's timezone.

---

## Bahasa Indonesia

# Notifikasi email dan laporan terjadwal

## Untuk apa ini

PMO sudah menampilkan lonceng dengan notifikasi di dalam aplikasi. Halaman ini menambahkan email:
kejadian mana yang juga mengirim email, dalam bahasa apa, dan laporan mana yang dikirim lewat email
kepada orang atau peran sesuai jadwal. Tujuannya agar tidak ada yang perlu membuka PMO hanya untuk
tahu ada sesuatu yang menunggu.

**Siapa yang bisa melakukannya:** **Admin** menyalakan kejadian email, memilih peran tambahan yang
disalin pada tiap kejadian, dan menetapkan bahasa email. Admin mengelola semua laporan terjadwal. Bila
Admin menyalakan **Manajer Pengendalian Proyek dapat menjadwalkan laporan** (di bagian atas
**Administrasi → Laporan terjadwal**), orang dengan jabatan **Manajer Pengendalian Proyek** juga dapat
membuat dan mengelola laporan terjadwal yang boleh ia baca, untuk penerima yang juga boleh
membacanya.

## Di mana menemukannya

- **Administrasi → Integrasi organisasi**, lalu tampilan **Pengaturan organisasi** — **Notifikasi
  email**.
- **Administrasi → Laporan terjadwal**.
- **Laporan lokasi**, lalu **Kirim laporan ini setiap …** — untuk menjadwalkan ringkasan progres
  harian dari tempat Anda membacanya.

## Langkah-langkah

### Menyalakan kejadian email

1. Buka **Administrasi → Integrasi organisasi** dan pilih **Pengaturan organisasi**.
2. Di bagian **Notifikasi email**, setiap kejadian punya sakelar sendiri: **Permintaan persetujuan**,
   **Langkah penagihan**, **Item terlambat**, **Dokumen akan kedaluwarsa**. Semua kejadian nonaktif
   sampai Anda menyalakannya.
3. Nyalakan yang Anda inginkan. Untuk kejadian yang aktif, centang peran mana pun di **Kirim juga ke
   peran ini**.
4. Pilih **Bahasa email** — **Inggris** atau **Bahasa Indonesia**.
5. Simpan dengan aksi simpan halaman.
6. Beri tahu orang bahwa mereka dapat berhenti menerima di profilnya: **Kirim notifikasi email kepada
   saya**. Notifikasi di dalam aplikasi tidak terpengaruh pilihan itu.

### Menjadwalkan laporan

1. Buka **Administrasi → Laporan terjadwal** dan pilih **Tambah laporan terjadwal**.
2. Isi:
   - **Nama** — sebutan email itu di daftar.
   - **Laporan** — **Ringkasan progres harian** atau **Tugas terlambat**.
   - **Berulang** — **Harian** atau **Mingguan**; untuk mingguan, pilih harinya di **Pada hari**.
   - **Jam kirim** — waktu pengirimannya, menurut zona waktu organisasi.
   - **Kirim ke peran ini** dan **Dan orang ini** — setidaknya satu peran atau orang.
3. Pilih **Simpan laporan**.
4. Gunakan sakelar pada barisnya untuk menjeda atau melanjutkan (baris menampilkan **Aktif** atau **Nonaktif**), **Ubah** untuk menggantinya, atau
   **Arsipkan** untuk menghentikannya selamanya.

## Hasilnya seperti apa

- Setiap kejadian menampilkan **Aktif** atau **Nonaktif**, dan perannya disalin saat kejadian itu
  terjadi. Pilihan berhenti milik seseorang tetap berlaku untuk dirinya.
- Baris laporan terjadwal menampilkan namanya, jenis laporannya, dan kapan berulang — **Setiap hari
  pada …** atau hari tertentu pada jam tertentu — dengan sakelar **Aktif**/**Nonaktif**.
- Setiap penerima hanya melihat angka yang diizinkan perannya; laporan yang sama yang dikirim ke orang
  berbeda disaring per orang.
- Mengarsipkan laporan menghentikan pengirimannya; email yang sudah terkirim tidak terpengaruh.
- Bila perubahan tidak dapat disimpan, halaman menyatakan **Perubahan tidak tersimpan**.

## Kesalahan umum dan cara mengatasinya

- **"Pengaturan email tidak dapat dimuat."** — pembacaan gagal. Gunakan **Coba lagi**.
- **"Perubahan tidak tersimpan"** — penyimpanan gagal; halaman menyebutkan detailnya. Coba lagi, dan
  bila terus gagal beri tahu administrator Anda.
- **Laporan tidak mau tersimpan** — perlu nama, setidaknya satu peran atau orang, pilihan
  pengulangan (dan hari, bila mingguan), serta jam kirim. Tombol **Simpan laporan** tetap tidak aktif
  sampai semuanya terisi.
- **"Laporan terjadwal dikelola oleh Admin atau Project Control Manager yang diaktifkan."** — peran
  Anda tidak dapat mengelolanya. Minta Admin.
- **"Belum ada laporan terjadwal."** — belum ada yang ditambahkan. Pilih **Tambah laporan
  terjadwal**.
- **Seseorang tidak menerima email** — periksa kejadiannya **Aktif**, centang **Kirim notifikasi email
  kepada saya** di profilnya, dan pastikan alamat emailnya benar.
- **Laporan datang di jam yang salah** — waktunya mengikuti zona waktu organisasi; betulkan **Jam
  kirim** atau tanyakan zona waktu organisasi kepada Admin.

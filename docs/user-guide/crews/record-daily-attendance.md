# Record daily attendance

Daily attendance is the tick sheet for a crew's day on a work order: who was present, for how many
hours, plus overtime. Once a full week is saved it is sent for approval, and the approved hours
become that person's hours for the week — with no retyping into a timesheet.

**Who can do this:** the crew's field controller (named on the crew), and managers — Admin,
Executive, Project Manager. A week is approved by a manager who recorded none of it: you cannot
approve hours you recorded yourself.

## Steps

1. Open **Crews** and go to the **Attendance** view.
2. Choose a **Work order** ("Choose a work order to record its crew's day"). For the chosen date
   the page lists each crew serving that work order that day, with its members.
3. Type the **Hours for the crew** — this fills everyone's hours at once — and adjust the hours per
   person if someone worked differently. Hours only apply to a present person.
4. For each person set the status: **Present**, **Absent**, **Leave** or **Off rotation**. A person
   who is off rotation that day can only be marked present with a **Reason** in their row.
5. Optionally attach a **Group photo** of the crew as evidence.
6. Choose **Save attendance**.
7. At the end of the week choose **Send the week for approval**. The week then waits for a manager;
   they **Approve** it (the approved days lock) or **Return** it for correction.

## What the result looks like

- The week appears as "Week of &lt;date&gt;" and shows each person's present days and hours.
- After approval the hours per person and work order exist without anyone retyping them. For people
  with a login the weekly timesheet is submitted for approval automatically; for people without a
  login (vendor crews) the approved hours are kept on the attendance record itself.
- Approved hours feed work-order cost and the people hours shown on the daily site report.
- At the top of the attendance view, managers also see **"Weeks waiting for your approval"** —
  the weeks of people without a login (vendor crews), approved or returned right here. For people
  with a login, the week is approved on their timesheet.

## Common errors and what to do

- **"Attendance cannot be recorded for a future date."** — pick today or an earlier date.
- **"The earliest date open for attendance is &lt;date&gt;."** — your organisation only allows a
  limited number of days back (often 7). Attendance older than that must be corrected through your
  administrator.
- **"This person already has N hours on &lt;work order&gt; that day. A day holds at most 24."** —
  the person was ticked on another work order too. Lower the hours so the whole day stays within
  24.
- **"This person is not in a crew rostered on this work order that day."** — place the person in
  the crew or roster the crew onto the work order for that date first (see
  [Set up crews and rosters](set-up-crews-and-roster.md)).
- **"Off rotation: give a reason"** — the person is on leave rotation that day; write why they are
  nevertheless present.
- **"This week is sent for approval. Return it to change a day."** — wait for the manager to return
  the week, or ask them to return it; you cannot change a sent week yourself.
- **"You recorded these hours, so someone else approves them."** — approval needs a manager who did
  not record any of this week.
- **Days where check-in and roster disagree** — when a day has records from two sources with
  different hours, the week cannot be sent until those days are settled: open the day, pick the
  correct hours, and save.

---

## Bahasa Indonesia

# Mencatat kehadiran harian

Kehadiran harian adalah lembar centang hari kerja sebuah kru pada perintah kerja: siapa yang
hadir, berapa jam, ditambah lembur. Setelah satu minggu penuh tersimpan, minggunya dikirim untuk
persetujuan, dan jam yang disetujui menjadi jam orang itu untuk seminggu — tanpa mengetik ulang ke
lembar waktu.

**Siapa yang bisa melakukannya:** pengawas lapangan kru (tercantum di kru), dan para manajer —
Admin, Eksekutif, Manajer Proyek. Minggu disetujui oleh manajer yang tidak mencatatnya sama sekali:
Anda tidak bisa menyetujui jam yang Anda catat sendiri.

## Langkah-langkah

1. Buka **Kru** dan masuk ke tampilan **Kehadiran**.
2. Pilih **Perintah kerja** ("Pilih perintah kerja untuk mencatat hari kerja krunya"). Untuk
   tanggal yang dipilih, halaman menampilkan setiap kru yang melayani perintah kerja itu hari itu,
   beserta anggotanya.
3. Isi **Jam untuk kru** — ini mengisi jam semua orang sekaligus — lalu sesuaikan jam per orang
   bila ada yang bekerja berbeda. Jam hanya berlaku bagi yang berstatus hadir.
4. Untuk setiap orang atur statusnya: **Hadir**, **Absen**, **Cuti**, atau **Libur rotasi**. Orang
   yang libur rotasi hari itu hanya bisa ditandai hadir dengan sebuah **Alasan** di barisnya.
5. Opsional: lampirkan **Foto kelompok** kru sebagai bukti.
6. Pilih **Simpan kehadiran**.
7. Di akhir minggu pilih **Kirim minggu ini untuk persetujuan**. Minggunya lalu menunggu manajer;
   mereka **Setujui** (hari yang disetujui terkunci) atau **Kembalikan** untuk dikoreksi.

## Hasilnya seperti apa

- Minggunya tampil sebagai "Minggu &lt;tanggal&gt;" dan menunjukkan hari hadir serta jam setiap
  orang.
- Setelah persetujuan, jam per orang dan per perintah kerja sudah ada tanpa ada yang mengetik
  ulang. Untuk orang yang punya akun, lembar waktu mingguannya otomatis dikirim untuk persetujuan;
  untuk orang tanpa akun (kru supplier) jam yang disetujui disimpan pada catatan kehadirannya
  sendiri.
- Jam yang disetujui masuk ke biaya perintah kerja dan ke jam orang yang tampil pada laporan
  lapangan harian.
- Di bagian atas tampilan kehadiran, manajer juga melihat **"Minggu yang menunggu persetujuan
  Anda"** — minggu-minggu orang tanpa akun (kru supplier), disetujui atau dikembalikan di sini.
  Untuk orang yang punya akun, minggunya disetujui pada lembar waktunya.

## Kesalahan umum dan cara mengatasinya

- **"Kehadiran tidak dapat dicatat untuk tanggal mendatang."** — pilih hari ini atau hari
  sebelumnya.
- **"Tanggal paling awal yang terbuka untuk kehadiran adalah &lt;tanggal&gt;."** — organisasi Anda
  hanya mengizinkan beberapa hari ke belakang (umumnya 7). Kehadiran yang lebih lama dikoreksi
  melalui administrator.
- **"Orang ini sudah punya N jam di &lt;perintah kerja&gt; pada hari itu. Satu hari paling banyak
  24 jam."** — orang itu juga sudah ditandai di perintah kerja lain. Turunkan jamnya agar satu hari
  tetap dalam 24 jam.
- **"Orang ini tidak berada di kru yang dijadwalkan pada perintah kerja ini hari itu."** —
  tempatkan orang itu di kru atau jadwalkan krunya pada perintah kerja untuk tanggal itu lebih
  dahulu (lihat [Menyiapkan kru dan jadwal kru](set-up-crews-and-roster.md)).
- **"Libur rotasi: beri alasan"** — orang itu sedang libur rotasi hari itu; tulis mengapa ia tetap
  hadir.
- **"Minggu ini sudah dikirim untuk persetujuan. Kembalikan untuk mengubah satu hari."** — tunggu
  manajer mengembalikan minggunya, atau minta mereka mengembalikannya; Anda tidak bisa mengubah
  minggu yang sudah dikirim.
- **"Anda yang mencatat jam ini, jadi orang lain yang menyetujuinya."** — persetujuan butuh manajer
  yang tidak mencatat minggu ini sama sekali.
- **Hari di mana check-in dan jadwal tidak sama** — bila satu hari punya catatan dari dua sumber
  dengan jam berbeda, minggu tidak bisa dikirim sebelum hari-hari itu diselesaikan: buka harinya,
  pilih jam yang benar, dan simpan.

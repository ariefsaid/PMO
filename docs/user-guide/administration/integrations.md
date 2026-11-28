# Connect the services your organisation works with

## What this is for

PMO runs on its own. When your organisation already uses other services, PMO can connect to them so
information moves instead of being typed twice: a task tool for project tasks, an accounting system
for purchases and stock, and Microsoft 365 for documents. **Nothing is connected until an Admin
connects it**, and each connection can be disconnected again.

There are two separate places, and it matters which one you are in:

- **Administration → Organization integrations** — the organisation's own connections, set up once by
  an Admin.
- **My integrations** — your own Microsoft 365 account, which any member can connect for themselves.

**Who can do this:** an **Admin** connects and disconnects the organisation's services. Each person
connects their own Microsoft 365 account under **My integrations**.

## Where to find it

- **Administration → Organization integrations** (the Administration section; the **Organization
  settings** view on the same page holds email notifications).
- **My integrations** — your personal Microsoft 365 connection.

## Steps

### Connect the organisation's services

1. Open **Administration → Organization integrations**.
2. Each service has its own card, showing **Connected**, **Not connected**, **Disconnected** or a
   message about what it needs.
3. Choose **Connect …** on the service's card and enter the details it asks for.
4. When a service needs a company chosen before it starts syncing, the card says so — **Awaiting
   activation: select a Company to activate** — and offers **Select Company**. Pick it and
   **Activate**.
5. Check **Information updated from connected services** at the foot of the page: it says which
   information areas each connected service now updates, so nobody is surprised by a field that
   changed itself.

### Disconnect a service

1. On the service's card, choose **Disconnect …**.
2. Confirm. PMO stops reading and writing through that connection; the records already saved stay.

### Connect your own Microsoft 365 account

1. Open **My integrations**.
2. Under **Microsoft 365**, choose to connect.
3. Sign in to Microsoft when the window opens and approve the access PMO asks for.
4. Your card then reads **Connected. You can disconnect any time.**

## What the result looks like

- A connected service shows **Connected**, who connected it, and the day. If the connection later
  breaks, the card says so — for example **Odoo cannot be reached**, **Odoo rejected the API key**, or
  **The API key expires soon** — with what to do next.
- A service waiting for a company to be chosen shows **Awaiting activation** and pauses syncing until
  one is selected.
- **Information updated from connected services** lists the areas each service maintains, so a reader
  knows why a company name or a task changed without anyone editing it.
- If a service's status cannot be read at all, the card says **Connection state unavailable** with
  **Retry status** — never a guessed state.
- Your personal Microsoft 365 card is separate: disconnecting it affects only your own access to
  documents.

## Common errors and what to do

- **"Your administrator manages this app."** — the Microsoft 365 app registration belongs to the
  organisation. Ask an Admin.
- **"Your ERPNext Companies could not be read."** — the company list could not be fetched. **Try
  again** to activate; nothing was activated.
- **"No Companies found"** — there is no company in the accounting system yet. Create one there,
  then activate.
- **"ERPNext … is not supported."** — the accounting system's version is outside what PMO supports.
  Nothing was activated; ask your operator about supported versions.
- **"Data resides with ClickUp (US-hosted)." / "Data resides on your ERPNext instance."** — where that
  service keeps the data. Read it before connecting if your organisation has rules about where data
  may sit.
- **"Couldn't read connection status"** — the status read failed. Use **Retry status**; no service is
  treated as connected while the state is unknown.
- **A disconnect did not complete** — the card says so and names the reason. Try again.
- **A field changed without anyone editing it** — a connected service maintains it. See
  **Information updated from connected services** for which areas.

---

## Bahasa Indonesia

# Menghubungkan layanan yang dipakai organisasi Anda

## Untuk apa ini

PMO berjalan sendiri. Bila organisasi Anda sudah memakai layanan lain, PMO dapat terhubung ke sana
agar informasi berpindah, bukan diketik dua kali: alat tugas untuk tugas proyek, sistem akuntansi
untuk pembelian dan stok, serta Microsoft 365 untuk dokumen. **Tidak ada yang terhubung sampai Admin
menghubungkannya**, dan setiap koneksi dapat diputuskan lagi.

Ada dua tempat berbeda, dan penting untuk tahu Anda sedang di mana:

- **Administrasi → Integrasi organisasi** — koneksi milik organisasi, disiapkan sekali oleh Admin.
- **Integrasi saya** — akun Microsoft 365 Anda sendiri, yang dapat dihubungkan setiap anggota.

**Siapa yang bisa melakukannya:** **Admin** menghubungkan dan memutuskan layanan organisasi. Setiap
orang menghubungkan akun Microsoft 365-nya sendiri di **Integrasi saya**.

## Di mana menemukannya

- **Administrasi → Integrasi organisasi** (bagian Administrasi; tampilan **Pengaturan organisasi** di
  halaman yang sama memuat notifikasi email).
- **Integrasi saya** — koneksi Microsoft 365 pribadi Anda.

## Langkah-langkah

### Menghubungkan layanan organisasi

1. Buka **Administrasi → Integrasi organisasi**.
2. Setiap layanan punya kartunya sendiri, menampilkan **Terhubung**, **Belum terhubung**,
   **Terputus**, atau pesan tentang apa yang dibutuhkannya.
3. Pilih **Hubungkan …** pada kartu layanan itu dan isi detail yang diminta.
4. Bila sebuah layanan perlu memilih perusahaan sebelum mulai menyinkronkan, kartunya menyebutkannya —
   **Menunggu aktivasi: pilih Perusahaan untuk mengaktifkan** — dan menawarkan **Pilih Perusahaan**.
   Pilih lalu **Aktifkan**.
5. Periksa **Informasi yang diperbarui dari layanan terhubung** di kaki halaman: ia menyebut area
   informasi mana yang kini diperbarui tiap layanan terhubung, sehingga tidak ada yang terkejut oleh
   kolom yang berubah sendiri.

### Memutuskan layanan

1. Pada kartu layanan, pilih **Putuskan …**.
2. Konfirmasi. PMO berhenti membaca dan menulis melalui koneksi itu; catatan yang sudah tersimpan
   tetap ada.

### Menghubungkan akun Microsoft 365 Anda

1. Buka **Integrasi saya**.
2. Di **Microsoft 365**, pilih untuk menghubungkan.
3. Masuk ke Microsoft saat jendelanya terbuka dan setujui akses yang diminta PMO.
4. Kartu Anda lalu berbunyi **Terhubung. Anda dapat memutuskan kapan saja.**

## Hasilnya seperti apa

- Layanan yang terhubung menampilkan **Terhubung**, siapa yang menghubungkannya, dan harinya. Bila
  koneksinya kemudian bermasalah, kartunya menyebutkannya — misalnya **Odoo tidak dapat dijangkau**,
  **Odoo menolak kunci API**, atau **Kunci API akan kedaluwarsa** — beserta langkah berikutnya.
- Layanan yang menunggu dipilihkannya perusahaan menampilkan **Menunggu aktivasi** dan menjeda
  sinkronisasi sampai perusahaan dipilih.
- **Informasi yang diperbarui dari layanan terhubung** mencantumkan area yang dikelola tiap layanan,
  sehingga pembaca tahu mengapa nama perusahaan atau sebuah tugas berubah tanpa ada yang mengubahnya.
- Bila status sebuah layanan tidak dapat dibaca sama sekali, kartunya berbunyi **Status koneksi tidak
  tersedia** dengan **Coba status lagi** — bukan status tebakan.
- Kartu Microsoft 365 pribadi Anda terpisah: memutusnya hanya memengaruhi akses dokumen Anda sendiri.

## Kesalahan umum dan cara mengatasinya

- **"Administrator Anda mengelola aplikasi ini."** — pendaftaran aplikasi Microsoft 365 milik
  organisasi. Minta Admin.
- **"Perusahaan ERPNext Anda tidak dapat dibaca."** — daftar perusahaan tidak dapat diambil. Pilih
  **Coba lagi** untuk mengaktifkan; belum ada yang diaktifkan.
- **"Tidak ada Perusahaan ditemukan"** — belum ada perusahaan di sistem akuntansi. Buat di sana, lalu
  aktifkan.
- **"ERPNext … tidak didukung."** — versi sistem akuntansi di luar dukungan PMO. Belum ada yang
  diaktifkan; tanyakan versi yang didukung kepada operator Anda.
- **"Data berada di ClickUp (berhost AS)." / "Data berada di instans ERPNext Anda."** — tempat layanan
  itu menyimpan data. Bacalah sebelum menghubungkan bila organisasi Anda punya aturan tentang lokasi
  data.
- **"Tidak dapat membaca status koneksi"** — pembacaan status gagal. Gunakan **Coba status lagi**;
  tidak ada layanan yang dianggap terhubung selama statusnya tidak diketahui.
- **Pemutusan tidak selesai** — kartunya menyebutkannya beserta alasannya. Coba lagi.
- **Sebuah kolom berubah tanpa ada yang mengubahnya** — layanan terhubung yang mengelolanya. Lihat
  **Informasi yang diperbarui dari layanan terhubung** untuk area mana.

# Place untagged cost onto projects

## What this is for

When cost arrives from your accounting system, most of it already names a project. Some does not — a
shared account, an overhead, a bill booked without a project tag. **Cost attribution** rules place
that untagged cost onto one or more projects by a percentage, so the project's actual cost is complete
without anyone re-keying it.

Rules are read-side only: PMO uses them to show and total the cost. Nothing is written back to your
accounting system.

**Who can do this:** **Finance** and **Admin** add, edit and end rules. Other roles that can open
**Administration** read the list.

## Where to find it

**Administration → Cost attribution** (in the **Setup** group of the Administration side navigation).

## Steps

1. Open **Administration → Cost attribution** and choose **Add rule**.
2. Give the rule a **Rule name**.
3. Under **Match by**, choose what the rule looks for: **An account group** (then pick the **ERP account
   group**), or **One ERP account** (then pick the **ERP account**).
4. Optionally narrow it under **Narrow to (optional)** by **Cost centre** and by **Party** (with a
   **Party type** such as Employee).
5. Under **Posting dates it applies to**, set **Applies from** and, if the rule has an end,
   **Applies until (optional)**.
6. Under **Goes to**, add a project and its **Percent**; use **Add project** for more. The
   percentages must total 100.
7. Choose **Preview effect** to see how much of the untagged cost the rule would place on each
   project and month, before you save.
8. Choose **Save rule**.
9. To stop a rule, use **End** on its row and confirm. It stops applying to cost posted after today;
   cost already attributed stays attributed.

## What the result looks like

- The list shows each rule with its **Match**, where it **Goes to** with the split, its **Posting
  dates**, and its **Version** — the version goes up each time the rule is saved again.
- Project cost totals include the attributed share, and say so: *Includes … attributed by cost rules*,
  with the tagged amount beside it.
- A **Preview effect** counts the untagged ledger lines that match in the rule's window, and warns if
  some of that cost sits on an account that is not linked to a budget category, because it will not
  then appear in project actuals.
- Ending a rule leaves the past alone: only cost posted after today stops being attributed.

## Common errors and what to do

- **"Only Finance and Admin can change cost attribution rules."** — your role reads the list.
- **"Percentages must total 100."** — adjust the percentages across the projects.
- **"Percentages must be above 0, at most 100, with up to 4 decimals."** — correct the figure.
- **"Each project can appear only once."** — put all of a project's share on its one line.
- **"Pick a project for every line."** — a percentage row has no project.
- **"This rule overlaps another rule"** — another rule with equal specificity covers the same cost.
  Narrow one of them by cost centre or party, or change the dates.
- **"This rule has changed since you opened it"** — someone saved a newer version. The list reloads;
  reopen the rule to edit the latest version.
- **"Cannot be earlier than the day before the start date."** — the end date is before the start.
- **"Enter the party, or clear the party type."** — a party type without a party cannot match
  anything.
- **Preview shows "No untagged ledger lines match this rule"** — nothing in that window fits the
  match. Widen the dates or check the account and narrowing.
- **Some cost is “Not mapped”** — map that account to a budget category in the **Budget account map**
  (**Administration → Accounting setup**, under **Costs and account mapping**), or the cost will not
  show in project actuals.

---

## Bahasa Indonesia

# Menempatkan biaya tanpa proyek ke proyek

## Untuk apa ini

Saat biaya datang dari sistem akuntansi Anda, sebagian besar sudah menyebut proyek. Sebagian tidak —
akun bersama, biaya overhead, tagihan yang dicatat tanpa tanda proyek. Aturan **Alokasi biaya**
menempatkan biaya tanpa proyek itu ke satu atau beberapa proyek menurut persentase, sehingga biaya
aktual proyek lengkap tanpa diketik ulang.

Aturan hanya untuk sisi baca: PMO memakainya untuk menampilkan dan menjumlahkan biaya. Tidak ada yang
ditulis kembali ke sistem akuntansi Anda.

**Siapa yang bisa melakukannya:** **Keuangan** dan **Admin** menambah, mengubah, dan mengakhiri aturan.
Peran lain yang dapat membuka **Administrasi** membaca daftarnya.

## Di mana menemukannya

**Administrasi → Alokasi biaya** (di grup **Penyiapan** pada navigasi samping Administrasi).

## Langkah-langkah

1. Buka **Administrasi → Alokasi biaya** dan pilih **Tambah aturan**.
2. Beri **Nama aturan**.
3. Di **Cocokkan berdasarkan**, pilih apa yang dicari aturan: **Grup akun** (lalu pilih **Grup akun
   ERP**), atau **Satu akun ERP** (lalu pilih **Akun ERP**).
4. Bila perlu persempit di **Persempit ke (opsional)** menurut **Pusat biaya** dan **Pihak** (dengan
   **Jenis pihak** seperti Karyawan).
5. Di **Tanggal posting yang berlaku**, isi **Berlaku mulai** dan, bila aturan berakhir,
   **Berlaku sampai (opsional)**.
6. Di **Dialokasikan ke**, tambahkan proyek dan **Persen**-nya; gunakan **Tambah proyek** untuk lebih.
   Persentasenya harus berjumlah 100.
7. Pilih **Pratinjau dampak** untuk melihat berapa biaya tanpa proyek yang akan ditempatkan aturan itu ke
   tiap proyek dan bulan, sebelum disimpan.
8. Pilih **Simpan aturan**.
9. Untuk menghentikan aturan, gunakan **Akhiri** pada barisnya lalu konfirmasi. Aturan berhenti berlaku
   untuk biaya yang diposting setelah hari ini; biaya yang sudah dialokasikan tetap dialokasikan.

## Hasilnya seperti apa

- Daftar menampilkan setiap aturan dengan **Kecocokan**-nya, **Dialokasikan ke** beserta pembagiannya,
  **Tanggal posting**-nya, dan **Versi**-nya — versinya naik setiap kali aturan disimpan lagi.
- Total biaya proyek memuat bagian yang dialokasikan, dan menyebutnya: *Termasuk … dialokasikan oleh
  aturan biaya*, dengan jumlah yang ditandai di ERP di sampingnya.
- **Pratinjau dampak** menghitung baris buku besar tanpa proyek yang cocok dalam rentang aturan, dan
  memperingatkan bila sebagian biaya itu berada di akun yang tidak tertaut ke kategori anggaran,
  karena biaya itu tidak akan muncul di aktual proyek.
- Mengakhiri aturan tidak mengubah masa lalu: hanya biaya yang diposting setelah hari ini yang berhenti
  dialokasikan.

## Kesalahan umum dan cara mengatasinya

- **"Hanya Finance dan Admin yang dapat mengubah aturan alokasi biaya."** — peran Anda membaca
  daftarnya.
- **"Persentase harus berjumlah 100."** — sesuaikan persentasenya di antara proyek.
- **"Persentase harus di atas 0, paling banyak 100, dengan maksimal 4 desimal."** — betulkan angkanya.
- **"Setiap proyek hanya boleh muncul sekali."** — masukkan seluruh bagian proyek pada satu barisnya.
- **"Pilih proyek untuk setiap baris."** — ada baris persentase tanpa proyek.
- **"Aturan ini tumpang tindih dengan aturan lain"** — aturan lain dengan kekhususan yang sama
  mencakup biaya yang sama. Persempit salah satunya menurut pusat biaya atau pihak, atau ubah
  tanggalnya.
- **"Aturan ini berubah sejak Anda membukanya"** — seseorang menyimpan versi yang lebih baru. Daftar
  dimuat ulang; buka lagi aturannya untuk mengubah versi terbaru.
- **"Tidak boleh lebih awal dari sehari sebelum tanggal mulai."** — tanggal akhirnya sebelum tanggal
  mulai.
- **"Isi pihaknya, atau kosongkan jenis pihaknya."** — jenis pihak tanpa pihak tidak dapat mencocokkan
  apa pun.
- **Pratinjau menampilkan "Tidak ada baris buku besar tanpa proyek yang cocok dengan aturan ini pada
  periodenya."** — tidak ada yang cocok dalam rentang itu. Lebarkan tanggalnya atau periksa akun dan persempitannya.
- **Sebagian biaya “Belum dipetakan”** — petakan akun itu ke kategori anggaran di **Peta akun
  anggaran** (**Administrasi → Pengaturan akuntansi**, di bagian **Biaya dan pemetaan akun**), atau
  biayanya tidak akan muncul di aktual proyek.

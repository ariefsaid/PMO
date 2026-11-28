# Billing board: claims by step and age

## What this is for

Every progress claim passes through billing steps before it can be invoiced. The **Billing board**
shows all open claims at once, grouped by the step they are waiting on, with how long each has waited
and whether it has passed its target. Use it to see what is stuck and who has to act.

## Who can do this

- **Read the board**: Admin, Executive, Finance.
- **Move a claim along**: the board is read-only. A claim moves when its step is completed on the
  claim itself (see [Billing stages and retention](../office/billing-stages-and-retention.md)).

## Where to find it

- **Finance** → **Billing board**.
- Also from **Receivables** (the **Billing board** link beside the page title) and from the Finance
  home's **Claims board: by step and age**.

## Steps

1. Open **Billing board**. Each column is one billing step, and the last column is **All steps done**.
2. Filter to one project with the **Project** picker, or leave it at **All projects**.
3. Read a card: the project, the **Work order** number where the claim has one, **⟨done⟩ of ⟨total⟩
   steps**, **Waiting on ⟨role⟩**, and **⟨n⟩ days on this step**. A red pill reads
   **⟨n⟩ days past target**.
4. Read a column's head: its claim count and **⟨amount⟩ total** per currency. **All steps done**
   means **Ready to invoice**; its age counts from the last step.
5. Click a card to open that claim on the project's **Contract** tab, where you finish the open step
   or raise the invoice.
6. Scroll on to **Work-order billing steps** for the steps recorded per work order, with **Done**,
   **Current**, **Not yet open** and **Skipped**. This section appears only when work orders have
   billing steps.

## What the result looks like

- The board is a snapshot: columns fill from left to right as steps complete, and completed claims
  leave for the **All steps done** column.
- Tallies are per currency — two currencies are never added together.
- When more claims exist than the board shows, a note says **Showing the ⟨n⟩ oldest. Filter by
  project to see the rest.**

## Common errors and what to do

- **"No claims to show"** — no claim has billing steps yet. Claims appear once their steps are set
  (see [Billing stages and retention](../office/billing-stages-and-retention.md)).
- **"The billing board could not be loaded"** — use the retry on the message.
- **A claim you expect is missing** — the board shows the oldest claims first; filter by project, or
  open the project's **Contract** tab.
- **A card says "Not started"** — no step of that claim is running yet. Open the claim and check
  its stages.
- **A card sits in one column although the work is finished** — the stage has not been completed
  on the claim (**Complete stage**). The board never moves a claim by itself.
- **"The work-order billing steps could not be loaded."** — the section at the bottom failed to load;
  the board above still works. Reload the page.

---

## Bahasa Indonesia

# Papan penagihan: klaim menurut langkah dan umur

## Untuk apa ini

Setiap klaim progres melewati langkah penagihan sebelum dapat diterbitkan invoice-nya.
**Papan penagihan** menampilkan semua klaim terbuka sekaligus, dikelompokkan menurut langkah yang
ditunggunya, beserta berapa lama masing-masing menunggu dan apakah sudah melewati targetnya. Gunakan
halaman ini untuk melihat apa yang tertahan dan siapa yang harus bertindak.

## Siapa yang dapat melakukannya

- **Membaca papan**: Admin, Eksekutif, Keuangan.
- **Menggerakkan klaim**: papannya hanya untuk dibaca. Klaim bergerak saat langkahnya diselesaikan
  pada klaim itu sendiri (lihat
  [Tahap penagihan dan retensi](../office/billing-stages-and-retention.md)).

## Di mana menemukannya

- **Keuangan** → **Papan penagihan**.
- Juga dari **Piutang** (tautan **Papan penagihan** di samping judul halaman) dan dari halaman utama
  Keuangan, **Papan klaim: per langkah dan umur**.

## Langkah-langkah

1. Buka **Papan penagihan**. Tiap kolom adalah satu langkah penagihan, dan kolom terakhir adalah
   **Semua langkah selesai**.
2. Saring ke satu proyek dengan pemilih **Proyek**, atau biarkan **Semua proyek**.
3. Baca kartunya: proyek, nomor **Perintah kerja** bila klaim memilikinya, **⟨done⟩ dari ⟨total⟩
   langkah**, **Menunggu ⟨peran⟩**, dan **⟨n⟩ hari di langkah ini**. Pil merah berbunyi
   **⟨n⟩ hari lewat target**.
4. Baca kepala kolomnya: jumlah klaim dan **Total ⟨jumlah⟩** per mata uang. **Semua langkah selesai**
   berarti **Siap ditagihkan**; umurnya dihitung sejak langkah terakhir.
5. Klik kartunya untuk membuka klaim itu di tab **Kontrak** proyek, tempat Anda menyelesaikan langkah
   yang terbuka atau menerbitkan invoice-nya.
6. Gulir ke **Langkah penagihan perintah kerja** untuk langkah yang tercatat per perintah kerja,
   dengan **Selesai**, **Berjalan**, **Belum dibuka**, dan **Dilewati**. Bagian ini hanya muncul bila
   perintah kerja punya langkah penagihan.

## Bagaimana hasilnya

- Papannya adalah potret saat ini: kolom terisi dari kiri ke kanan seiring langkah selesai, dan klaim
  yang selesai pindah ke kolom **Semua langkah selesai**.
- Penjumlahannya per mata uang — dua mata uang tidak pernah dijumlahkan.
- Bila klaimnya lebih banyak daripada yang ditampilkan, catatan berbunyi
  **Menampilkan ⟨n⟩ yang tertua. Saring menurut proyek untuk melihat sisanya.**

## Kesalahan umum dan cara mengatasinya

- **"Tidak ada klaim untuk ditampilkan"** — belum ada klaim yang punya langkah penagihan. Klaim muncul
  setelah langkahnya diatur (lihat
  [Tahap penagihan dan retensi](../office/billing-stages-and-retention.md)).
- **"Papan penagihan tidak dapat dimuat"** — gunakan coba lagi pada pesannya.
- **Klaim yang Anda cari tidak ada** — papan menampilkan klaim tertua lebih dulu; saring menurut
  proyek, atau buka tab **Kontrak** proyeknya.
- **Kartu berbunyi "Belum dimulai"** — belum ada langkah klaim itu yang berjalan. Buka klaimnya dan
  periksa tahapnya.
- **Kartu tetap di satu kolom padahal pekerjaannya selesai** — tahapnya belum diselesaikan pada
  klaim (**Selesaikan tahap**). Papan tidak pernah memindahkan klaim sendiri.
- **"Langkah penagihan perintah kerja tidak dapat dimuat."** — bagian di bawah gagal dimuat; papan di
  atasnya tetap berjalan. Muat ulang halamannya.

# Agenda Sekretariat — versi Netlify

Project ini **sudah dikembalikan** ke fitur inti: bikin & kelola jadwal
agenda (tampilan "Semua Jadwal" ala Google Calendar + "Per Tanggal"),
ditambah lampiran PDF per-agenda. Login tetap 2 akun: **Lisa** (Sekretaris,
bikin agenda + upload PDF) dan **Amir** (Kepala Sekretariat, lihat agenda +
ubah status + lihat PDF).

## Kenapa sempat "fitur agendanya hilang"

Waktu awal migrasi ke Netlify, saya sempat memangkas ke fitur upload/lihat
PDF saja karena itu yang diminta duluan untuk testing cepat. Sekarang sudah
dikembalikan penuh — agenda tetap jadi fitur utama, PDF jadi lampiran di
tiap agenda (bukan file lepas lagi), persis konsep aslinya.

## Yang TIDAK ada di versi Netlify ini (beda dari versi Render)

- **Role Admin & panel kelola user** — tidak ada, karena tujuan awalnya
  (hubungkan Telegram) tidak relevan di sini.
- **Notifikasi Telegram** — bot Telegram butuh proses yang hidup terus
  (*polling*), sementara Netlify Functions itu proses sesaat (nyala pas ada
  request, lalu mati). Untuk ini jalan, Telegram-nya harus diubah ke mode
  *webhook* — bisa dikerjakan lain waktu kalau dibutuhkan.

Kalau nanti butuh fitur itu semua, tetap tersedia utuh di project
`agenda-app` (versi Render) yang terpisah.

## Bug yang sudah diperbaiki: MissingBlobsEnvironmentError

Sempat muncul error "The environment has not been configured to use Netlify
Blobs" saat coba tambah agenda / upload. Penyebabnya: function di project
ini ditulis pakai format lama (`exports.handler`, disebut "Lambda
compatibility mode" oleh Netlify) — di mode ini, Netlify **tidak**
otomatis menyalakan akses ke Blobs. Fix-nya: panggil `connectLambda(event)`
di baris pertama tiap function yang pakai Blobs, sebelum `getStore()`
dipanggil. Ini sudah diterapkan di semua function terkait
(`agenda.js`, `agenda-item.js`, `attachment-upload.js`,
`attachment-view.js`, `attachment-delete.js`) — tidak perlu diapa-apakan
lagi, tinggal deploy versi ini.

## Kenapa upload PDF kemarin gagal — dan cara benerinnya

Fungsi `login`/`me`/`logout` cuma pakai fitur bawaan Node.js, jadi langsung
jalan. Tapi fungsi upload PDF butuh 2 package tambahan (`busboy`,
`@netlify/blobs`) yang perlu di-install dulu oleh Netlify sebelum function-nya
bisa jalan — dan ini kemungkinan besar terlewat karena kolom **Build
command** dikosongkan waktu setup awal.

**Cara pastikan ini kepasang setelah push kode terbaru ini:**
1. Buka dashboard Netlify → site Anda → **Site configuration** → **Build &
   deploy** → **Build settings** → klik **Edit**.
2. Isi **Build command** dengan: `npm install`
3. **Publish directory** tetap `public` (jangan diubah).
4. Save, lalu ke tab **Deploys** → **Trigger deploy** → **Deploy site**.
5. Kalau upload masih gagal setelah ini, buka tab **Functions** di
   dashboard → klik `attachment-upload` → lihat **Function log**, akan ada
   pesan error asli di situ (bukan pesan generik di halaman web) — kirim
   screenshot log itu kalau masih error, supaya bisa didiagnosis pasti.

## Environment Variables

| Nama | Isi |
|---|---|
| `LISA_PASSWORD` | password akun Lisa (default `lisa123` kalau kosong) |
| `AMIR_PASSWORD` | password akun Amir (default `amir123` kalau kosong) |
| `JWT_SECRET` | string acak panjang, WAJIB diisi sendiri |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | opsional — lihat bagian "Sinkronisasi ke Google Sheets" |
| `GOOGLE_SHEET_ID` | opsional — lihat bagian "Sinkronisasi ke Google Sheets" |

Username tetap `lisa` dan `amir` (huruf kecil).

## Sinkronisasi ke Google Sheets (fitur baru)

Setiap Lisa **membuat agenda**, **mengedit**, **menghapus**, atau **upload/hapus
PDF**, perubahannya otomatis tersinkron ke satu baris di Google Sheets —
kolomnya persis field yang Lisa isi: Tanggal, Jam, Asal Surat, Keterangan,
Disposisi, No. Disposisi, No. Surat, dan Dokumen (nama file yang diupload).

**Sifatnya opsional & aman** — kalau belum di-setup, fitur ini cuma diam-diam
tidak aktif, TIDAK bikin aplikasi lain error. Begitu juga kalau nanti Google
Sheets API sedang bermasalah, create/edit/upload agenda tetap berhasil
normal — sinkronisasinya cuma gagal diam-diam (ke-log di Netlify Functions
logs untuk keperluan debug, tidak mengganggu pengguna).

### Cara setup

1. Buka [Google Cloud Console](https://console.cloud.google.com/) → buat
   project baru (atau pakai yang sudah ada).
2. Aktifkan **Google Sheets API**: menu **APIs & Services → Library**, cari
   "Google Sheets API", klik **Enable**.
3. Buat **Service Account**: menu **APIs & Services → Credentials** → **Create
   Credentials → Service Account** → isi nama bebas → Create → Done (tidak
   perlu kasih role/akses tambahan apapun).
4. Klik service account yang baru dibuat → tab **Keys** → **Add Key → Create
   new key** → pilih **JSON** → download filenya. Di dalam file itu ada
   `client_email` dan `private_key`, keduanya dipakai nanti.
5. Buat Google Sheet baru (spreadsheet kosong biasa di sheets.google.com).
   Klik **Share**, tempel `client_email` dari file JSON tadi, kasih akses
   **Editor**, klik Send/Share (uncheck "Notify people" boleh, tidak masalah
   kalau email itu bukan Gmail asli).
6. Ambil **Sheet ID** dari URL spreadsheet-nya — bagian di antara
   `/d/` dan `/edit`:
   `https://docs.google.com/spreadsheets/d/`**`INI_SHEET_ID_NYA`**`/edit`
7. Ubah seluruh isi file JSON tadi jadi 1 baris teks base64 (supaya tidak
   mungkin rusak formatnya waktu di-paste ke kotak teks Netlify). Caranya:
   - **Windows (PowerShell)**: buka PowerShell di folder tempat file JSON
     itu ada, jalankan (ganti `nama-file.json` sesuai nama file Anda):
     ```
     [Convert]::ToBase64String([IO.File]::ReadAllBytes("nama-file.json")) | Set-Clipboard
     ```
     Hasilnya langsung ter-copy ke clipboard (tidak perlu di-select manual).
   - **Mac/Linux (Terminal)**:
     ```
     base64 -i nama-file.json | pbcopy
     ```
     (di Linux ganti `pbcopy` dengan `xclip -selection clipboard` kalau ada, atau tinggal `base64 -i nama-file.json` lalu copy manual hasilnya)
8. Di Netlify → Site configuration → Environment variables, tambahkan:
   - `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` = paste hasil base64 dari langkah 7
   - `GOOGLE_SHEET_ID` = Sheet ID dari langkah 6
9. Trigger deploy ulang. Sheet bernama "Agenda" akan otomatis dibuat di
   spreadsheet itu (dengan header kolom otomatis) begitu ada agenda pertama
   yang dibuat/diedit/diupload setelah setup ini aktif.

Kalau muncul error di Function log seperti `DECODER routines::unsupported`
atau `error:1E08010C`, itu tandanya `private_key` rusak formatnya — pastikan
pakai cara base64 di atas (bukan copy-paste `private_key` mentah ke kotak
teks), karena itu memang penyebab paling umum error ini.

## Struktur data

Semua agenda (termasuf metadata lampiran) disimpan dalam satu blob JSON di
Netlify Blobs (store `app-data`, key `state`). Isi PDF-nya sendiri disimpan
terpisah per file di store `pdf-files`. Semua ini otomatis tersedia begitu
function pertama kali jalan — tidak perlu setup manual.

## Batasan

- **Ukuran file maksimal 4MB per PDF** (batas aman di bawah limit payload
  Netlify Functions).
- Functions gratis Netlify punya timeout 10 detik per request — cukup jauh
  untuk upload PDF beberapa MB.
- Ini penyimpanan sederhana (bukan database transaksional) — kalau 2 orang
  menyimpan perubahan persis bersamaan di detik yang sama, ada kemungkinan
  kecil salah satu perubahan tertimpa. Untuk pemakaian testing/kecil ini
  bukan masalah; kalau nanti dipakai serius dengan banyak orang, ini bisa
  diperkuat lagi.

## Deploy

1. Push ke GitHub (repo terpisah dari project lain).
2. Netlify → Add new site → Import dari GitHub → pilih repo ini.
3. **Build command**: `npm install` (WAJIB diisi, jangan dikosongkan — lihat
   bagian di atas). **Publish directory**: `public`.
4. Deploy → tunggu Published.
5. Site configuration → Environment variables → isi `LISA_PASSWORD`,
   `AMIR_PASSWORD`, `JWT_SECRET` → Save.
6. Deploys → Trigger deploy → Deploy site (supaya env var baru kepakai).
7. Buka URL-nya, login sebagai Lisa, coba tambah agenda & upload PDF. Login
   sebagai Amir, coba lihat agendanya & buka PDF-nya.

# Admin Backend ↔ Master Google Sheet

Master spreadsheet:

`https://docs.google.com/spreadsheets/d/1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k/edit`

## Arsitektur tahap awal

Google Sheet tetap menjadi source of truth untuk data operasional. Admin menekan **Sinkronkan Sekarang**, lalu Netlify Function membaca tiga tab dan menyimpan snapshot di Netlify Blobs. Booking dan Partner API nantinya membaca snapshot ini, bukan Google Sheet pada setiap request.

Flow:

`Master Google Sheet → Admin Sync → Netlify Blobs Snapshot → Booking / Partner API`

Tab yang dibaca:

- `Master Lastmile!A1:R1000`
- `Jarak Bandara-Kelurahan!A1:AD1000`
- `Zona Operasional Awal!A1:K100`

## Netlify environment variables

Simpan di Netlify Project configuration → Environment variables:

- `MASTER_SHEET_ID=1bE37sgz-KfggVVz9cIaEQn855bbITwtD8tyyVlUMX1k`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL=<service-account>@<project>.iam.gserviceaccount.com`
- `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=<private-key>`

Jangan simpan private key di repository, browser, Google Sheet, atau chat.

## Google Cloud

1. Gunakan project Google Cloud Libra.
2. Aktifkan Google Sheets API.
3. Buat Service Account khusus backend Libra.
4. Buat private key JSON untuk Service Account dan simpan nilainya sebagai environment variables Netlify.
5. Buka Master Google Sheet dan share sebagai **Viewer** ke `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
6. Buka `/admin-master-sheet` dan tekan **Sinkronkan Sekarang**.

Untuk tahap ini Service Account hanya membutuhkan scope read-only: `https://www.googleapis.com/auth/spreadsheets.readonly`.

## Data snapshot

Snapshot menyimpan:

- route code dan kode wilayah
- kabupaten/kota, distrik, kelurahan/kampung
- hub, feeder, moda
- status layanan dan zona tarif
- jarak darat dan estimasi waktu
- status verifikasi dan jenis akses
- SLA last-mile dan SLA total dari hub
- skema layanan
- minimum load
- titik mulai SLA
- zona operasional awal

## Prinsip keamanan

- Perubahan master dilakukan di Sheet oleh admin berwenang.
- Backend hanya membaca Sheet pada saat sync.
- Order tidak membaca Google Sheet langsung.
- Snapshot memiliki `version` dan `syncedAt` untuk audit.
- Jika sync gagal, backend tetap menggunakan snapshot terakhir yang berhasil.
- Jangan aktifkan write access ke Google Sheet sampai workflow approval/audit ditentukan.

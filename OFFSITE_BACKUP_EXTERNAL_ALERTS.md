# Off-site Encrypted Backup & External Alerts

## Tujuan
Lapisan ini memisahkan failure domain backup dari Netlify dan mengirim alert kritis melalui kanal eksternal tanpa membuat booking/API tergantung pada provider email/WhatsApp.

## Off-site Backup
Sistem mendukung storage **S3-compatible** dengan path-style request, termasuk Cloudflare R2, AWS S3-compatible endpoint, dan provider lain yang mendukung AWS Signature V4.

Backup harian tetap dibuat ke Netlify Blobs. Jika konfigurasi off-site lengkap, worker harian kemudian:
1. membaca manifest backup internal;
2. gzip payload;
3. mengenkripsi seluruh payload dengan AES-256-GCM menggunakan key 32 byte yang hanya ada di environment variable;
4. upload object terenkripsi ke storage off-site;
5. menyimpan status/ETag/object key di index backup internal.

Object key deterministik:

`<OFFSITE_BACKUP_PREFIX>/backups/<BACKUP_ID>.lbrbk`

Karena object key diturunkan dari Backup ID, SUPERADMIN dapat mengimpor ulang backup off-site berdasarkan Backup ID walaupun index internal hilang.

### Environment Variables Off-site
- `OFFSITE_S3_ENDPOINT` — contoh endpoint S3-compatible HTTPS.
- `OFFSITE_S3_BUCKET`
- `OFFSITE_S3_REGION` — default `auto` (cocok untuk Cloudflare R2; AWS gunakan region sebenarnya).
- `OFFSITE_S3_ACCESS_KEY_ID`
- `OFFSITE_S3_SECRET_ACCESS_KEY`
- `OFFSITE_BACKUP_ENCRYPTION_KEY_B64` — base64 tepat 32 byte.
- `OFFSITE_BACKUP_PREFIX` — default `libra-jaya`.

Generate encryption key secara lokal/server terminal:

`node scripts/generate-offsite-backup-key.mjs`

Jangan kirim access key, secret key, atau encryption key melalui chat/WhatsApp. Simpan langsung di Netlify Environment Variables / secret manager.

### Recovery dari Off-site
Admin Libra → **Resilience & Alerts** → masukkan Backup ID → `Import Off-site Backup` (SUPERADMIN).

Import akan:
- download object melalui request AWS Signature V4;
- validasi AES-GCM auth tag;
- validasi checksum compressed + plaintext;
- validasi checksum manifest backup;
- menyimpan kembali snapshot ke backup internal.

Restore data operasional tetap dilakukan dari menu **Audit / Backup / DR** dan tetap membuat PRE_RESTORE safety snapshot.

## External Alerts
External alert delivery asynchronous. Aksi utama seperti booking, update tracking, API request, atau backup tidak gagal hanya karena email/WhatsApp gagal.

### Email
Provider: Resend REST API.

Environment:
- `RESEND_API_KEY`
- `ALERT_EMAIL_FROM` — sender terverifikasi di Resend.
- `ALERT_ADMIN_EMAILS` — satu atau beberapa email dipisahkan koma/spasi.

Partner menerima email ke alamat yang tersimpan pada record partner jika event policy mengizinkan.

### WhatsApp
Provider: Meta WhatsApp Cloud API.

Environment:
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ALERT_TEMPLATE_NAME`
- `WHATSAPP_ALERT_TEMPLATE_LANG` — default `id`.
- `WHATSAPP_GRAPH_VERSION` — default `v23.0`, dapat diganti tanpa perubahan kode.
- `ALERT_ADMIN_WHATSAPP_NUMBERS` — nomor internasional, dipisahkan koma/spasi.

Template WhatsApp yang dipakai harus memiliki **3 body text parameters** dengan urutan:
1. judul alert;
2. isi alert;
3. referensi.

Gunakan template yang telah disetujui Meta untuk business-initiated notification.

## Event Policy
External queue dibuat untuk event penting, antara lain:
- saldo rendah;
- delivery ke partner;
- HELD / DAMAGED / CLAIM_PROCESS;
- webhook DEAD / queue error;
- API quota / spike / 5xx / suspend;
- Final UAT PASS/CONDITIONAL/FAIL;
- Production API aktif;
- backup internal/off-site gagal;
- disaster recovery restore selesai;
- booking bernilai besar.

Booking besar memakai threshold:
- `EXTERNAL_ALERT_BOOKING_AMOUNT_THRESHOLD`
- default Rp10.000.000.

## Retry
Email dan WhatsApp memiliki status channel terpisah. Channel yang sudah sukses tidak dikirim ulang ketika channel lain gagal.

Retry maksimal 5 attempt, dengan backoff sekitar:
- 1 menit;
- 5 menit;
- 30 menit;
- 2 jam;
- 12 jam.

Scheduled dispatcher berjalan setiap menit dan hanya mengantrekan background worker.

## Admin
Endpoint: `/admin-resilience`

Menampilkan:
- health konfigurasi off-site/email/WhatsApp;
- status copy off-site per Backup ID;
- tombol copy/ulang off-site;
- import off-site untuk SUPERADMIN;
- test email + WhatsApp;
- delivery history, status retry/dead, dan error provider.

Semua aksi manual off-site/import/test dicatat ke Admin Audit Trail.

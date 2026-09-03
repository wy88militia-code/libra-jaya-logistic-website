# Admin Audit Trail, Backup & Disaster Recovery

## Tujuan
Modul ini menjaga jejak perubahan kritis Admin Libra dan menyediakan backup/recovery untuk data operasional utama.

## Admin Audit Trail
Endpoint admin: `/admin-audit-backup`.

Audit menggunakan hash-chain SHA-256 (`prevHash` + `recordHash`) sehingga perubahan/hapus record lama dapat terdeteksi melalui verifikasi chain. Metadata yang dicatat meliputi admin/role, waktu, IP, user-agent, path/method, aksi, entity, before/after, dan catatan.

Field sensitif seperti API secret, webhook secret, token, PIN/hash/salt, authorization, signature, dan private key otomatis direduksi menjadi `[REDACTED]`.

Aksi kritis yang sudah diaudit:
- pembuatan partner manual;
- perubahan Rate Plan/rule/status;
- preview dan publish Master Rute;
- approval quote manual;
- perubahan API security policy dan Emergency Suspend/Resume;
- link UAT, minimum deposit, webhook test/rotate, analisa OpenAI, final UAT decision, Production activation;
- rotasi Production API credential;
- pembuatan backup, retention prune, dan disaster recovery restore.

## Backup
Scheduler: `scheduled-daily-backup.mjs`.
Worker: `daily-backup-background.mjs`.

Jadwal default: `15 17 * * *` UTC = sekitar 02:15 WIT setiap hari. Scheduled function hanya mengantrekan background worker sehingga snapshot besar tidak dibatasi execution window scheduled function. Request internal ditandatangani HMAC menggunakan `ADMIN_SESSION_SECRET`; tidak diperlukan secret backup tambahan.

Backup mencakup store utama:
- partners;
- wallet + ledger;
- bookings;
- quotes;
- tracking;
- POD;
- API UAT/onboarding;
- rate plans;
- API security policies;
- master published/pending snapshot;
- webhook deliveries;
- notifications;
- admin audit archive.

Index API key turunan (`apikey/`) tidak ikut snapshot karena dapat dibangun ulang dari record partner bila diperlukan.

Setiap entry memiliki SHA-256 dan seluruh manifest backup memiliki checksum SHA-256.

## Retention
Default:
- scheduled backup: 30 hari;
- manual dan pre-restore safety backup: 90 hari.

Override Netlify environment variables:
- `BACKUP_RETENTION_DAYS` (7–365);
- `BACKUP_MANUAL_RETENTION_DAYS` (14–730).

## Disaster Recovery
Restore hanya tersedia untuk role `SUPERADMIN` dan membutuhkan konfirmasi persis:

`RESTORE <BACKUP_ID>`

Sebelum restore, sistem otomatis membuat `PRE_RESTORE` safety backup.

Restore bersifat **NON_DESTRUCTIVE_OVERWRITE**:
- key yang ada di snapshot ditulis ulang;
- key baru yang dibuat setelah snapshot tidak dihapus;
- admin audit trail **tidak pernah direwind** saat restore. Audit tetap diarsipkan dalam snapshot untuk referensi, tetapi store audit dikecualikan dari proses restore.

Setelah restore selesai, aksi recovery dicatat lagi ke Audit Trail dan menyimpan Safety Backup ID.

## Catatan Produksi
- Scheduled Functions berjalan pada published production deploy, bukan Deploy Preview.
- Backup memakai Netlify Blobs yang sama dengan aplikasi. Untuk skenario bencana tingkat akun/provider, tahap berikutnya disarankan menambahkan off-site copy terenkripsi ke storage terpisah (mis. S3/R2/GCS) agar tidak bergantung pada satu failure domain.
- Jangan menyimpan secret di catatan admin atau alasan restore.

# Admin RBAC & Maker-Checker — Libra Jaya Logistic

## Role resmi

- `SUPERADMIN`: seluruh modul, backup/DR, resilience, checker Go-Live Production dan DR restore.
- `FINANCE`: partner/deposit, rate plan, rekonsiliasi, quote, dan approval finansial.
- `OPS`: master/rute, booking, SLA, tracking, claim, API onboarding/UAT/security/webhook, serta approval operasional.
- `CUSTOMER_SERVICE`: booking, claim, SLA monitoring, dan link partner yang relevan. Tidak dapat mengubah harga atau saldo.
- `COURIER`: tracking/POD saja melalui modul courier.

Role lama `ADMIN` dan `OWNER` dinormalisasi menjadi `SUPERADMIN` untuk compatibility session lama.

## Enforcement

Semua fungsi admin yang menggunakan `getAdminSession(request)` sekarang diperiksa terhadap path route. Mengetahui URL modul tidak cukup untuk membuka modul jika role tidak sesuai.

Home Admin hanya menampilkan card dan alert yang dapat diakses role tersebut.

## Maker-checker

Store: `libra-approval-requests`.

Maker dan checker wajib username berbeda. Request mempunyai HMAC integrity hash berbasis `ADMIN_SESSION_SECRET`, status lifecycle, expiry, maker/checker identity, dan hasil eksekusi.

Tindakan yang wajib approval:

| Action | Maker | Checker |
| --- | --- | --- |
| Koreksi saldo partner | FINANCE / SUPERADMIN | FINANCE / SUPERADMIN |
| Tambah/update rate rule | FINANCE / SUPERADMIN | FINANCE / SUPERADMIN |
| Hapus rate rule | FINANCE / SUPERADMIN | FINANCE / SUPERADMIN |
| Aktif/nonaktif Rate Plan | FINANCE / SUPERADMIN | FINANCE / SUPERADMIN |
| Aktifkan kembali API setelah suspend | OPS / SUPERADMIN | OPS / SUPERADMIN |
| Go-Live Production API | OPS / SUPERADMIN | SUPERADMIN |
| Disaster Recovery Restore | SUPERADMIN | SUPERADMIN |

### Emergency Suspend

Emergency Suspend API sengaja **tidak** menunggu checker. Saat fraud, credential leak, atau serangan terjadi, OPS/SUPERADMIN dapat memblokir UAT + Production seketika. Reaktivasi setelah insiden wajib maker-checker.

## Disaster Recovery

DR restore:
1. Maker SUPERADMIN memilih snapshot, memberi alasan, dan mengetik `RESTORE <BACKUP_ID>`.
2. Sistem hanya membuat approval request; data belum berubah.
3. SUPERADMIN lain menyetujui di `/admin-approvals`.
4. Saat eksekusi, engine restore tetap membuat `PRE_RESTORE` safety backup.
5. `libra-admin-audit` dan `libra-approval-requests` ikut backup tetapi bersifat immutable saat restore sehingga sejarah audit/approval tidak di-rewind.

## Wallet adjustment

Tidak ada direct edit saldo dari Admin. Koreksi dibuat sebagai signed delta (`+` kredit, `-` debit). Setelah checker menyetujui, transaksi masuk ledger dengan reference `APPROVAL:<REQUEST_ID>` sehingga idempotent dan dapat direkonsiliasi.

## Production API

Tombol Go-Live pada UAT hanya membuat approval request setelah gate teknis awal lolos. Checker SUPERADMIN mengeksekusi `activateProduction()` sehingga UAT PASS, webhook PASS, deposit dan Rate Plan ACTIVE diverifikasi ulang pada saat approval.

## Membuat user

Gunakan:

```bash
node scripts/generate-admin-user.mjs <username> <PIN> <ROLE>
```

Role harus salah satu dari:

`SUPERADMIN`, `FINANCE`, `OPS`, `CUSTOMER_SERVICE`, `COURIER`.

Untuk fungsi maker-checker, sediakan minimal dua akun berbeda yang memenuhi role checker. Jangan membagikan PIN, TOTP secret, API secret, atau environment secret melalui chat/repository.

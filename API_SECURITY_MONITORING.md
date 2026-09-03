# API Security & Production Monitoring — Libra Jaya Logistic

Modul ini menambahkan kontrol keamanan per partner untuk API Libra.

## Admin

Buka `/admin-api-security` dari Admin Libra.

Kontrol per partner:
- Emergency Suspend / Aktifkan Kembali API.
- Production IP allowlist (exact IP, IPv4 CIDR, IPv6 CIDR).
- Request per minute.
- Request quota harian dan bulanan.
- Booking quota harian dan bulanan.
- Threshold lonjakan booking dalam 15 menit.
- Threshold duplicate/idempotent retry dalam sekitar 10 menit.
- Batas nominal booking tunggal (0 = tidak dibatasi).

Default policy partner API baru:
- API ACTIVE.
- 120 request/menit.
- 10.000 request/hari.
- 200.000 request/bulan.
- 1.000 booking attempt/hari.
- 20.000 booking attempt/bulan.
- Alert spike pada 100 booking attempt/15 menit.
- Alert duplicate pada 10 retry/duplicate/10 menit.
- IP allowlist kosong.
- Max booking amount 0 (tidak dibatasi).

## IP Allowlist

IP allowlist hanya diterapkan pada Production. UAT tetap dapat digunakan untuk pengujian tim IT.

Contoh:

```text
203.0.113.10
198.51.100.0/24
2001:db8:1234::/48
```

Jika allowlist tidak kosong, request Production dari IP di luar daftar ditolak dengan `API_IP_NOT_ALLOWED`.

## Emergency Suspend

Status `SUSPENDED` memblokir seluruh request UAT dan Production untuk API partner tanpa menghapus credential, wallet, booking, atau audit log. Partner tetap dapat login ke Portal Partner untuk melihat status/notifikasi.

## Quota

Security counter disimpan per partner dan environment. Quota request dihitung setelah HMAC, timestamp, nonce, dan JSON tervalidasi. Booking quota menghitung booking attempt API agar retry berlebihan atau integrasi bermasalah dapat dibatasi sebelum membebani operasional.

Kode penolakan utama:
- `API_SUSPENDED`
- `API_IP_NOT_ALLOWED`
- `API_RATE_LIMITED`
- `API_DAILY_QUOTA_EXCEEDED`
- `API_MONTHLY_QUOTA_EXCEEDED`
- `API_DAILY_BOOKING_QUOTA_EXCEEDED`
- `API_MONTHLY_BOOKING_QUOTA_EXCEEDED`
- `API_BOOKING_AMOUNT_LIMIT`

HTTP policy menggunakan 403, 422, atau 429 sesuai jenis penolakan.

## Anomaly Detection

Sistem membuat notifikasi Admin bila:
- booking API melonjak melewati threshold 15 menit;
- duplicate/idempotent retry melewati threshold sekitar 10 menit;
- quota partner diblokir;
- endpoint API menghasilkan HTTP 5xx.

Idempotency tetap menjadi proteksi utama terhadap debit/booking ganda. Alert duplicate tidak berarti transaksi digandakan; alert digunakan untuk mendeteksi integrasi retry loop atau pola yang perlu diperiksa.

## Health Dashboard

Dashboard menampilkan Production API 24 jam terakhir:
- total request;
- jumlah booking;
- HTTP 4xx;
- HTTP 5xx;
- jumlah partner suspended;
- penggunaan quota tiap partner;
- client IP pada API log;
- status HEALTHY / WARNING / CRITICAL / SUSPENDED.

Health status adalah indikator operasional untuk membantu Admin, bukan pengganti investigasi log.
